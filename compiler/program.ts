import { CompilerError, ParserApi } from '../sdk/index.js';
import {
	BaseTypes,
	Flags,
	FrameAtIntrinsic,
	FramesIntrinsic,
	OriginIntrinsic,
	ProgramSymbolTable,
	StackIntrinsic,
	TypesSymbolTable,
} from './symbol-table.js';
import { parse } from './parser.js';
import { scan } from './scanner.js';
import { compileTypes } from './compiler-types.js';
import {
	compileWasm,
	setDivByZeroType,
	setTraceTypes,
	type LibraryObject,
	type SpliceInput,
} from './target-wasm.js';
import { checker, setDivByZero } from './checker.js';
import { setRuntimeErrorTypes } from './runtime-errors.js';
import {
	encodeBundle,
	decodeBundle,
	materializeModule,
	type DecodedBundle,
	type SerialObject,
	type SerialRef,
} from './bundle.js';

import type { Node, NodeMap } from './node.js';
import type {
	Scope,
	Symbol,
	SymbolMap,
	Type,
	TypeSymbol,
} from './symbol-table.js';
import type { ModuleLoader, ModuleRef, ParseOptions } from './parser.js';

// Compiler debugging: attach the compiler's own JS stack to a CompilerError.
// Unrelated to gb-code debug builds (see ProgramOptions.debug).
let debugMode = false;
export function setDebug(on: boolean): void {
	debugMode = on;
}

export interface System {
	readFile(path: string): string;
	readBytes(path: string): Uint8Array;
}

/** Pure path join + normalize (`.`/`..` segments) — the compiler runs in
 * hosts without a path module, and the spec suite uses a virtual fs. */
export function resolvePath(baseDir: string, rel: string): string {
	const parts = `${baseDir}/${rel}`.split('/');
	const out: string[] = [];
	for (const part of parts) {
		if (part === '.' || (part === '' && out.length)) continue;
		if (part === '..') {
			out.pop();
			continue;
		}
		out.push(part);
	}
	return out.join('/');
}

