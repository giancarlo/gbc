import {
	createModuleGraph, encodeModuleBundle, materializeModuleGraph, ModuleTag,
	type ModuleGraph, type ModuleReference,
} from '@cxl/gbc.sdk';

export { decodeModuleBundle as decodeBundle } from '@cxl/gbc.sdk';
export type { ModuleBundle as DecodedBundle, SerialObject, SerialRef } from '@cxl/gbc.sdk';

import { childNodes, type CompilerAstContext, type Node, type NodeMap } from './node.js';
import type { Symbol, SymbolMap, Type } from './symbol-table.js';
import { streamInlineCandidate } from './semantic.js';
import type { LibraryObject } from './target-wasm.js';

interface EncodedObjectInfo {
	kind?: string;
	name?: string;
	family?: string;
	symbol: boolean;
}

function encodedObjectInfo(entries: [string, unknown][]): EncodedObjectInfo {
	let kind: string | undefined;
	let name: string | undefined;
	let family: string | undefined;
	let flags = false;
	let start = false;
	for (const [key, value] of entries) {
		if (key === 'kind' && typeof value === 'string') kind = value;
		else if (key === 'name' && typeof value === 'string') name = value;
		else if (key === 'family' && typeof value === 'string') family = value;
		else if (key === 'flags' && typeof value === 'number') flags = true;
		else if (key === 'start') start = true;
	}
	return { kind, name, family, symbol: flags && !start };
}

function declaringSymbol(node: Node): Symbol | undefined {
	switch (node.kind) {
		case 'def':
		case 'external':
		case 'fn':
		case 'parameter':
		case 'propdef':
		case 'type':
			return node.symbol;
		default:
			return undefined;
	}
}

function ownersOf(
	modules: { hash: string; root: Node }[],
): Map<object, string> {
	const owner = new Map<object, string>();
	for (const m of modules) {
		const seen = new Set<Node>();
		const walk = (node: Node | undefined): void => {
			if (!node || seen.has(node)) return;
			seen.add(node);
			const symbol = declaringSymbol(node);
			if (symbol) {
				owner.set(symbol, m.hash);
				if (symbol.kind === 'type') owner.set(symbol.type, m.hash);
			}
			if (node.kind === 'extend') {
				const dispatch = node.children[0].symbol;
				if (dispatch.kind === 'function') owner.set(dispatch, m.hash);
			}
			for (const child of childNodes(node)) walk(child);
		};
		walk(m.root);
	}
	return owner;
}

function hasNonScalarEmission(symbol: SymbolMap['function']): boolean {
	const emission = symbol.emissionType;
	return emission?.kind === 'type' && emission.family === 'emission'
		? emission.rest !== undefined || emission.elements.length > 1
		: symbol.returnVariants
			? symbol.returnVariants.length !== 1 ||
				symbol.returnVariants.some(variant => variant.length !== 1)
			: (symbol.returnTypes?.length ?? 0) > 1;
}


function functionBodyRequired(fn: NodeMap['fn']): boolean {
	return (
		hasNonScalarEmission(fn.symbol) ||
		!!fn.symbol.forwardsPipe ||
		(fn.parameters?.length ?? 0) === 0 ||
		streamInlineCandidate(fn)
	);
}

function graphOfModule(
	m: { path: string; hash: string; root: Node },
	owner: Map<object, string>,
	isExternalName: (name: string) => boolean,
	objectSymbols: Set<Symbol>,
): ModuleGraph {
	const bodylessFns = new Set<object>();
	if (m.root.kind === 'root')
		for (const child of m.root.children)
			if (
				child.kind === 'def' &&
				child.value.kind === 'fn' &&
				objectSymbols.has(child.symbol) &&
				!functionBodyRequired(child.value)
			)
				bodylessFns.add(child.value);
	const reference = (o: object, entries: [string, unknown][]): ModuleReference | undefined => {
		const info = encodedObjectInfo(entries);
		const resolvedType = info.kind === 'type' && info.family !== undefined;
		const h = owner.get(o);
		if (h !== undefined && h !== m.hash) {
			if (info.symbol && info.name)
				return {
					t: resolvedType ? ModuleTag.TypeMod : ModuleTag.Mod,
					h,
					s: info.name,
				};
		}
		if (
			h === undefined &&
			info.symbol &&
			info.name &&
			(!resolvedType || (info.family !== 'buffer' && info.family !== 'vector')) &&
			isExternalName(info.name)
		)
			return {
				t: resolvedType ? ModuleTag.TypeExt : ModuleTag.Ext,
				s: info.name,
			};
	};
	return createModuleGraph(m, {
		reference,
		fields(o, entries, node) {
			const info = encodedObjectInfo(entries);
			const kind = info.kind;
			const bodyless = bodylessFns.has(o);
			const serializedFields = entries.filter(
				([key]) =>
					key !== 'scope' &&
					key !== 'references' &&
					!(info.symbol && key === 'definition') &&
					!(bodyless && key === 'statements') &&
					!(
						node &&
						(key === 'source' ||
							key === 'start' ||
							key === 'end' ||
							key === 'line' ||
							key === 'owner' ||
							key === 'implicit')
					),
			);
			if (kind === 'string') {
				const source = entries.find(([key]) => key === 'source')?.[1];
				const start = entries.find(([key]) => key === 'start')?.[1];
				const end = entries.find(([key]) => key === 'end')?.[1];
				if (
					typeof source === 'string' &&
					typeof start === 'number' &&
					typeof end === 'number'
				)
					serializedFields.push(['value', source.slice(start, end)]);
			}
			if (bodyless) serializedFields.push(['objectBacked', true]);
			return bodyless
				? serializedFields.map(([key, value]) => [key, key === 'children' ? [] : value])
				: serializedFields;
		},
	});
}

