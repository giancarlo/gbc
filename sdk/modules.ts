import { Flags } from './index.js';
import type { OwnershipMode, ScalarType } from './ast.js';
import {
	decodeModuleBundle,
	ModuleTag,
	type ModuleGraph,
	type ModuleValue,
	type SerialObject,
} from './module-bundle.js';

/** Content hash for module-closure identity (dedup key, not security). */
export function moduleClosureHash(source: string, dependencies: readonly string[]): string {
	const key = `${source}\0${dependencies.join(',')}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ModuleParameter {
	readonly type: ScalarType;
	readonly ownership: OwnershipMode;
}

export interface ModuleSignature {
	readonly parameters: readonly ModuleParameter[];
	readonly result?: ModuleParameter;
}

export interface ModuleExport {
	readonly name: string;
	readonly kind: 'value' | 'type';
	readonly signature?: ModuleSignature;
	readonly artifact?: {
		readonly target: 'wasm';
		readonly object: SerialObject;
	};
}

export interface ModuleInterface {
	readonly path: string;
	readonly hash: string;
	readonly exports: ReadonlyMap<string, ModuleExport>;
	readonly dependencies: readonly string[];
}

type RecordValue = ReadonlyMap<string, ModuleValue>;

function string(value: ModuleValue | undefined) {
	return value?.t === ModuleTag.Str ? value.s : undefined;
}

function integer(value: ModuleValue | undefined) {
	return value?.t === ModuleTag.Int && Number.isSafeInteger(value.n) ? value.n : undefined;
}

function list(value: ModuleValue | undefined) {
	return value?.t === ModuleTag.Arr ? value.a : undefined;
}

function builtinScalar(name: string): ScalarType | undefined {
	const match = /^(Int|Uint|Float)(8|16|32|64)$/.exec(name);
	if (name === 'Bool') return { kind: 'type', family: 'bool', size: 1 };
	if (!match) return;
	const bits = Number(match[2]);
	const size = bits === 8 ? 1 : bits === 16 ? 2 : bits === 32 ? 4 : 8;
	if (match[1] === 'Float')
		return size === 4 || size === 8 ? { kind: 'type', family: 'float', size } : undefined;
	return { kind: 'type', family: match[1] === 'Int' ? 'int' : 'uint', size };
}

function scalar(graph: ModuleGraph, value: ModuleValue | undefined): ScalarType | undefined {
	if (value?.t === ModuleTag.TypeExt) return builtinScalar(value.s);
	const type = record(graph, value);
	if (string(type?.get('kind')) !== 'type') return;
	const family = string(type?.get('family'));
	const size = integer(type?.get('size'));
	if (family === 'bool' && size === 1) return { kind: 'type', family, size };
	if (family === 'float' && (size === 4 || size === 8)) return { kind: 'type', family, size };
	if ((family === 'int' || family === 'uint') && (size === 1 || size === 2 || size === 4 || size === 8))
		return { kind: 'type', family, size };
}

function record(graph: ModuleGraph, ref: ModuleValue | undefined): RecordValue | undefined {
	if (ref?.t !== ModuleTag.Ref) return;
	const shape = graph.shapes[graph.shapeIds[ref.r] ?? -1];
	const values = graph.values[ref.r];
	if (!shape || !values) return;
	const fields = new Map<string, ModuleValue>();
	if (shape.kind !== undefined) fields.set('kind', { t: ModuleTag.Str, s: shape.kind });
	for (const [index, { key }] of shape.fields.entries()) {
		const value = values[index];
		if (value !== undefined) fields.set(key, value);
	}
	return fields;
}

function parameter(
	graph: ModuleGraph,
	ref: ModuleValue | undefined,
	mode: ModuleValue | undefined,
): ModuleParameter | undefined {
	const type = scalar(graph, ref);
	const ownership = string(mode) ?? 'borrow';
	if (type && (ownership === 'borrow' || ownership === 'own')) return { type, ownership };
}

function concrete(fn: RecordValue) {
	return string(fn.get('kind')) === 'function' &&
		!list(fn.get('typeParams'))?.length &&
		!list(fn.get('overloads'))?.length &&
		!list(fn.get('returnVariants'))?.length;
}

function signature(graph: ModuleGraph, fn: RecordValue): ModuleSignature | undefined {
	if (!concrete(fn)) return;
	const emission = record(graph, fn.get('emissionType'));
	const rest = emission?.get('rest');
	if (rest && rest.t !== ModuleTag.Null) return;
	const params = list(fn.get('parameters'));
	const results = list(fn.get('returnTypes')) ?? list(emission?.get('elements'));
	if (!params || !results || results.length > 1) return;
	const parameters: ModuleParameter[] = [];
	for (const ref of params) {
		const param = record(graph, ref);
		const value = parameter(graph, param?.get('type'), param?.get('ownership'));
		if (!value) return;
		parameters.push(value);
	}
	if (!results.length) return { parameters };
	const result = parameter(graph, results[0], list(fn.get('returnOwnerships'))?.[0] ?? fn.get('returnOwnership'));
	if (result) return { parameters, result };
}

function moduleExports(graph: ModuleGraph): Map<string, ModuleExport> {
	const exports = new Map<string, ModuleExport>();
	const root = record(graph, { t: ModuleTag.Ref, r: graph.root });
	const children = list(root?.get('children'));
	if (!children) throw new Error('gbm: invalid root children');
	for (const child of children) {
		const declaration = record(graph, child);
		const kind = string(declaration?.get('kind'));
		if (kind !== 'def' && kind !== 'external' && kind !== 'type') continue;
		const symbol = record(graph, declaration?.get('symbol'));
		const flags = integer(symbol?.get('flags')) ?? 0;
		if (!(flags & Flags.Export)) continue;
		const name = string(symbol?.get('name'));
		if (!name || exports.has(name)) throw new Error(`gbm: invalid or duplicate export in "${graph.path}"`);
		const fn = kind === 'external' ? symbol : record(graph, symbol?.get('type'));
		const callable = fn && signature(graph, fn);
		exports.set(name, {
			name,
			kind: kind === 'type' ? 'type' : 'value',
			...(callable ? { signature: callable } : {}),
		});
	}
	return exports;
}

function wasmValue({ type }: ModuleParameter) {
	if (type.family === 'float') return type.size === 4 ? 0x7d : 0x7c;
	return type.size === 8 ? 0x7e : 0x7f;
}

function sameTypes(actual: readonly number[], expected: readonly number[]) {
	return actual.length === expected.length && expected.every((value, index) => value === actual[index]);
}

interface ResolvedInterface extends ModuleInterface {
	readonly exports: Map<string, ModuleExport>;
}

function attachArtifacts(
	interfaces: ReadonlyMap<string, ResolvedInterface>,
	dependencies: ReadonlyMap<string, Set<string>>,
	objects: readonly SerialObject[],
) {
	for (const object of objects) {
		const module = interfaces.get(object.hash);
		if (!module) throw new Error(`gbm: missing artifact module "${object.hash}"`);
		for (const relocation of object.relocs) {
			if (relocation.kind !== 'call' && relocation.kind !== 'global') continue;
			const { mod, name } = relocation.ref;
			if (mod === undefined || mod === object.hash) continue;
			if (interfaces.get(mod)?.exports.get(name)?.kind !== 'value')
				throw new Error(`gbm: unresolved artifact import "${mod}:${name}"`);
			dependencies.get(object.hash)?.add(mod);
		}
		const exported = module.exports.get(object.name);
		if (!exported?.signature) continue;
		const { parameters, result } = exported.signature;
		if (!sameTypes(object.params, parameters.map(wasmValue)) ||
			!sameTypes(object.results, result ? [wasmValue(result)] : []))
			throw new Error(`gbm: incompatible wasm ABI for "${object.name}"`);
		if (exported.artifact) throw new Error(`gbm: duplicate artifact "${object.name}"`);
		module.exports.set(object.name, { ...exported, artifact: { target: 'wasm', object } });
	}
}

export function resolveModuleInterfaces(bytes: Uint8Array): readonly ModuleInterface[] {
	const { modules, objects } = decodeModuleBundle(bytes);
	const interfaces = new Map<string, ResolvedInterface>();
	for (const graph of modules.values()) {
		if (interfaces.has(graph.hash)) throw new Error(`gbm: duplicate module identity "${graph.hash}"`);
		interfaces.set(graph.hash, {
			path: graph.path,
			hash: graph.hash,
			exports: moduleExports(graph),
			dependencies: [],
		});
	}

	const dependencies = new Map<string, Set<string>>();
	for (const graph of modules.values()) {
		const imports = new Set<string>();
		for (const fields of graph.values) {
			const pending = fields.slice();
			for (const value of pending) {
				if (value.t === ModuleTag.Arr)
					for (const item of value.a) pending.push(item);
				if (value.t !== ModuleTag.Mod && value.t !== ModuleTag.TypeMod) continue;
				const target = interfaces.get(value.h);
				if (!target) throw new Error(`gbm: missing dependency "${value.h}"`);
				const symbol = target.exports.get(value.s);
				if (!symbol || (value.t === ModuleTag.TypeMod && symbol.kind !== 'type'))
					throw new Error(`gbm: unresolved import "${value.h}:${value.s}"`);
				if (value.h !== graph.hash) imports.add(value.h);
			}
		}
		dependencies.set(graph.hash, imports);
	}

	attachArtifacts(interfaces, dependencies, objects);

	const ordered: ModuleInterface[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function visit(module: ModuleInterface) {
		if (visited.has(module.hash)) return;
		if (visiting.has(module.hash)) throw new Error(`gbm: import cycle at "${module.path}"`);
		visiting.add(module.hash);
		const imports = [...(dependencies.get(module.hash) ?? [])];
		for (const hash of imports) {
			const target = interfaces.get(hash);
			if (!target) throw new Error(`gbm: missing dependency "${hash}"`);
			visit(target);
		}
		visiting.delete(module.hash);
		visited.add(module.hash);
		ordered.push({
			...module,
			dependencies: imports,
		});
	}
	for (const module of interfaces.values()) visit(module);
	return ordered;
}

export interface ModuleBinding {
	initialize(): void;
	dispose(): void;
}

export function initializeModuleBundle(
	bytes: Uint8Array,
	bind: (module: ModuleInterface) => ModuleBinding,
): () => void {
	const modules = resolveModuleInterfaces(bytes);
	const bindings: ModuleBinding[] = [];
	function cleanup(): unknown[] {
		const errors: unknown[] = [];
		for (let binding = bindings.pop(); binding; binding = bindings.pop()) {
			try {
				binding.dispose();
			} catch (error) {
				errors.push(error);
			}
		}
		return errors;
	}
	try {
		for (const module of modules) {
			const binding = bind(module);
			bindings.push(binding);
			binding.initialize();
		}
	} catch (error) {
		const errors = cleanup();
		if (errors.length) throw new AggregateError([error, ...errors], 'Module initialization failed', { cause: error });
		throw error;
	}
	return () => {
		const errors = cleanup();
		if (errors.length) throw new AggregateError(errors, 'Module disposal failed');
	};
}