function dirName(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/** Content hash for module-closure identity (dedup key, not security). */
function fnv1a(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

type Bundle = DecodedBundle;

export interface ProgramOptions {
	sys?: System;
	maxMemoryPages?: number;
	/** Debug *build* of the compiled gb program: emit shadow-stack
	 * instrumentation so `Error` values capture a call stack. Off by default
	 * (release builds pay no per-call cost). Distinct from `setDebug`, which
	 * debugs the compiler itself. */
	debug?: boolean;
}

export interface ProgramDiagnostic {
	message: string;
	position: {
		source: string;
		start: number;
		end: number;
		line: number;
	};
}

export interface CompileResult {
	ast: NodeMap['root'];
	errors: ProgramDiagnostic[];
	bytes: Uint8Array | undefined;
	hasMain: boolean;
}

interface Module {
	root: NodeMap['root'];
	scope: Scope;
	errors: CompilerError[];
}

function normalizeErrors(errors: CompilerError[]): void {
	const seen = new Set<string>();
	const unique = errors.filter(error => {
		const { source, start, end } = error.position;
		const key = `${source}\0${start}\0${end}\0${error.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	unique.sort(
		(a, b) =>
			a.position.line - b.position.line ||
			a.position.start - b.position.start ||
			a.position.end - b.position.end ||
			a.message.localeCompare(b.message),
	);
	errors.splice(0, errors.length, ...unique);
}

function configureRuntimeErrorTypes(types: Record<string, TypeSymbol>): void {
	setRuntimeErrorTypes({
		IndexOutOfBounds: types.IndexOutOfBounds?.type,
		InvalidCapacity: types.InvalidCapacity?.type,
		NumericOverflow: types.NumericOverflow?.type,
		OutOfMemory: types.OutOfMemory?.type,
	});
}

/**
 * Parse + type-check one module from source, returning its AST root and
 * top-level symbol scope. Has no knowledge of the standard library; it loads
 * every source module through the same module interface.
 */
function loadModule(
	source: string,
	extraSymbols?: Record<string, Symbol>,
	extraTypes?: Record<string, TypeSymbol>,
	parseOptions?: ParseOptions,
	skipCheck = false,
): Module {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	if (extraSymbols) symbolTable.setSymbols(extraSymbols);
	if (extraTypes) typesTable.setSymbols(extraTypes);
	const api = ParserApi(scan);
	api.start(source);
	const scope = symbolTable.push();
	const typeScope = typesTable.push();
	const root = parse(api, symbolTable, typesTable, parseOptions);
	const module = { root, scope, errors: api.errors };
	if (!api.errors.length && !skipCheck)
		checker({ root, errors: api.errors }).run();
	normalizeErrors(api.errors);
	typesTable.pop(typeScope);
	symbolTable.pop(scope);
	return module;
}

function withoutStdlibTypes<T>(fn: () => T): T {
	const intrinsicStates = [
		OriginIntrinsic,
		FramesIntrinsic,
		FrameAtIntrinsic,
		StackIntrinsic,
	].map(intrinsic => ({
		intrinsic,
		parameterType: intrinsic.parameters?.[0]?.type,
		returnType: intrinsic.returnType,
	}));
	for (const { intrinsic } of intrinsicStates) {
		const parameter = intrinsic.parameters?.[0];
		if (parameter) parameter.type = undefined;
		intrinsic.returnType = undefined;
	}
	FramesIntrinsic.returnType = BaseTypes.Int32;
	setDivByZero(undefined);
	setRuntimeErrorTypes({});
	try {
		return fn();
	} finally {
		for (const { intrinsic, parameterType, returnType } of intrinsicStates) {
			const parameter = intrinsic.parameters?.[0];
			if (parameter) parameter.type = parameterType;
			intrinsic.returnType = returnType;
		}
		setDivByZero(stdlibEntryTypes['DivByZero']?.type);
		configureRuntimeErrorTypes(stdlibEntryTypes);
	}
}

export function buildStdlibBundle(
	entryPath: string,
	testPath: string,
	sys: System,
): Uint8Array {
	const builtinNames = new Set<string>();
	for (const table of [
		ProgramSymbolTable().globalScope,
		TypesSymbolTable().globalScope,
	])
		for (const name of table.keys())
			if (typeof name === 'string') builtinNames.add(name);

	return withoutStdlibTypes(() => {
		const baseSymbols: Record<string, Symbol> = {};
		const baseTypes: Record<string, TypeSymbol> = {};
		const { loadLibraryEntry, loadedModules, moduleDefs, sourcePaths } =
			createModuleLoader(
				sys,
				dirName(entryPath),
				baseSymbols,
				baseTypes,
			);
		const entry = loadLibraryEntry(entryPath);
		Object.assign(baseSymbols, collectDefs(entry.module).symbols);
		Object.assign(baseTypes, collectTypes(entry.module));
		loadLibraryEntry(testPath);
		const objects: LibraryObject[] = [];
		compileWasm({
			root: {
				kind: 'root',
				children: moduleDefs,
				start: 0,
				end: 0,
				line: 0,
				source: '',
			},
			sourcePaths,
			objectSink: objects,
		});
		const base = dirName(entryPath);
		const relative = (path: string) =>
			base && path.startsWith(`${base}/`)
				? path.slice(base.length + 1)
				: path;
		return encodeBundle(
			relative(entryPath),
			loadedModules.map(module => ({
				...module,
				path: relative(module.path),
			})),
			name => builtinNames.has(name),
			objects,
			{ test: relative(testPath) },
		);
	});
}

/**
 * The program's module loader. `@.seg.seg` resolves relative to the
 * importing file within the same unit (same import map); `@name` crosses
 * into a library through the current unit's map, and the library's own
 * `#importmap` (if any) starts a fresh unit — libraries never see the
 * program's map, which is what keeps them dependency-free for consumers.
 * Module identity is the resolved path; cycles are an error.
 */
function createModuleLoader(
	sys: System,
	entryDir: string,
	baseSymbols: Record<string, Symbol> = stdlibEntrySymbols,
	baseTypes: Record<string, TypeSymbol> = stdlibEntryTypes,
) {
	type Loaded = {
		module: Module;
		symbol: SymbolMap['variable'];
		exports: Record<string, Symbol>;
		types: Record<string, TypeSymbol>;
		hash: string;
		root: NodeMap['root'];
	};
	const cache = new Map<string, Loaded>();
	// Closure-hash identity: a second module with the same hash (two
	// libraries vendoring the same code) dedupes to one instance — before
	// it is even parsed when the hash arrives via a bundle manifest. This
	// also unifies the nominal types the copies define.
	const hashCache = new Map<string, Loaded>();
	const loading = new Set<string>();
	const loadedModules: { path: string; hash: string; root: NodeMap['root'] }[] =
		[];
	const registry = new Map<
		string,
		{
			exports: Record<string, Symbol>;
			types: Record<string, TypeSymbol>;
			all: Record<string, Symbol>;
		}
	>();
	function resolveModSymbol(hash: string, name: string): Symbol {
		const r = registry.get(hash);
		const s = r && (r.exports[name] ?? r.types[name]);
		if (!s)
			throw new Error(
				`bundle references "${name}" from an unloaded module ${hash}`,
			);
		return s;
	}
	function resolveModType(hash: string, name: string): Type {
		const type = registry.get(hash)?.types[name]?.type;
		if (!type)
			throw new Error(
				`bundle references type "${name}" from an unloaded module ${hash}`,
			);
		return type;
	}
	const bundleObjects: SerialObject[] = [];
	function resolveObjRef(ref: SerialRef): Symbol | undefined {
		if (ref.mod !== undefined)
			return registry.get(ref.mod)?.all[ref.name] ?? undefined;
		return baseSymbols[ref.name] ?? builtinSymbols.get(ref.name);
	}
	const moduleDefs: (NodeMap['def'] | NodeMap['extend'])[] = [];
	/** Module source text → display path, for error-trace `Frame.file`. */
	const sourcePaths = new Map<string, string>();
	const displayPath = (p: string) =>
		entryDir && p.startsWith(`${entryDir}/`)
			? p.slice(entryDir.length + 1)
			: p.replace(/^\//, '');
	type Ctx = {
		dir: string;
		map: Record<string, string>;
		entry: boolean;
		bundle?: Bundle;
		/** Resolved .gbm path — cache-key namespace for bundle-internal paths. */
		bundleId?: string;
		childHashes: string[];
	};
	const ctxStack: Ctx[] = [
		{ dir: entryDir, map: {}, entry: true, childHashes: [] },
	];
	const cur = () => ctxStack[ctxStack.length - 1];

	function readSource(path: string): string {
		try {
			return sys.readFile(path);
		} catch {
			throw new Error(`cannot read module "${path}"`);
		}
	}

	function loadPath(
		c: Ctx,
		path: string,
		refName: string,
		entersLibrary: boolean,
		bundle: Bundle | undefined,
		bundleId?: string,
	): Loaded {
		const inBundleId = bundleId ?? (bundle ? undefined : c.bundleId);
		const key = inBundleId ? `gbm:${inBundleId}!${path}` : path;
		const hit = cache.get(key);
		if (hit) {
			c.childHashes.push(hit.hash);
			return hit;
		}
		// Assembly fast path: a bundle manifest carries the closure hash, so
		// an already-loaded identical module skips read+parse entirely.
		const bundleMod = (bundle ?? c.bundle)?.modules.get(path);
		const manifestHash = bundleMod?.hash;
		if (manifestHash) {
			const same = hashCache.get(manifestHash);
			if (same) {
				cache.set(key, same);
				c.childHashes.push(same.hash);
				return same;
			}
		}
		if (loading.has(key))
			throw new Error(`import cycle: "${path}" is already being loaded`);
		loading.add(key);
		const childCtx: Ctx = {
			dir: dirName(path),
			map: entersLibrary ? {} : c.map,
			entry: entersLibrary,
			bundle: bundle ?? c.bundle,
			bundleId: inBundleId,
			childHashes: [],
		};
		try {
			let mod: Module;
			let src: string;
			if (bundleMod) {
				const root = materializeModule(
					bundleMod,
					key,
					resolveExternalSymbol,
					resolveExternalType,
					resolveModSymbol,
					resolveModType,
				);
				if (root.kind !== 'root')
					throw new Error(`bundle module "${path}" is not a root`);
				src = root.source;
				mod = { root, scope: new Map(), errors: [] };
			} else {
				src = readSource(path);
				ctxStack.push(childCtx);
				try {
					mod = loadModule(src, baseSymbols, baseTypes, {
						loader,
						module: true,
					});
				} finally {
					ctxStack.pop();
				}
			}
			sourcePaths.set(src, displayPath(path));
			const first = mod.errors[0];
			if (first)
				throw new Error(
					`module "${path}" line ${first.position.line + 1}: ${first.message}`,
				);
			const hash =
				manifestHash ??
				fnv1a(`${src}\0${childCtx.childHashes.join(',')}`);
			const dedup = hashCache.get(hash);
			if (dedup) {
				cache.set(key, dedup);
				c.childHashes.push(hash);
				return dedup;
			}
			const { symbols, defs } = collectDefs(mod);
			moduleDefs.push(...defs);
			const exports: Record<string, Symbol> = {};
			for (const [k, sym] of Object.entries(symbols))
				if (sym.flags & Flags.Export) exports[k] = sym;
			const types: Record<string, TypeSymbol> = {};
			for (const [k, t] of Object.entries(collectTypes(mod)))
				if (t.flags & Flags.Export) types[k] = t;
			const symbol: SymbolMap['variable'] = {
				kind: 'variable',
				name: refName,
				flags: Flags.Module,
				type: {
					kind: 'type',
					flags: 0,
					name: refName,
					family: 'data',
					size: 4,
					members: Object.fromEntries(
						Object.entries(exports).map(
							([name, member]): [string, Symbol] => {
								if (member.kind !== 'function') return [name, member];
								const binding: SymbolMap['variable'] = {
									kind: 'variable',
									name,
									flags: 0,
									type: member,
								};
								return [name, binding];
							},
						),
					),
				},
			};
			const loaded: Loaded = {
				module: mod,
				symbol,
				exports,
				types,
				hash,
				root: mod.root,
			};
			loadedModules.push({ path, hash, root: mod.root });
			registry.set(hash, { exports, types, all: symbols });
			cache.set(key, loaded);
			hashCache.set(hash, loaded);
			c.childHashes.push(hash);
			return loaded;
		} finally {
			loading.delete(key);
		}
	}

	const loader: ModuleLoader = {
		setMap(entries) {
			const c = cur();
			if (!c) return;
			if (!c.entry)
				throw new Error(
					'`#importmap` belongs to an entry file — a program or library entry, not an imported module',
				);
			for (const e of entries) c.map[e.name] = e.path;
		},
		load(ref: ModuleRef) {
			const c = cur();
			if (!c) throw new Error('module loader has no context');
			const refName = `@${ref.dot ? '.' : ''}${ref.segs.join('.')}`;
			if (ref.dot) {
				const path = c.bundle
					? resolvePath(c.dir, `${ref.segs.join('/')}.gb`).replace(
							/^\//,
							'',
						)
					: resolvePath(c.dir, `${ref.segs.join('/')}.gb`);
				return loadPath(c, path, refName, false, undefined);
			}
			const name = ref.segs[0] ?? '';
			if (ref.segs.length !== 1)
				throw new Error(
					`a library reference is a single mapped name — bind "@${name}" and use member access`,
				);
			const mapped = c.map[name];
			if (!mapped)
				throw new Error(
					`"@${name}" is not in the import map — add \`@${name} = '<path>';\` to the entry's #importmap`,
				);
			if (mapped.endsWith('.gbm')) {
				const bundlePath = resolvePath(c.dir, mapped);
				let bytes: Uint8Array;
				try {
					bytes = sys.readBytes(bundlePath);
				} catch {
					throw new Error(`cannot read bundle "${bundlePath}"`);
				}
				const bundle = decodeBundle(bytes);
				bundleObjects.push(...bundle.objects);
				let entryLoaded: Loaded | undefined;
				for (const modPath of bundle.modules.keys()) {
					const isEntry = modPath === bundle.entry;
					const loaded = loadPath(
						c,
						modPath,
						isEntry ? refName : `@${modPath}`,
						isEntry,
						bundle,
						bundlePath,
					);
					if (isEntry) entryLoaded = loaded;
				}
				if (!entryLoaded)
					throw new Error(
						`bundle "${bundlePath}" has no entry module`,
					);
				return entryLoaded;
			}
			return loadPath(c, resolvePath(c.dir, mapped), refName, true, undefined);
		},
	};

	/** `gbc library`: load a file as a library entry (own map unit, no
	 * `main`) so its whole closure validates. */
	function loadLibraryEntry(path: string): Loaded {
		const c = cur();
		if (!c) throw new Error('module loader has no context');
		return loadPath(c, path, `@${path}`, true, undefined);
	}

	function spliceInput(): SpliceInput | undefined {
		if (!bundleObjects.length) return undefined;
		const objects = new Map<Symbol, SerialObject>();
		for (const o of bundleObjects) {
			const sym = registry.get(o.hash)?.all[o.name];
			if (sym) objects.set(sym, o);
		}
		return { objects, resolveRef: resolveObjRef };
	}

	return {
		loader,
		moduleDefs,
		loadLibraryEntry,
		loadedModules,
		spliceInput,
		cache,
		sourcePaths,
	};
}

// Definitions from the standard-library entry are global. Imported modules
// remain namespaced and are resolved through their module bindings.
function collectDefs(module: Module): {
	symbols: Record<string, Symbol>;
	defs: (NodeMap['def'] | NodeMap['extend'])[];
} {
	const symbols: Record<string, Symbol> = {};
	const defs: (NodeMap['def'] | NodeMap['extend'])[] = [];
	for (const child of module.root.children) {
		if (child.kind === 'external') {
			if (child.symbol.flags & Flags.Export && child.symbol.name)
				symbols[child.symbol.name] = child.symbol;
			continue;
		}
		if (child.kind === 'extend') {
			defs.push(child);
			const target = child.children[0].symbol;
			const name = target.name;
			if (name && target.kind === 'function') symbols[name] = target;
			continue;
		}
		if (
			child.kind === 'def' &&
			(child.value.kind === 'fn' ||
				child.value.kind === '|' ||
				child.value.kind === 'data')
		) {
			if (child.symbol.name) symbols[child.symbol.name] = child.symbol;
			defs.push(child);
		} else if (
			child.kind === 'def' &&
			child.symbol.name &&
			child.symbol.flags & Flags.Export
		) {
			symbols[child.symbol.name] = child.symbol;
			if (!(child.symbol.flags & Flags.Module))
				defs.push(child);
		}
	}
	return { symbols, defs };
}

function collectTypes(module: Module): Record<string, TypeSymbol> {
	const types: Record<string, TypeSymbol> = {};
	for (const child of module.root.children) {
		if (child.kind !== 'type') continue;
		const sym = child.symbol;
		if (sym.kind === 'type' && sym.name)
			types[sym.name] = sym;
	}
	return types;
}

function collectExports(module: Module): {
	symbols: Record<string, Symbol>;
	types: Record<string, TypeSymbol>;
	defs: (NodeMap['def'] | NodeMap['extend'])[];
} {
	const collected = collectDefs(module);
	const extensions = new Set(
		collected.defs.flatMap(definition =>
			definition.kind === 'extend' &&
			definition.children[0].symbol.kind === 'function' &&
			definition.children[0].symbol.name
				? [definition.children[0].symbol.name]
				: [],
		),
	);
	return {
		symbols: Object.fromEntries(
			Object.entries(collected.symbols).filter(
				([name, symbol]) =>
					!!(symbol.flags & Flags.Export) || extensions.has(name),
			),
		),
		types: Object.fromEntries(
			Object.entries(collectTypes(module)).filter(
				([, symbol]) => !!(symbol.flags & Flags.Export),
			),
		),
		defs: collected.defs,
	};
}

interface MaterializedModules {
	entry: string;
	test?: string;
	modules: Map<string, Module>;
	splice?: SpliceInput;
}

function materializeModules(
	bytes: Uint8Array,
	extraSymbols: Record<string, Symbol> = {},
	extraTypes: Record<string, TypeSymbol> = {},
): MaterializedModules {
	const bundle = decodeBundle(bytes);
	const builtinSymbols = ProgramSymbolTable().globalScope;
	const builtinTypes = TypesSymbolTable().globalScope;
	const registry = new Map<
		string,
		{
			symbols: Record<string, Symbol>;
			types: Record<string, TypeSymbol>;
		}
	>();
	const modules = new Map<string, Module>();
	for (const [path, encoded] of bundle.modules) {
		const root = materializeModule(
			encoded,
			path,
			name => {
				const symbol =
					extraSymbols[name] ??
					extraTypes[name] ??
					builtinSymbols.get(name) ??
					builtinTypes.get(name);
				if (!symbol)
					throw new Error(`stdlib bundle references unknown symbol "${name}"`);
				return symbol;
			},
			name => {
				const type = extraTypes[name]?.type ?? builtinTypes.get(name)?.type;
				if (!type)
					throw new Error(`stdlib bundle references unknown type "${name}"`);
				return type;
			},
			(hash, name) => {
				const module = registry.get(hash);
				const symbol = module?.symbols[name] ?? module?.types[name];
				if (!symbol)
					throw new Error(`stdlib bundle references unknown module symbol "${name}"`);
				return symbol;
			},
			(hash, name) => {
				const type = registry.get(hash)?.types[name]?.type;
				if (!type)
					throw new Error(`stdlib bundle references unknown module type "${name}"`);
				return type;
			},
		);
		if (root.kind !== 'root') throw new Error('stdlib bundle root is not a root');
		const module = { root, scope: new Map(), errors: [] };
		registry.set(encoded.hash, {
			symbols: collectDefs(module).symbols,
			types: collectTypes(module),
		});
		modules.set(path, module);
	}
	if (!modules.has(bundle.entry)) throw new Error('stdlib bundle has no entry module');
	const objects = new Map<Symbol, SerialObject>();
	for (const object of bundle.objects) {
		if (!object.name) continue;
		const symbol = registry.get(object.hash)?.symbols[object.name];
		if (symbol) objects.set(symbol, object);
	}
	const resolveRef = (ref: SerialRef): Symbol | undefined => {
		if (ref.mod !== undefined)
			return registry.get(ref.mod)?.symbols[ref.name];
		return (
			extraSymbols[ref.name] ??
			extraTypes[ref.name] ??
			builtinSymbols.get(ref.name) ??
			builtinTypes.get(ref.name)
		);
	};
	return {
		entry: bundle.entry,
		test: bundle.test,
		modules,
		splice: objects.size ? { objects, resolveRef } : undefined,
	};
}

const builtinSymbols = ProgramSymbolTable().globalScope;
const builtinTypes = TypesSymbolTable().globalScope;
let stdlibEntrySymbols: Record<string, Symbol> = {};
let stdlibEntryTypes: Record<string, TypeSymbol> = {};
let stdlibSymbols: Record<string, Symbol> = {};
let stdlibTypes: Record<string, TypeSymbol> = {};
let testSymbols: Record<string, Symbol> = {};
let testTypes: Record<string, TypeSymbol> = {};
let stdlibDefs: (NodeMap['def'] | NodeMap['extend'])[] = [];
let testDefs: (NodeMap['def'] | NodeMap['extend'])[] = [];
let stdlibSplice: SpliceInput | undefined;
let externalNames = new Set<string>();
let initialized = false;

function collectStdlibModules(
	modules: Map<string, Module>,
	test: Module,
): void {
	stdlibSymbols = {};
	stdlibTypes = {};
	stdlibDefs = [];
	testSymbols = {};
	testTypes = {};
	testDefs = [];
	for (const module of modules.values()) {
		const collected = collectDefs(module);
		Object.assign(stdlibSymbols, collected.symbols);
		Object.assign(stdlibTypes, collectTypes(module));
		if (module === test) {
			const exports = collectExports(module);
			testSymbols = exports.symbols;
			testTypes = exports.types;
			testDefs = collected.defs;
		} else stdlibDefs.push(...collected.defs);
	}
}

function initializeStdlib(bytes: Uint8Array): void {
	const materialized = materializeModules(bytes);
	const { entry, test: testEntry, modules } = materialized;
	stdlibSplice = materialized.splice;
	const index = modules.get(entry);
	if (!index) throw new Error('stdlib bundle has no entry module');
	const test = testEntry ? modules.get(testEntry) : undefined;
	if (!test) throw new Error('stdlib bundle has no test entry');
	const indexExports = collectExports(index);
	stdlibEntrySymbols = {
		...collectDefs(index).symbols,
		...indexExports.symbols,
	};
	stdlibEntryTypes = {
		...collectTypes(index),
		...indexExports.types,
	};
	collectStdlibModules(modules, test);
	setDivByZero(stdlibEntryTypes['DivByZero']?.type);
	setDivByZeroType(stdlibEntryTypes['DivByZero']?.type);
	configureRuntimeErrorTypes(stdlibEntryTypes);
	setTraceTypes(BaseTypes.Trace, stdlibEntryTypes['Frame']?.type);
	const errorType = stdlibEntryTypes['Error']?.type;
	const frameType = stdlibEntryTypes['Frame']?.type;
	for (const intrinsic of [
		OriginIntrinsic,
		FramesIntrinsic,
		FrameAtIntrinsic,
		StackIntrinsic,
	]) {
		const parameter = intrinsic.parameters?.[0];
		if (parameter) parameter.type = errorType;
	}
	const indexParameter = FrameAtIntrinsic.parameters?.[1];
	if (indexParameter) indexParameter.type = BaseTypes.Int32;
	OriginIntrinsic.returnType = frameType;
	FrameAtIntrinsic.returnType = frameType;
	StackIntrinsic.returnType =
		frameType?.kind === 'type' && frameType.family === 'data'
			? {
					kind: 'type',
					flags: 0,
					name: '__frames',
					family: 'buffer',
					size: 16,
					elem: frameType,
				}
			: undefined;
	FramesIntrinsic.returnType = BaseTypes.Int32;

	externalNames = new Set<string>();
	for (const table of [builtinSymbols, builtinTypes])
		for (const name of table.keys())
			if (typeof name === 'string') externalNames.add(name);
	for (const record of [stdlibSymbols, stdlibTypes])
		for (const name of Object.keys(record)) externalNames.add(name);
	initialized = true;
}

export interface Compiler {
	Program: typeof Program;
}

export function createCompiler(stdlib: Uint8Array): Compiler {
	initializeStdlib(stdlib);
	return { Program };
}

export async function loadCompiler(
	loadStdlib: () => Promise<Uint8Array>,
): Promise<Compiler> {
	return createCompiler(await loadStdlib());
}
function resolveExternalSymbol(name: string): Symbol {
	const s =
		stdlibEntrySymbols[name] ??
		stdlibSymbols[name] ??
		builtinSymbols.get(name) ??
		stdlibEntryTypes[name] ??
		builtinTypes.get(name);
	if (!s) throw new Error(`bundle references unknown external "${name}"`);
	return s;
}

function resolveExternalType(name: string): Type {
	const type =
		stdlibEntryTypes[name]?.type ??
		stdlibTypes[name]?.type ??
		builtinTypes.get(name)?.type;
	if (!type) throw new Error(`bundle references unknown external type "${name}"`);
	return type;
}

function withStdlib(
	root: Node,
	testMode = false,
	moduleDefs: (NodeMap['def'] | NodeMap['extend'])[] = [],
): Node {
	if (root.kind !== 'root') return root;
	const head = [
		...stdlibDefs,
		...moduleDefs,
		...(testMode ? testDefs : []),
	];
	if (head.length === 0) return root;
	return { ...root, children: [...head, ...root.children] };
}

function withStdlibSplice(splice: SpliceInput | undefined): SpliceInput | undefined {
	if (!stdlibSplice) return splice;
	if (!splice) return stdlibSplice;
	return {
		objects: new Map([...stdlibSplice.objects, ...splice.objects]),
		resolveRef: ref =>
			splice.resolveRef(ref) ?? stdlibSplice?.resolveRef(ref),
	};
}

export function Program(options?: ProgramOptions) {
	if (!initialized)
		throw new Error('compiler is not initialized; call loadCompiler first');
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);
	symbolTable.setSymbols(stdlibEntrySymbols);
	typesTable.setSymbols(stdlibEntryTypes);

	function parser(src: string, parseOptions?: ParseOptions) {
		api.start(src);
		const scope = symbolTable.push();
		const typeScope = typesTable.push();
		const root = parse(api, symbolTable, typesTable, {
			...parseOptions,
			testSymbols,
			testTypes,
		});
		typesTable.pop(typeScope);
		symbolTable.pop(scope);
		return { root, scope, errors: api.errors };
	}

	function compileMode(
		src: string,
		testMode = false,
		modeOptions: {
			requireMain?: boolean;
			loader?: ModuleLoader;
			moduleDefs?: (NodeMap['def'] | NodeMap['extend'])[];
			sourcePaths?: Map<string, string>;
			splice?: () => SpliceInput | undefined;
		} = {},
	): CompileResult {
		const requireMain = modeOptions.requireMain ?? true;
		const parsed = parser(src, { loader: modeOptions.loader });
		checker(parsed).run();
		const hasMain = parsed.root.children.some(c => c.kind === 'main');
		if (!testMode && requireMain && !hasMain && parsed.errors.length === 0)
			parsed.errors.push(
				new CompilerError('a program requires a `main` block', parsed.root),
			);
		// Main-less builds export the entry's own exported fns to the host
		// (test mode synthesizes its own main from the #test blocks).
		const hostExports = hasMain || testMode
			? undefined
			: parsed.root.children.filter(
					(c): c is NodeMap['def'] =>
						c.kind === 'def' && !!(c.symbol.flags & Flags.Export),
				);
		let bytes: Uint8Array | undefined;
		if (parsed.errors.length === 0) {
			try {
				bytes = compileWasm({
					root: withStdlib(parsed.root, testMode, modeOptions.moduleDefs),
					testMode,
					debugBuild: !!options?.debug,
					hostExports,
					sourcePaths: modeOptions.sourcePaths,
					splice: withStdlibSplice(modeOptions.splice?.()),
					maxMemoryPages: options?.maxMemoryPages,
				});
			} catch (e) {
				if (e instanceof CompilerError) parsed.errors.push(e);
				else if (e instanceof Error) {
					const ce = new CompilerError(e.message, parsed.root);
					if (debugMode) ce.stack = e.stack;
					parsed.errors.push(ce);
				} else throw e;
			}
		}
		normalizeErrors(parsed.errors);
		return {
			ast: parsed.root,
			errors: parsed.errors,
			bytes,
			hasMain,
		};
	}

	function compile(src: string) {
		return compileMode(src);
	}

	function compileTest(src: string) {
		return compileMode(src, true);
	}

	function buildLibrary(path: string) {
		const sys = options?.sys;
		if (!sys) throw new Error('buildLibrary requires ProgramOptions.sys');
		const { loadLibraryEntry, loadedModules, moduleDefs, sourcePaths } =
			createModuleLoader(sys, dirName(path));
		try {
			loadLibraryEntry(path);
		} catch (e) {
			return {
				bundle: undefined,
				errors: [
					new CompilerError(
						e instanceof Error ? e.message : String(e),
						{ start: 0, end: 0, line: 0, source: '' },
					),
				],
			};
		}
		const base = dirName(path);
		const rel = (p: string) =>
			base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
		const objects: LibraryObject[] = [];
		const strip = (root: NodeMap['root']): NodeMap['root'] => ({
			...root,
			children: root.children.filter(c => c.kind !== 'test'),
		});
		const collectObjects = (root: Node): void => {
			compileWasm({
				root,
				sourcePaths,
				objectSink: objects,
			});
		};
		try {
			const emptyRoot: NodeMap['root'] = {
				kind: 'root',
				children: [],
				start: 0,
				end: 0,
				line: 0,
				source: '',
			};
			collectObjects(withStdlib(emptyRoot, false, moduleDefs));
		} catch {
			objects.length = 0;
			try {
				collectObjects({
					kind: 'root',
					children: moduleDefs,
					start: 0,
					end: 0,
					line: 0,
					source: '',
				});
			} catch {
				objects.length = 0;
			}
		}
		const bundle = encodeBundle(
			rel(path),
			loadedModules.map(m => ({
				path: rel(m.path),
				hash: m.hash,
				root: strip(m.root),
			})),
			name => externalNames.has(name),
			objects,
		);
		return { bundle, errors: [] };
	}

	/**
	 * Module-aware compile: reads the entry via `options.sys`, loads its
	 * imports (parse-time binding), and fuses everything into one wasm.
	 * With `main` the result is a program; without, an exports-only module
	 * whose top-level inits run in the wasm start section.
	 */
	function compileFile(
		path: string,
		fileOptions: { requireMain?: boolean; testMode?: boolean } = {},
	) {
		const sys = options?.sys;
		if (!sys) throw new Error('compileFile requires ProgramOptions.sys');
		const src = sys.readFile(path);
		const { loader, moduleDefs, sourcePaths, spliceInput } =
			createModuleLoader(sys, dirName(path));
		return compileMode(src, fileOptions.testMode ?? false, {
			requireMain: fileOptions.requireMain ?? false,
			loader,
			moduleDefs,
			sourcePaths,
			splice: spliceInput,
		});
	}

	function compileAst(root: Node, testMode = false): Uint8Array {
		return compileWasm({
			root: withStdlib(root, testMode),
			testMode,
			debugBuild: !!options?.debug,
			splice: withStdlibSplice(undefined),
			maxMemoryPages: options?.maxMemoryPages,
		});
	}

	return {
		compile,
		compileTest,
		compileFile,
		buildLibrary,
		compileAst,
		compileTypes,
		options,
		parse: parser,
		symbolTable,
	};
}