export function encodeBundle(
	entry: string,
	modules: { path: string; hash: string; root: Node }[],
	isExternalName: (name: string) => boolean,
	objects: LibraryObject[] = [],
	metadata: { test?: string } = {},
): Uint8Array {
	const owner = ownersOf(modules);
	const storable = storableObjects(
		objects,
		owner,
		isExternalName,
		topLevelObjectSymbols(modules),
	);
	const objectSymbols = new Set(storable.map(object => object.sym));
	return encodeModuleBundle({
		entry,
		test: metadata.test,
		modules: new Map(modules.map(m => [m.path, graphOfModule(m, owner, isExternalName, objectSymbols)])),
		objects: storable.map(o => ({
			hash: owner.get(o.sym) ?? '',
			name: o.sym.name ?? '',
			params: o.params,
			results: o.results,
			locals: o.locals,
			code: o.code,
			relocs: o.relocs.map(r => {
				if (r.kind !== 'call' && r.kind !== 'global') return r;
				const ref = refOf(r.sym, owner, isExternalName);
				if (!ref) throw new Error('gbm: unresolved relocation');
				return { kind: r.kind, offset: r.offset, ref };
			}),
		})),
	});
}

function topLevelObjectSymbols(
	modules: { root: Node }[],
): Set<Symbol> {
	const symbols = new Set<Symbol>();
	for (const module of modules) {
		if (module.root.kind !== 'root') continue;
		for (const child of module.root.children)
			if (
				child.kind === 'def' &&
				typeof child.symbol.name === 'string' &&
				child.symbol.name.length > 0
			)
				symbols.add(child.symbol);
	}
	return symbols;
}

function refOf(
	sym: Symbol | Type,
	owner: Map<object, string>,
	isExternalName: (name: string) => boolean,
): { mod?: string; name: string } | null {
	const name = typeof sym.name === 'string' ? sym.name : undefined;
	if (name === undefined) return null;
	const h = owner.get(sym);
	if (h !== undefined) return { mod: h, name };
	if (isExternalName(name)) return { name };
	return null;
}

function storableObjects(
	objects: LibraryObject[],
	owner: Map<object, string>,
	isExternalName: (name: string) => boolean,
	resolvable: Set<Symbol>,
): LibraryObject[] {
	return objects.filter(o => {
		if (!resolvable.has(o.sym) || owner.get(o.sym) === undefined) return false;
		return o.relocs.every(r =>
			r.kind === 'global' || r.kind === 'call'
				? refOf(r.sym, owner, isExternalName) !== null
				: true,
		);
	});
}

export function materializeModule(
	m: ModuleGraph,
	source: string,
	resolveExternalSymbol: (name: string) => Symbol,
	resolveExternalType: (name: string) => Type,
	resolveModSymbol: (hash: string, name: string) => Symbol,
	resolveModType: (hash: string, name: string) => Type,
): Node {
	const { root, nodes } = materializeModuleGraph<CompilerAstContext>(m, source, ref => {
		switch (ref.t) {
			case ModuleTag.Ext:
				return resolveExternalSymbol(ref.s);
			case ModuleTag.TypeExt:
				return resolveExternalType(ref.s);
			case ModuleTag.Mod:
				return resolveModSymbol(ref.h, ref.s);
			case ModuleTag.TypeMod:
				return resolveModType(ref.h, ref.s);
		}
	});
	for (const node of nodes) {
		const symbol = declaringSymbol(node);
		if (symbol) symbol.definition = node;
	}
	return root;
}
