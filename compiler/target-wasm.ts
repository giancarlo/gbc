import { sleb128, text, uleb128 } from '../sdk/index.js';

import { reduceType } from './checker.js';
import { BaseTypes, Flags } from './symbol-table.js';

import type { Node, NodeMap } from './node.js';
import type {
	Symbol as GbcSymbol,
	SymbolMap,
	Type,
	TypeFamily,
} from './symbol-table.js';

type ValueType = SymbolMap['type'] & {
	family: Exclude<TypeFamily, 'void' | 'unknown'>;
};

function hasRuntimeValue(t: Type): t is ValueType {
	return t.kind === 'type' && t.family !== 'void' && t.family !== 'unknown';
}

declare class TextEncoder {
	constructor();
	encode(data: string): Uint8Array;
}

// WASM value type codes
const I32 = 0x7f;
const I64 = 0x7e;
const F32 = 0x7d;
const F64 = 0x7c;

const SEC_TYPE = 1;
const SEC_IMPORT = 2;
const SEC_FUNCTION = 3;
const SEC_MEMORY = 5;
const SEC_GLOBAL = 6;
const SEC_EXPORT = 7;
const SEC_CODE = 10;
const SEC_DATA = 11;

const EXTERNAL_FUNC = 0;
const EXTERNAL_MEMORY = 2;

const OP_BLOCK = 0x02;
const OP_LOOP = 0x03;
const OP_IF = 0x04;
const OP_ELSE = 0x05;
const OP_END = 0x0b;
const OP_BR = 0x0c;
const OP_RETURN = 0x0f;
const OP_CALL = 0x10;
const OP_DROP = 0x1a;
const OP_LOCAL_GET = 0x20;
const OP_LOCAL_SET = 0x21;
const OP_LOCAL_TEE = 0x22;
const OP_GLOBAL_GET = 0x23;
const OP_GLOBAL_SET = 0x24;

const OP_I32_LOAD = 0x28;
const OP_F64_LOAD = 0x2b;
const OP_I32_STORE = 0x36;
const OP_F64_STORE = 0x39;

const OP_I32_CONST = 0x41;
const OP_F64_CONST = 0x44;

const OP_I32_EQZ = 0x45;
const OP_I32_EQ = 0x46;
const OP_I32_NE = 0x47;
const OP_I32_LT_S = 0x48;
const OP_I32_GT_S = 0x4a;
const OP_I32_LE_S = 0x4c;
const OP_I32_GE_S = 0x4e;

const OP_F64_EQ = 0x61;
const OP_F64_NE = 0x62;
const OP_F64_LT = 0x63;
const OP_F64_GT = 0x64;
const OP_F64_LE = 0x65;
const OP_F64_GE = 0x66;

const OP_I32_ADD = 0x6a;
const OP_I32_SUB = 0x6b;
const OP_I32_MUL = 0x6c;
const OP_I32_DIV_S = 0x6d;
const OP_I32_AND = 0x71;
const OP_I32_OR = 0x72;
const OP_I32_XOR = 0x73;
const OP_I32_SHL = 0x74;
const OP_I32_SHR_S = 0x75;

const OP_F64_ADD = 0xa0;
const OP_F64_SUB = 0xa1;
const OP_F64_MUL = 0xa2;
const OP_F64_DIV = 0xa3;
const OP_F64_NEG = 0x9a;

const OP_F64_CONVERT_I32_S = 0xb7;

function name(s: string, out: number[]) {
	const bytes = new TextEncoder().encode(s);
	uleb128(bytes.length, out);
	for (const b of bytes) out.push(b);
}

function section(id: number, payload: number[], out: number[]) {
	out.push(id);
	uleb128(payload.length, out);
	for (const b of payload) out.push(b);
}

function u32le(n: number, out: number[]) {
	out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function f64le(n: number, out: number[]) {
	const buf = new ArrayBuffer(8);
	new DataView(buf).setFloat64(0, n, true);
	const bytes = new Uint8Array(buf);
	for (const b of bytes) out.push(b);
}

interface ModuleType {
	params: number[];
	results: number[];
}

interface ModuleImport {
	mod: string;
	field: string;
	typeIdx: number;
}

interface ModuleFunction {
	typeIdx: number;
	body: number[];
	/** Extra locals declared after parameters, listed individually (one entry per local). */
	locals: number[];
}

interface ModuleData {
	offset: number;
	bytes: number[];
}

interface ModuleExport {
	name: string;
	kind: number;
	idx: number;
}

interface ModuleGlobal {
	type: number;
	mutable: boolean;
	init: number[];
}

interface Module {
	imports: ModuleImport[];
	types: ModuleType[];
	functions: ModuleFunction[];
	globals: ModuleGlobal[];
	datas: ModuleData[];
	exports: ModuleExport[];
	memoryPages: number;
}

function emitTypesSection(m: Module, out: number[]) {
	if (!m.types.length) return;
	const payload: number[] = [];
	uleb128(m.types.length, payload);
	for (const t of m.types) {
		payload.push(0x60);
		uleb128(t.params.length, payload);
		for (const p of t.params) payload.push(p);
		uleb128(t.results.length, payload);
		for (const r of t.results) payload.push(r);
	}
	section(SEC_TYPE, payload, out);
}

function emitImportsSection(m: Module, out: number[]) {
	if (!m.imports.length) return;
	const payload: number[] = [];
	uleb128(m.imports.length, payload);
	for (const im of m.imports) {
		name(im.mod, payload);
		name(im.field, payload);
		payload.push(EXTERNAL_FUNC);
		uleb128(im.typeIdx, payload);
	}
	section(SEC_IMPORT, payload, out);
}

function emitGlobalsSection(m: Module, out: number[]) {
	if (!m.globals.length) return;
	const payload: number[] = [];
	uleb128(m.globals.length, payload);
	for (const g of m.globals) {
		payload.push(g.type);
		payload.push(g.mutable ? 1 : 0);
		for (const b of g.init) payload.push(b);
		payload.push(OP_END);
	}
	section(SEC_GLOBAL, payload, out);
}

function emitExportsSection(m: Module, out: number[]) {
	if (!m.exports.length) return;
	const payload: number[] = [];
	uleb128(m.exports.length, payload);
	for (const e of m.exports) {
		name(e.name, payload);
		payload.push(e.kind);
		uleb128(e.idx, payload);
	}
	section(SEC_EXPORT, payload, out);
}

function emitCodeSection(m: Module, out: number[]) {
	if (!m.functions.length) return;
	const payload: number[] = [];
	uleb128(m.functions.length, payload);
	for (const f of m.functions) {
		const body: number[] = [];
		const groups: { count: number; type: number }[] = [];
		for (const t of f.locals) {
			const last = groups[groups.length - 1];
			if (last?.type === t) last.count++;
			else groups.push({ count: 1, type: t });
		}
		uleb128(groups.length, body);
		for (const g of groups) {
			uleb128(g.count, body);
			body.push(g.type);
		}
		for (const b of f.body) body.push(b);
		body.push(OP_END);
		uleb128(body.length, payload);
		for (const b of body) payload.push(b);
	}
	section(SEC_CODE, payload, out);
}

function emitDataSection(m: Module, out: number[]) {
	if (!m.datas.length) return;
	const payload: number[] = [];
	uleb128(m.datas.length, payload);
	for (const d of m.datas) {
		payload.push(0x00);
		payload.push(OP_I32_CONST);
		sleb128(d.offset, payload);
		payload.push(OP_END);
		uleb128(d.bytes.length, payload);
		for (const b of d.bytes) payload.push(b);
	}
	section(SEC_DATA, payload, out);
}

function emitModule(m: Module): Uint8Array {
	const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

	emitTypesSection(m, out);
	emitImportsSection(m, out);

	if (m.functions.length) {
		const payload: number[] = [];
		uleb128(m.functions.length, payload);
		for (const f of m.functions) uleb128(f.typeIdx, payload);
		section(SEC_FUNCTION, payload, out);
	}

	if (m.memoryPages > 0) {
		const payload: number[] = [];
		uleb128(1, payload);
		payload.push(0x00);
		uleb128(m.memoryPages, payload);
		section(SEC_MEMORY, payload, out);
	}

	emitGlobalsSection(m, out);
	emitExportsSection(m, out);
	emitCodeSection(m, out);
	emitDataSection(m, out);

	return new Uint8Array(out);
}

function gbcToWasm(type: Type): number {
	if (type.kind !== 'type')
		throw new Error(`Cannot lower ${type.kind} to a WASM value type`);
	switch (type.family) {
		case 'int':
		case 'uint':
			return type.size > 4 ? I64 : I32;
		case 'float':
			return type.size === 4 ? F32 : F64;
		case 'bool':
		case 'string':
		case 'fn':
		case 'error':
		case 'data':
		case 'union':
		case 'literal':
			return I32;
		case 'void':
			throw new Error('Void has no WASM value type');
		case 'unknown':
			throw new Error('Cannot lower unknown type');
	}
}

function fnSignature(fn: SymbolMap['function']): {
	params: number[];
	results: number[];
} {
	const params = (fn.parameters ?? []).map(p => {
		if (!p.type)
			throw new Error(
				`Function "${fn.name ?? '?'}" parameter has no type`,
			);
		return gbcToWasm(p.type);
	});
	const ret = fn.returnType;
	const results: number[] = [];
	if (ret && !(ret.kind === 'type' && ret.family === 'void'))
		results.push(gbcToWasm(ret));
	return { params, results };
}

function isIntType(t: Type): boolean {
	return t.kind === 'type' && (t.family === 'int' || t.family === 'uint');
}

function isFloatType(t: Type): boolean {
	return t.kind === 'type' && t.family === 'float';
}

function findLiteralOut(value: unknown): string | undefined {
	if (typeof value === 'string') return 'out_str';
	if (typeof value === 'boolean') return 'out_bool';
	if (typeof value === 'number')
		return Number.isInteger(value) ? 'out_i32' : 'out_f64';
	return undefined;
}

function findUnionOut(
	t: SymbolMap['type'] & { family: 'union' },
	externals: Map<string, SymbolMap['function']>,
): string | undefined {
	const nonError = t.members.filter(
		m => m.kind === 'type' && m.family !== 'error',
	);
	for (const m of nonError) {
		const r = findOutExternal(m, externals);
		if (r) return r;
	}
	for (const m of t.members) {
		const r = findOutExternal(m, externals);
		if (r) return r;
	}
	return undefined;
}

function findOutByShape(
	t: SymbolMap['type'],
	externals: Map<string, SymbolMap['function']>,
): string | undefined {
	for (const [name, sym] of externals) {
		if (!name.startsWith('out_')) continue;
		const param = sym.parameters?.[0]?.type;
		if (
			param &&
			param.kind === 'type' &&
			param.family === t.family &&
			param.size === t.size
		)
			return name;
	}
	for (const [name, sym] of externals) {
		if (!name.startsWith('out_')) continue;
		const param = sym.parameters?.[0]?.type;
		if (param && param.kind === 'type' && param.family === t.family)
			return name;
	}
	return undefined;
}

function findOutExternal(
	t: Type,
	externals: Map<string, SymbolMap['function']>,
): string | undefined {
	if (t.kind !== 'type')
		throw new Error(`Cannot @.out value of kind ${t.kind}`);
	if (t.family === 'data' && externals.has('out_data')) return 'out_data';
	if (t.family === 'fn' || t.family === 'void') return undefined;
	if (t.family === 'error' && externals.has('out_str')) return 'out_str';
	if (t.family === 'literal') {
		const lit = findLiteralOut(t.value);
		if (lit) return lit;
	}
	if (t.family === 'union') return findUnionOut(t, externals);
	const byShape = findOutByShape(t, externals);
	if (byShape) return byShape;
	throw new Error(`No host external accepts type ${t.name}`);
}

interface Fusion {
	emit: (valueType: Type) => void;
	targetDepth: number;
}

interface FuncBuilder {
	typeIdx: number;
	body: number[];
	locals: number[];
	paramCount: number;
	paramMap: Map<GbcSymbol, number>;
	returnType: Type;
	callFixups: { offset: number; builderIdx: number; size: number }[];
	blockDepth: number;
	fusion?: Fusion;
	/** Local index holding the current pipe-stage input value (`$`). */
	dollarLocal?: number;
	/** Type of `$` in the current pipe-stage scope. */
	dollarType?: Type;
	/** Block depth that `done` should branch to (inside inline-emit). */
	doneDepth?: number;
}

export function compileWasm(
	root: Node,
	externals: Map<string, SymbolMap['function']>,
): Uint8Array {
	const datas: ModuleData[] = [];
	const enc = new TextEncoder();
	let heap = 0;
	const internCache = new Map<string, number>();

	function intern(s: string): number {
		const cached = internCache.get(s);
		if (cached !== undefined) return cached;
		const utf8 = enc.encode(s);
		const buf: number[] = [];
		u32le(utf8.length, buf);
		for (const b of utf8) buf.push(b);
		const offset = heap;
		datas.push({ offset, bytes: buf });
		heap += buf.length;
		// 4-byte align
		heap = (heap + 3) & ~3;
		internCache.set(s, offset);
		return offset;
	}

	const hostImportsByField = new Map<string, number>();
	const imports: ModuleImport[] = [];
	const types: ModuleType[] = [];
	const globals: ModuleGlobal[] = [];
	/** Map a top-level def's name-symbol to its global index. */
	const globalIdx = new Map<GbcSymbol, number>();
	const globalType = new Map<GbcSymbol, Type>();

	function typeIdx(params: number[], results: number[]): number {
		for (let i = 0; i < types.length; i++) {
			const t = types[i];
			if (
				t &&
				t.params.length === params.length &&
				t.results.length === results.length &&
				t.params.every((p, j) => p === params[j]) &&
				t.results.every((r, j) => r === results[j])
			)
				return i;
		}
		types.push({ params, results });
		return types.length - 1;
	}

	function importHost(
		field: string,
		params: number[],
		results: number[],
	): number {
		const existing = hostImportsByField.get(field);
		if (existing !== undefined) return existing;
		const idx = imports.length;
		imports.push({
			mod: 'env',
			field,
			typeIdx: typeIdx(params, results),
		});
		hostImportsByField.set(field, idx);
		return idx;
	}

	const funcBuilders: FuncBuilder[] = [];
	const fnDefBuilderIdx = new Map<GbcSymbol, number>();
	/**
	 * Fns with at least one union-typed parameter. They are NOT given an
	 * eager FuncBuilder; each call site monomorphizes a per-signature
	 * specialization via `getOrCreateSpec`.
	 */
	const fnTemplates = new Map<GbcSymbol, NodeMap['fn']>();
	const specCache = new Map<string, number>();
	// D17: depth guard for inlining emit-position calls (re-emission). Bounded
	// recursion (e.g. `each` over fixed-arity data) unrolls; unbounded runtime
	// recursion hits the cap and falls back to a plain call.
	let emitInlineDepth = 0;
	const MAX_EMIT_INLINE = 64;
	// >0 while inlining a generic Sequence template body — gates the per-level
	// slot re-derivation / scalar-lift in driveFnStage so non-generic stages
	// keep the checker's slot types.
	let inTemplateInline = 0;
	// D43: a spec's actual return type (after type-param/return reduction),
	// keyed by builder index — used so a template call reports the concrete
	// result type, not the template's abstract one.
	const specReturn = new Map<number, Type>();
	// D45: function-typed params are bound to a concrete function at each call
	// site (monomorphized, never a runtime funcref). Active during a spec body.
	const fnArgBindings = new Map<GbcSymbol, SymbolMap['function']>();

	/**
	 * Resolve a type identifier from a `typeident` node or a defined symbol's
	 * declared type. Falls back to Unknown.
	 */
	function resolveTypeFromNode(node: Node | undefined): Type {
		if (!node) return BaseTypes.Unknown;
		if (node.kind === 'typeident') return node.symbol;
		return BaseTypes.Unknown;
	}

	function inferIdentType(node: NodeMap['ident']): Type {
		const sym = node.symbol;
		if (sym.kind === 'literal') return sym.type ?? BaseTypes.Unknown;
		if (sym.kind === 'variable' || sym.kind === 'function')
			return sym.type ?? globalType.get(sym) ?? BaseTypes.Unknown;
		return BaseTypes.Unknown;
	}

	function inferArithType(
		node: NodeMap['+' | '-' | '*' | '/'],
		fn?: FuncBuilder,
	): Type {
		const lt = inferType(node.children[0], fn);
		const rt = inferType(node.children[1], fn);
		if (isFloatType(lt) || isFloatType(rt)) return BaseTypes.Float64;
		if (isIntType(lt) && isIntType(rt)) return BaseTypes.Int32;
		return BaseTypes.Unknown;
	}

	function inferCallType(node: NodeMap['call']): Type {
		const callee = node.children[0];
		if (callee.kind !== 'ident') return BaseTypes.Unknown;
		const sym = callee.symbol;
		const bound = fnArgBindings.get(sym);
		if (bound) return bound.returnType ?? BaseTypes.Void;
		const fnSym =
			sym.kind === 'function'
				? sym
				: sym.type?.kind === 'function'
					? sym.type
					: undefined;
		if (!fnSym) return BaseTypes.Unknown;
		const rt = fnSym.returnType ?? BaseTypes.Void;
		if (rt.kind === 'type' && rt.family === 'unknown' && rt.name) {
			const params = fnSym.parameters ?? [];
			const argNodes = argListFromCall(node.children[1]);
			for (let i = 0; i < params.length; i++) {
				const pt = params[i]?.type;
				const an = argNodes[i];
				if (
					pt?.kind === 'type' &&
					pt.family === 'unknown' &&
					pt.name === rt.name &&
					an
				) {
					const at = inferType(an);
					if (at.kind === 'type' && at.family !== 'unknown') return at;
				}
			}
		}
		return rt;
	}

	function inferMemberType(node: NodeMap['.'], fn?: FuncBuilder): Type {
		const recv = node.children[0];
		const field = node.children[1];
		const recvType = inferType(recv, fn);
		if (recvType.kind === 'type' && (recvType.family === 'data' || recvType.family === 'error')) {
			const members = recvType.members;
			if (field.kind === 'ident' && members) {
				const m = members[field.symbol.name ?? ''];
				if (m && m.kind === 'variable' && m.type) return m.type;
			}
			if (field.kind === 'number') {
				const items = dataItems(recv);
				const item = items[field.value];
				if (item) return inferType(itemValue(item), fn);
			}
			if (field.kind === 'ident') {
				const items = dataItems(recv);
				for (const item of items) {
					if (
						item.kind === 'propdef' &&
						item.symbol.name === field.symbol.name
					) {
						return inferType(itemValue(item), fn);
					}
				}
			}
		}
		return BaseTypes.Int32;
	}

	/** Infer a node's resulting type (best-effort, no codegen). */
	function inferType(node: Node, fn?: FuncBuilder): Type {
		switch (node.kind) {
			case 'number':
				return Number.isInteger(node.value)
					? BaseTypes.Int32
					: BaseTypes.Float64;
			case 'string':
				return BaseTypes.String;
			case '$':
				return fn?.dollarType ?? BaseTypes.Int32;
			case 'ident':
				return inferIdentType(node);
			case '+':
			case '-':
			case '*':
			case '/':
				return inferArithType(node, fn);
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>':
			case '~':
				return BaseTypes.Int32;
			case '!':
				return BaseTypes.Bool;
			case 'negate': {
				const t = inferType(node.children[0], fn);
				return isFloatType(t) ? BaseTypes.Float64 : BaseTypes.Int32;
			}
			case '==':
			case '!=':
			case '<':
			case '>':
			case '<=':
			case '>=':
				return BaseTypes.Bool;
			case '||':
			case '&&':
				return inferType(node.children[0], fn);
			case '?':
				return inferType(node.children[1], fn);
			case 'call':
				return inferCallType(node);
			case '.':
				return inferMemberType(node, fn);
			case 'data': {
				const items = dataItems(node).flatMap(flattenDataItem);
				const first = items[0];
				if (
					items.length === 1 &&
					first &&
					!(first.kind === 'propdef' && first.label)
				)
					return inferType(itemValue(first), fn);
				const members: Record<string, GbcSymbol> = {};
				items.forEach((it, i) => {
					const key =
						it.kind === 'propdef' && it.label ? text(it.label) : String(i);
					members[key] = {
						kind: 'variable',
						name: key,
						flags: 0,
						type: inferType(itemValue(it), fn),
					};
				});
				return {
					kind: 'type',
					flags: 0,
					name: '__data',
					family: 'data',
					size: 0,
					members,
				};
			}
			case 'next': {
				if (fn?.fusion) return BaseTypes.Void;
				const v = node.children?.[0];
				return v ? inferType(v, fn) : BaseTypes.Void;
			}
			case 'break':
				return BaseTypes.Void;
			default:
				return BaseTypes.Unknown;
		}
	}

	function dataItems(node: Node): Node[] {
		if (node.kind !== 'data') return [];
		const inner = node.children[0];
		if (!inner) return [];
		if (inner.kind === ',') return inner.children;
		return [inner];
	}

	function itemValue(item: Node): Node {
		if (item.kind === 'propdef' && item.value) return item.value;
		return item;
	}

	/** Convert top of stack from int to float if needed. */
	function coerceToFloat(have: Type, fn: FuncBuilder) {
		if (isIntType(have)) fn.body.push(OP_F64_CONVERT_I32_S);
	}

	function compileString(node: NodeMap['string'], fn: FuncBuilder): Type {
		const raw = text(node);
		const decoded = decodeEscapes(raw.slice(1, -1));
		const ptr = intern(decoded);
		fn.body.push(OP_I32_CONST);
		sleb128(ptr, fn.body);
		return BaseTypes.String;
	}

	function compileNumber(node: NodeMap['number'], fn: FuncBuilder): Type {
		const value = node.value;
		if (Number.isInteger(value)) {
			fn.body.push(OP_I32_CONST);
			sleb128(value | 0, fn.body);
			return BaseTypes.Int32;
		}
		fn.body.push(OP_F64_CONST);
		f64le(value, fn.body);
		return BaseTypes.Float64;
	}

	function compileIdent(node: NodeMap['ident'], fn: FuncBuilder): Type {
		const sym = node.symbol;
		if (sym.kind === 'literal') {
			const t = sym.type;
			if (t?.kind === 'type') {
				if (t.family === 'bool') {
					fn.body.push(OP_I32_CONST);
					sleb128(sym.value ? 1 : 0, fn.body);
					return t;
				}
				if (t.family === 'float') {
					fn.body.push(OP_F64_CONST);
					f64le(sym.value as number, fn.body);
					return t;
				}
			}
		}
		if (sym.kind === 'variable') {
			const localIdx = fn.paramMap.get(sym);
			if (localIdx !== undefined) {
				fn.body.push(OP_LOCAL_GET);
				uleb128(localIdx, fn.body);
				return sym.type ?? BaseTypes.Unknown;
			}
			const gIdx = globalIdx.get(sym);
			if (gIdx !== undefined) {
				fn.body.push(OP_GLOBAL_GET);
				uleb128(gIdx, fn.body);
				return globalType.get(sym) ?? sym.type ?? BaseTypes.Unknown;
			}
		}
		throw new Error(`Unsupported ident reference: "${sym.name ?? '?'}"`);
	}

	function compileDollar(fn: FuncBuilder): Type {
		if (fn.dollarLocal !== undefined) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(fn.dollarLocal, fn.body);
			return fn.dollarType ?? BaseTypes.Int32;
		}
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	// D17/D43: inline a generic Sequence template (e.g. `each`) in emit
	// position — monomorphize the type-params, inline the body driving the
	// current fusion. Recursive calls re-enter here with a shrunk arg type and
	// terminate when it reduces to Void / empty data.
	function tryInlineEmitTemplate(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return false;
		const template = fnTemplates.get(callee.symbol);
		if (!template || !(template.symbol.flags & Flags.Sequence)) return false;
		const tbody = (template.statements ?? [])[0];
		if (tbody?.kind === '>>') {
			const flat = flattenPipe(tbody.children);
			const last = flat[flat.length - 1];
			const innerStmts =
				last?.kind === 'fn' ? last.statements ?? [] : [];
			if (innerStmts.length === 1 && innerStmts[0]?.kind !== ',')
				return false;
		}
		const args = callNode.children[1];
		const argTypes = collectArgTypes(args, fn);
		const a0 = argTypes[0];
		if (
			a0?.kind === 'type' &&
			(a0.family === 'void' ||
				(a0.family === 'data' && Object.keys(a0.members).length === 0))
		)
			return true; // base case: nothing to emit
		// Set each value-param's type to its concrete arg type for this level
		// (save/restore nests across recursive inline levels — unlike in-place
		// placeholder mutation, which aliases the shared template symbols).
		const valueParams = template.parameters ?? [];
		const savedParamTypes = valueParams.map(p => p.symbol.type);
		valueParams.forEach((p, i) => {
			const at = argTypes[i];
			// Leave function-typed params alone — they bind by symbol (D41).
			if (at && p.symbol.type?.kind !== 'function') p.symbol.type = at;
		});
		const ok = bindInlineParams(valueParams, argListFromCall(args), fn);
		if (ok) {
			inTemplateInline++;
			compileFnSource(template, stages, fn);
			inTemplateInline--;
		}
		valueParams.forEach((p, i) => {
			p.symbol.type = savedParamTypes[i];
		});
		return ok;
	}

	// D17: re-emit a callee's emissions by inlining its body so its `next`s
	// drive the current fusion (empty stages → emit flows to savedFusion).
	function tryInlineEmitCall(val: Node, fn: FuncBuilder): boolean {
		if (val.kind !== 'call' || !fn.fusion) return false;
		if (emitInlineDepth >= MAX_EMIT_INLINE) return false;
		emitInlineDepth++;
		const ok =
			tryInlineSequenceCall(val, [], fn) ||
			tryInlineEmitTemplate(val, [], fn);
		emitInlineDepth--;
		return ok;
	}

	function compileNext(node: NodeMap['next'], fn: FuncBuilder): Type {
		const val = node.children?.[0];
		if (fn.fusion) {
			if (!val) return BaseTypes.Void;
			if (tryInlineEmitCall(val, fn)) return BaseTypes.Void;
			const t = compileExpr(val, fn);
			if (
				hasRuntimeValue(t)
			)
				fn.fusion.emit(t);
			return BaseTypes.Void;
		}
		if (val) return compileExpr(val, fn);
		return BaseTypes.Void;
	}

	function compileNegate(
		node: NodeMap['negate'],
		fn: FuncBuilder,
	): Type {
		const child = node.children[0];
		const t = compileExpr(child, fn);
		if (isFloatType(t)) {
			fn.body.push(OP_F64_NEG);
			return t;
		}
		const tmp = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(tmp, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(tmp, fn.body);
		fn.body.push(OP_I32_SUB);
		return BaseTypes.Int32;
	}

	function compileBitwise(
		node: NodeMap['|' | '&' | '^' | '<:' | ':>'],
		fn: FuncBuilder,
	): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		compileExpr(lhs, fn);
		compileExpr(rhs, fn);
		const op =
			node.kind === '|'
				? OP_I32_OR
				: node.kind === '&'
					? OP_I32_AND
					: node.kind === '^'
						? OP_I32_XOR
						: node.kind === '<:'
							? OP_I32_SHL
							: OP_I32_SHR_S;
		fn.body.push(op);
		return BaseTypes.Int32;
	}

	function compileLogical(
		node: NodeMap['||' | '&&'],
		fn: FuncBuilder,
	): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		const lt = compileExpr(lhs, fn);
		const tmp = allocLocal(fn, gbcToWasm(lt));
		fn.body.push(OP_LOCAL_TEE);
		uleb128(tmp, fn.body);
		if (node.kind === '||') fn.body.push(OP_I32_EQZ);
		fn.body.push(OP_IF);
		fn.body.push(gbcToWasm(lt));
		fn.blockDepth++;
		compileExpr(rhs, fn);
		fn.body.push(OP_ELSE);
		fn.body.push(OP_LOCAL_GET);
		uleb128(tmp, fn.body);
		fn.body.push(OP_END);
		fn.blockDepth--;
		return lt;
	}

	function compileIs(node: NodeMap['is'], fn: FuncBuilder): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		const valueType = inferType(lhs, fn);
		const testType =
			rhs.kind === 'typeident' ? rhs.symbol : BaseTypes.Unknown;
		const lhsType = compileExpr(lhs, fn);
		if (
			hasRuntimeValue(lhsType)
		)
			fn.body.push(OP_DROP);
		const matches =
			valueType.kind === 'type' &&
			testType.kind === 'type' &&
			valueType.family === testType.family &&
			valueType.size === testType.size;
		fn.body.push(OP_I32_CONST);
		sleb128(matches ? 1 : 0, fn.body);
		return BaseTypes.Bool;
	}

	function unionOfTypes(a: Type, b: Type): Type {
		if (a.kind !== 'type' || b.kind !== 'type') return a;
		if (a === b) return a;
		if (a.name === b.name && a.family === b.family) return a;
		const members: Type[] = [];
		const add = (t: Type) => {
			if (t.kind !== 'type') return;
			if (t.family === 'union') {
				for (const m of t.members)
					if (!members.some(x => x.name === m.name)) members.push(m);
			} else if (!members.some(x => x.name === t.name)) members.push(t);
		};
		add(a);
		add(b);
		if (members.length === 1) return members[0] ?? a;
		let maxSize = 0;
		for (const m of members) if (m.kind === 'type' && m.size > maxSize) maxSize = m.size;
		return {
			kind: 'type',
			flags: 0,
			name: members.map(m => m.name).join(' | '),
			family: 'union',
			size: maxSize,
			members,
		};
	}

	function constEvalInt(node: Node, fn: FuncBuilder): number | undefined {
		if (node.kind === 'number' && Number.isInteger(node.value))
			return node.value;
		if (node.kind === 'call') {
			const callee = node.children[0];
			const arg = node.children[1];
			if (
				callee.kind === 'ident' &&
				callee.symbol.kind === 'function' &&
				callee.symbol.flags & Flags.Intrinsic &&
				callee.symbol.name === 'length' &&
				arg
			) {
				const t = inferType(arg, fn);
				if (t.kind === 'type') {
					if (t.family === 'void') return 0;
					if (t.family === 'data')
						return Object.keys(t.members).length;
					if (t.family === 'string') return undefined;
					return 1;
				}
			}
		}
		return undefined;
	}

	function constEvalBool(node: Node, fn: FuncBuilder): boolean | undefined {
		if (node.kind === '==' || node.kind === '!=') {
			const a = constEvalInt(node.children[0], fn);
			const b = constEvalInt(node.children[1], fn);
			if (a === undefined || b === undefined) return undefined;
			return node.kind === '==' ? a === b : a !== b;
		}
		return undefined;
	}

	function compileTernary(node: NodeMap['?'], fn: FuncBuilder): Type {
		const cond = node.children[0];
		const thenBranch = node.children[1];
		const elseBranch = node.children[2];
		const known = constEvalBool(cond, fn);
		if (known !== undefined) {
			const taken = known ? thenBranch : elseBranch;
			if (!taken) return BaseTypes.Void;
			return compileExpr(taken, fn);
		}
		compileExpr(cond, fn);
		fn.body.push(OP_IF);
		if (!elseBranch) {
			fn.body.push(0x40);
			fn.blockDepth++;
			const t = compileExpr(thenBranch, fn);
			if (
				hasRuntimeValue(t)
			)
				fn.body.push(OP_DROP);
			fn.body.push(OP_END);
			fn.blockDepth--;
			return BaseTypes.Void;
		}
		const thenType = inferType(thenBranch, fn);
		const elseType = inferType(elseBranch, fn);
		const isBottom = (n: Node) =>
			n.kind === 'break' || n.kind === 'done';
		const effective = isBottom(thenBranch)
			? elseType
			: isBottom(elseBranch)
				? thenType
				: unionOfTypes(thenType, elseType);
		const blockType =
			hasRuntimeValue(effective)
				? gbcToWasm(effective)
				: 0x40;
		fn.body.push(blockType);
		fn.blockDepth++;
		compileExpr(thenBranch, fn);
		fn.body.push(OP_ELSE);
		compileExpr(elseBranch, fn);
		fn.body.push(OP_END);
		fn.blockDepth--;
		return effective;
	}

	function compileComma(node: NodeMap[','], fn: FuncBuilder): Type {
		if (fn.fusion) {
			for (const c of node.children) {
				const t = compileExpr(c, fn);
				if (
					c.kind !== 'next' &&
					c.kind !== 'break' &&
					c.kind !== 'done' &&
					hasRuntimeValue(t)
				)
					fn.fusion.emit(t);
			}
			return BaseTypes.Void;
		}
		let last: Type = BaseTypes.Void;
		const children = node.children;
		for (let i = 0; i < children.length; i++) {
			const c = children[i];
			if (!c) continue;
			const t = compileExpr(c, fn);
			last = t;
			if (
				i < children.length - 1 &&
				hasRuntimeValue(t)
			)
				fn.body.push(OP_DROP);
		}
		return last;
	}

	function compileAssign(node: NodeMap['='], fn: FuncBuilder): Type {
		const left = node.children[0];
		const right = node.children[1];
		if (left.kind !== 'ident')
			throw new Error('Only ident assignment supported');
		const sym = left.symbol;
		const rt = compileExpr(right, fn);
		if (sym.kind === 'variable') {
			const localIdx = fn.paramMap.get(sym);
			if (localIdx !== undefined) {
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				return BaseTypes.Void;
			}
			const gIdx = globalIdx.get(sym);
			if (gIdx !== undefined) {
				const gt = globalType.get(sym) ?? rt;
				if (isFloatType(gt) && !isFloatType(rt))
					coerceToFloat(rt, fn);
				fn.body.push(OP_GLOBAL_SET);
				uleb128(gIdx, fn.body);
				return BaseTypes.Void;
			}
		}
		throw new Error(`Cannot assign to "${sym.name ?? '?'}" (not bound)`);
	}

	function compileExpr(node: Node, fn: FuncBuilder): Type {
		switch (node.kind) {
			case 'string':
				return compileString(node, fn);
			case 'number':
				return compileNumber(node, fn);
			case 'ident':
				return compileIdent(node, fn);
			case '@':
				throw new Error('Bare @ cannot be lowered to a value');
			case '$':
				return compileDollar(fn);
			case 'call':
				return compileCall(node, fn);
			case 'next':
				return compileNext(node, fn);
			case 'break': {
				if (!fn.fusion) throw new Error('`break` outside pipe stage');
				fn.body.push(OP_BR);
				uleb128(fn.blockDepth - fn.fusion.targetDepth, fn.body);
				return BaseTypes.Void;
			}
			case 'done': {
				if (fn.doneDepth !== undefined) {
					fn.body.push(OP_BR);
					uleb128(fn.blockDepth - fn.doneDepth, fn.body);
				} else {
					fn.body.push(OP_RETURN);
				}
				return BaseTypes.Void;
			}
			case '+':
			case '-':
			case '*':
			case '/':
				return compileArith(node, fn);
			case 'negate':
				return compileNegate(node, fn);
			case '!': {
				compileExpr(node.children[0], fn);
				fn.body.push(OP_I32_EQZ);
				return BaseTypes.Bool;
			}
			case '~': {
				compileExpr(node.children[0], fn);
				fn.body.push(OP_I32_CONST);
				sleb128(-1, fn.body);
				fn.body.push(OP_I32_XOR);
				return BaseTypes.Int32;
			}
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>':
				return compileBitwise(node, fn);
			case '||':
			case '&&':
				return compileLogical(node, fn);
			case '==':
			case '!=':
			case '<':
			case '>':
			case '<=':
			case '>=':
				return compileCompare(
					node.kind,
					node.children[0],
					node.children[1],
					fn,
				);
			case 'is':
				return compileIs(node, fn);
			case '?':
				return compileTernary(node, fn);
			case '>>':
				return compilePipe(node.children, fn);
			case 'data':
				return compileData(node, fn);
			case '.':
				return compileMember(node, fn);
			case 'fn':
				return compileInlineFn(node, fn);
			case ',':
				return compileComma(node, fn);
			case 'propdef': {
				const v = node.value;
				if (v) return compileExpr(v, fn);
				return BaseTypes.Void;
			}
			case '=':
				return compileAssign(node, fn);
			case 'def':
				return compileLocalDef(node, fn);
			case 'loop':
				throw new Error('`loop` outside pipe source not supported');
			default:
				throw new Error(`Unsupported node kind: ${node.kind}`);
		}
	}

	function compileArith(
		node: NodeMap['+'] | NodeMap['-'] | NodeMap['*'] | NodeMap['/'],
		fn: FuncBuilder,
	): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		const lt = inferType(lhs, fn);
		const rt = inferType(rhs, fn);
		const useFloat = isFloatType(lt) || isFloatType(rt);

		const actualLt = compileExpr(lhs, fn);
		if (useFloat && !isFloatType(actualLt)) coerceToFloat(actualLt, fn);
		const actualRt = compileExpr(rhs, fn);
		if (useFloat && !isFloatType(actualRt)) coerceToFloat(actualRt, fn);

		if (useFloat) {
			const op =
				node.kind === '+'
					? OP_F64_ADD
					: node.kind === '-'
						? OP_F64_SUB
						: node.kind === '*'
							? OP_F64_MUL
							: OP_F64_DIV;
			fn.body.push(op);
			return BaseTypes.Float64;
		}
		if (!isIntType(actualLt) || !isIntType(actualRt))
			throw new Error(
				`Operator "${node.kind}" requires numeric operands`,
			);
		const op =
			node.kind === '+'
				? OP_I32_ADD
				: node.kind === '-'
					? OP_I32_SUB
					: node.kind === '*'
						? OP_I32_MUL
						: OP_I32_DIV_S;
		fn.body.push(op);
		return BaseTypes.Int32;
	}

	function compileCompare(
		kind: '==' | '!=' | '<' | '>' | '<=' | '>=',
		lhs: Node,
		rhs: Node,
		fn: FuncBuilder,
	): Type {
		const lt = inferType(lhs, fn);
		const rt = inferType(rhs, fn);
		const useFloat = isFloatType(lt) || isFloatType(rt);

		const actualLt = compileExpr(lhs, fn);
		if (useFloat && !isFloatType(actualLt)) coerceToFloat(actualLt, fn);
		const actualRt = compileExpr(rhs, fn);
		if (useFloat && !isFloatType(actualRt)) coerceToFloat(actualRt, fn);

		if (useFloat) {
			const op =
				kind === '=='
					? OP_F64_EQ
					: kind === '!='
						? OP_F64_NE
						: kind === '<'
							? OP_F64_LT
							: kind === '>'
								? OP_F64_GT
								: kind === '<='
									? OP_F64_LE
									: OP_F64_GE;
			fn.body.push(op);
			return BaseTypes.Bool;
		}
		const op =
			kind === '=='
				? OP_I32_EQ
				: kind === '!='
					? OP_I32_NE
					: kind === '<'
						? OP_I32_LT_S
						: kind === '>'
							? OP_I32_GT_S
							: kind === '<='
								? OP_I32_LE_S
								: OP_I32_GE_S;
		fn.body.push(op);
		return BaseTypes.Bool;
	}

	function compileIntrinsic(
		name: string,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		if (name === 'out') return compileHostOutCall(args, fn);
		if (name === 'error') {
			if (args) compileExpr(args, fn);
			else {
				fn.body.push(OP_I32_CONST);
				sleb128(0, fn.body);
			}
			// Tag Error pointers with high bit set so runtime dispatch can
			// distinguish them from plain Int32 values in unions.
			fn.body.push(OP_I32_CONST);
			sleb128(-0x80000000, fn.body);
			fn.body.push(0x72); // i32.or
			return BaseTypes.Error;
		}
		if (name === 'length') {
			if (!args) throw new Error('length() requires an argument');
			const argType = inferType(args, fn);
			const isStringLike =
				argType.kind === 'type' &&
				(argType.family === 'string' ||
					(argType.family === 'literal' &&
						typeof argType.value === 'string'));
			if (argType.kind === 'type' && !isStringLike) {
				const n =
					argType.family === 'void'
						? 0
						: argType.family === 'data'
						? Object.keys(argType.members).length
						: 1;
				fn.body.push(OP_I32_CONST);
				sleb128(n, fn.body);
				return BaseTypes.Int32;
			}
			compileExpr(args, fn);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			return BaseTypes.Int32;
		}
		throw new Error(`Unknown intrinsic: "${name}"`);
	}

	function emitOutHostCall(inputType: Type, fn: FuncBuilder): Type {
		let inT = inputType;
		if (inT.kind !== 'type' || inT.family === 'unknown')
			inT = BaseTypes.Int32;
		const hostField = findOutExternal(inT, externals);
		if (!hostField) {
			if (inT.family !== 'void') fn.body.push(OP_DROP);
			return BaseTypes.Void;
		}
		const ext = externals.get(hostField);
		if (!ext)
			throw new Error(`External "${hostField}" missing from stdlib`);
		const sig = fnSignature(ext);
		const idx = importHost(hostField, sig.params, sig.results);
		fn.body.push(OP_CALL);
		uleb128(idx, fn.body);
		return BaseTypes.Void;
	}

	function compileHostOutCall(
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		if (!args) return BaseTypes.Void;
		const argType = compileExpr(args, fn);
		return emitOutHostCall(argType, fn);
	}

	function emitFixedCall(fn: FuncBuilder, builderIdx: number) {
		fn.body.push(OP_CALL);
		const fixupOffset = fn.body.length;
		for (let i = 0; i < 5; i++) fn.body.push(0);
		fn.callFixups.push({ offset: fixupOffset, builderIdx, size: 5 });
	}

	function returnedFnLiteral(
		callNode: NodeMap['call'],
	): NodeMap['fn'] | undefined {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return undefined;
		const def = callee.symbol.definition;
		const g =
			def?.kind === 'def' && def.value.kind === 'fn'
				? def.value
				: undefined;
		const stmts = g?.statements ?? [];
		if (stmts.length !== 1) return undefined;
		const s = stmts[0];
		if (s?.kind === 'fn') return s;
		if (s?.kind === 'next' && s.children?.[0]?.kind === 'fn')
			return s.children[0];
		return undefined;
	}

	function resolveFnArg(node: Node): SymbolMap['function'] | undefined {
		if (node.kind !== 'ident') return undefined;
		const s = node.symbol;
		if (s.kind === 'function') return s;
		const bound = fnArgBindings.get(s);
		if (bound) return bound;
		if (s.type?.kind === 'function') return s.type;
		const def = s.definition;
		if (def?.kind === 'def' && def.value.kind === 'fn')
			return def.value.symbol;
		return undefined;
	}

	function compileTemplateCall(
		templateNode: NodeMap['fn'],
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const fnSym = templateNode.symbol;
		const params = templateNode.parameters ?? [];
		const argList = argListFromCall(args);
		const bindings = new Map<GbcSymbol, SymbolMap['function']>();
		params.forEach((p, i) => {
			if (p.symbol.type?.kind !== 'function') return;
			const a = argList[i];
			const fa = a ? resolveFnArg(a) : undefined;
			if (fa) bindings.set(p.symbol, fa);
		});
		const argTypes = collectArgTypes(args, fn);
		const builderIdx = getOrCreateSpec(templateNode, argTypes, bindings);
		compileCallArgs(args, fnSym, fn, bindings);
		emitFixedCall(fn, builderIdx);
		return specReturn.get(builderIdx) ?? fnSym.returnType ?? BaseTypes.Void;
	}

	function compileDirectCall(
		calleeSym: GbcSymbol,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const builderIdx = fnDefBuilderIdx.get(calleeSym);
		if (builderIdx === undefined)
			throw new Error(`Unknown function: "${calleeSym.name ?? '?'}"`);
		const fnSym =
			calleeSym.kind === 'function'
				? calleeSym
				: calleeSym.type?.kind === 'function'
					? calleeSym.type
					: undefined;
		if (!fnSym)
			throw new Error(
				`"${calleeSym.name ?? '?'}" has no function type`,
			);
		compileCallArgs(args, fnSym, fn);
		emitFixedCall(fn, builderIdx);
		return fnSym.returnType ?? BaseTypes.Void;
	}

	function compileCall(node: NodeMap['call'], fn: FuncBuilder): Type {
		const callee = node.children[0];
		const args = node.children[1];
		if (callee.kind === 'call') {
			const innerFn = returnedFnLiteral(callee);
			if (!innerFn) throw new Error('Indirect call not yet supported');
			const argTypes = collectArgTypes(args, fn);
			const idx = getOrCreateSpec(innerFn, argTypes);
			compileCallArgs(args, innerFn.symbol, fn);
			emitFixedCall(fn, idx);
			return specReturn.get(idx) ?? innerFn.symbol.returnType ?? BaseTypes.Void;
		}
		if (callee.kind !== 'ident')
			throw new Error('Indirect call not yet supported');
		const calleeSym = callee.symbol;
		const bound = fnArgBindings.get(calleeSym);
		if (bound) return compileDirectCall(bound, args, fn);
		if (
			calleeSym.kind === 'function' &&
			calleeSym.flags & Flags.Intrinsic
		)
			return compileIntrinsic(calleeSym.name ?? '', args, fn);
		const templateNode = fnTemplates.get(calleeSym);
		if (templateNode) return compileTemplateCall(templateNode, args, fn);
		const disp = tryCompileDispatch(calleeSym, args, fn);
		if (disp) return disp;
		return compileDirectCall(calleeSym, args, fn);
	}

	function isCatchAllArm(o: SymbolMap['function']): boolean {
		if (o.parameters?.length !== 1) return false;
		// A catch-all template's param symbol type gets mutated by monomorphization,
		// so read the stable node annotation: no `:T` on the sole param.
		const node = fnTemplates.get(o);
		if (node && node.kind === 'fn') return !node.parameters?.[0]?.type;
		const p = o.parameters[0]?.type;
		return !p || (p.kind === 'type' && p.family === 'unknown');
	}

	function dispatchArgType(t: Type): Type {
		if (t.kind === 'type' && t.family === 'union' && t.members) {
			const m = t.members.find(
				x => !(x.kind === 'type' && x.family === 'error'),
			);
			if (m) return dispatchArgType(m);
		}
		if (t.kind === 'type' && t.family === 'literal') {
			const v = t.value;
			if (typeof v === 'string') return BaseTypes.String;
			if (typeof v === 'boolean') return BaseTypes.Bool;
			if (typeof v === 'number')
				return Number.isInteger(v) ? BaseTypes.Int32 : BaseTypes.Float64;
		}
		return t;
	}

	function findDispatchArm(
		overloads: SymbolMap['function'][],
		argTypes: Type[],
	): SymbolMap['function'] | undefined {
		const ats = argTypes.map(dispatchArgType);
		const typed = overloads.find(o => {
			if (isCatchAllArm(o)) return false;
			const ps = o.parameters;
			if (!ps || ps.length !== ats.length) return false;
			return ps.every((p, i) => {
				const pt = p.type;
				const at = ats[i];
				return (
					pt?.kind === 'type' &&
					pt.family !== 'unknown' &&
					at?.kind === 'type' &&
					pt.family === at.family &&
					pt.name === at.name
				);
			});
		});
		if (typed) return typed;
		return overloads.find(isCatchAllArm);
	}

	// Emit a call to a resolved dispatch arm: a builder call for an inline-fn or
	// named-fn arm, or a host-import call when the arm is an `external` (e.g.
	// `out = out_i32 | out_str | …`). Args/input must already be on the stack.
	function emitArmCall(
		arm: SymbolMap['function'],
		dispatchName: string | undefined,
		fn: FuncBuilder,
	): void {
		const builderIdx = fnDefBuilderIdx.get(arm);
		if (builderIdx !== undefined) {
			emitFixedCall(fn, builderIdx);
			return;
		}
		if (arm.flags & Flags.External && arm.name) {
			const sig = fnSignature(arm);
			const idx = importHost(arm.name, sig.params, sig.results);
			fn.body.push(OP_CALL);
			uleb128(idx, fn.body);
			return;
		}
		throw new Error(
			`dispatch "${dispatchName ?? '?'}": arm "${arm.name ?? '_'}" not compiled`,
		);
	}

	function tryCompileDispatch(
		calleeSym: GbcSymbol,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type | undefined {
		const dt = calleeSym.kind === 'function' ? calleeSym : calleeSym.type;
		if (!dt || dt.kind !== 'function' || !dt.overloads) return undefined;
		const argTypes = collectArgTypes(args, fn);
		const arm = findDispatchArm(dt.overloads, argTypes);
		if (!arm)
			throw new Error(
				`dispatch "${calleeSym.name ?? '?'}": no arm accepts (${argTypes
					.map(t => (t.kind === 'type' ? t.name : t.kind))
					.join(', ')}); arms: ${dt.overloads
					.map(o => o.parameters?.[0]?.type?.name ?? '_')
					.join(' | ')}`,
			);
		const tmpl = fnTemplates.get(arm);
		if (tmpl) return compileTemplateCall(tmpl, args, fn);
		compileCallArgs(args, arm, fn);
		emitArmCall(arm, calleeSym.name, fn);
		return arm.returnType ?? BaseTypes.Void;
	}

	function compileData(node: NodeMap['data'], fn: FuncBuilder): Type {
		const items = dataItems(node).flatMap(flattenDataItem);
		if (items.length === 0) {
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Unknown;
		}
		const hasLabels = items.some(
			it => it.kind === 'propdef' && it.label,
		);
		const first = items[0];
		if (items.length === 1 && !hasLabels && first) {
			return compileExpr(itemValue(first), fn);
		}
		// Multi-item: encode in linear memory as packed array.
		// Layout: [u32 length][u32 itemSize][items...]
		// 8-byte slots only when every item is float. Mixed/all-i32 use
		// 4-byte slots; float items in a 4-byte slot are truncated.
		const itemTypes: Type[] = items.map(it => inferType(itemValue(it), fn));
		const useF64 =
			itemTypes.length > 0 && itemTypes.every(isFloatType);
		const slotSize = useF64 ? 8 : 4;
		const buf: number[] = [];
		u32le(items.length, buf);
		u32le(slotSize, buf);
		// Reserve item bytes; they get filled at construction time via memory
		// stores so we can use runtime values (idents, calls etc.).
		const offset = heap;
		heap += buf.length;
		// Header
		datas.push({ offset, bytes: buf });
		// Item slots area
		const slotsOffset = heap;
		const empty: number[] = [];
		for (let i = 0; i < items.length * slotSize; i++) empty.push(0);
		datas.push({ offset: slotsOffset, bytes: empty });
		heap += empty.length;
		// Align to 8 bytes after items
		heap = (heap + 7) & ~7;

		// Emit code that writes each item at runtime.
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) continue;
			const itemNode = itemValue(item);
			const addr = slotsOffset + i * slotSize;
			fn.body.push(OP_I32_CONST);
			sleb128(addr, fn.body);
			const t = compileExpr(itemNode, fn);
			if (useF64) {
				if (!isFloatType(t)) coerceToFloat(t, fn);
				fn.body.push(OP_F64_STORE);
				uleb128(3, fn.body); // align 8
				uleb128(0, fn.body);
			} else {
				// 4-byte slot. Truncate float to int when needed.
				if (isFloatType(t)) {
					fn.body.push(0xaa); // i32.trunc_f64_s
				}
				fn.body.push(OP_I32_STORE);
				uleb128(2, fn.body);
				uleb128(0, fn.body);
			}
		}
		// Return pointer to header
		fn.body.push(OP_I32_CONST);
		sleb128(offset, fn.body);
		return makeDataType(slotSize, items);
	}

	function flattenDataItem(item: Node): Node[] {
		// Nested data block literals are flattened in iteration / index access.
		const v = itemValue(item);
		if (v.kind === 'data') return dataItems(v).flatMap(flattenDataItem);
		return [item];
	}

	function makeDataType(slotSize: number, items: Node[]): Type {
		const members: Record<string, GbcSymbol> = {};
		items.forEach((it, i) => {
			const key =
				it.kind === 'propdef' && it.label ? text(it.label) : String(i);
			members[key] = {
				kind: 'variable',
				name: key,
				flags: 0,
				type: inferType(itemValue(it)),
			};
		});
		return {
			kind: 'type',
			flags: 0,
			name: '__data',
			family: 'data',
			size: slotSize,
			members,
		};
	}

	function compileMemberData(
		recv: NodeMap['data'],
		field: Node,
		fn: FuncBuilder,
	): Type {
		const items = dataItems(recv).flatMap(flattenDataItem);
		let idx: number | undefined;
		if (field.kind === 'number') idx = field.value;
		else if (field.kind === 'ident') {
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (
					item?.kind === 'propdef' &&
					item.symbol.name === field.symbol.name
				) {
					idx = i;
					break;
				}
			}
		}
		if (idx === undefined || idx >= items.length)
			throw new Error('Member access target not found');
		const target = items[idx];
		if (!target) throw new Error('Member access target not found');
		return compileExpr(itemValue(target), fn);
	}

	function compileMemberDollar(field: Node, fn: FuncBuilder): Type {
		if (
			fn.dollarLocal !== undefined &&
			fn.dollarType?.kind === 'type' &&
			fn.dollarType.family === 'error'
		) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(fn.dollarLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(0x7FFFFFFF, fn.body);
			fn.body.push(0x71); // i32.and — clear Error tag bit
			return BaseTypes.String;
		}
		if (
			fn.dollarLocal !== undefined &&
			fn.dollarType?.kind === 'type' &&
			(fn.dollarType.family === 'data' || fn.dollarType.family === 'error')
		) {
			const slotSize = fn.dollarType.size || 4;
			let idx = 0;
			if (field.kind === 'number') idx = field.value;
			else if (field.kind === 'ident') {
				const keys = Object.keys(fn.dollarType.members);
				const i = keys.indexOf(field.symbol.name ?? '');
				if (i >= 0) idx = i;
			}
			fn.body.push(OP_LOCAL_GET);
			uleb128(fn.dollarLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(8 + idx * slotSize, fn.body);
			fn.body.push(OP_I32_ADD);
			if (slotSize === 8) {
				fn.body.push(OP_F64_LOAD);
				uleb128(3, fn.body);
				uleb128(0, fn.body);
				return BaseTypes.Float64;
			}
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			return BaseTypes.Int32;
		}
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	function compileMember(node: NodeMap['.'], fn: FuncBuilder): Type {
		const recv = node.children[0];
		const field = node.children[1];
		if (recv.kind === 'data') return compileMemberData(recv, field, fn);
		if (recv.kind === 'ident') {
			const recvType = inferType(recv, fn);
			if (recvType.kind === 'type' && (recvType.family === 'data' || recvType.family === 'error')) {
				const recvSym = recv.symbol;
				if (recvSym.kind === 'variable') {
					return compileMemberLoad(recv, recvType, field, fn);
				}
			}
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Int32;
		}
		if (recv.kind === '$') return compileMemberDollar(field, fn);
		throw new Error(`Unsupported member access target: ${recv.kind}`);
	}

	function compileMemberLoad(
		recv: NodeMap['ident'],
		recvType: Type,
		field: Node,
		fn: FuncBuilder,
	): Type {
		if (recvType.kind === 'type' && recvType.family === 'error') {
			compileExpr(recv, fn);
			fn.body.push(OP_I32_CONST);
			sleb128(0x7FFFFFFF, fn.body);
			fn.body.push(0x71); // i32.and — clear Error tag bit
			return BaseTypes.String;
		}
		if (recvType.kind !== 'type' || recvType.family !== 'data')
			throw new Error('compileMemberLoad: not a data type');
		const slotSize = recvType.size || 4;
		const members = recvType.members;
		const keys = Object.keys(members);
		let idx: number | undefined;
		let memberType: Type | undefined;
		if (field.kind === 'number') {
			idx = field.value;
			const key = keys[idx];
			if (key) memberType = members[key]?.type;
		} else if (field.kind === 'ident') {
			const fieldName = field.symbol.name ?? '';
			for (let i = 0; i < keys.length; i++) {
				if (keys[i] === fieldName) {
					idx = i;
					memberType = members[fieldName]?.type;
					break;
				}
			}
		}
		if (idx === undefined) throw new Error('Member access target not found');
		// Push base pointer + (8 [header] + idx*slotSize)
		compileExpr(recv, fn);
		fn.body.push(OP_I32_CONST);
		sleb128(8 + idx * slotSize, fn.body);
		fn.body.push(OP_I32_ADD);
		if (slotSize === 8) {
			fn.body.push(OP_F64_LOAD);
			uleb128(3, fn.body);
			uleb128(0, fn.body);
			return memberType ?? BaseTypes.Float64;
		}
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		return memberType ?? BaseTypes.Int32;
	}

	function compileInlineFn(_node: NodeMap['fn'], fn: FuncBuilder): Type {
		// In MVP we don't yet emit a funcref table entry for anonymous fn
		// values. As a value, it appears only in deferred positions (e.g.
		// the truthy branch of an optional-else ternary) and isn't invoked.
		// Push a 0 funcref placeholder.
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Fn;
	}

	function compileLocalDef(node: NodeMap['def'], fn: FuncBuilder): Type {
		const sym = node.symbol;
		const rt = compileExpr(node.value, fn);
		const wasmType = hasRuntimeValue(rt)
			? gbcToWasm(rt)
			: I32;
		const localIdx = allocLocal(fn, wasmType);
		fn.body.push(OP_LOCAL_SET);
		uleb128(localIdx, fn.body);
		fn.paramMap.set(sym, localIdx);
		sym.type = rt;
		return BaseTypes.Void;
	}

	function callReturnUnion(
		callNode: NodeMap['call'],
	): SymbolMap['type'] | undefined {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return undefined;
		const sym = callee.symbol;
		const rt =
			sym.kind === 'function'
				? sym.returnType
				: sym.type?.kind === 'function'
					? sym.type.returnType
					: undefined;
		if (rt?.kind === 'type' && rt.family === 'union') return rt;
		return undefined;
	}

	type PipeInlineResult =
		| { kind: 'done' }
		| { kind: 'continue'; source: Node; stages: Node[] }
		| { kind: 'stop' };

	function tryInlinePipeCall(
		source: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): PipeInlineResult {
		if (tryInlineSequenceCall(source, stages, fn)) return { kind: 'done' };
		if (tryInlineEmittingCall(source, stages, fn)) return { kind: 'done' };
		if (emitInlineDepth < MAX_EMIT_INLINE) {
			emitInlineDepth++;
			const ok = tryInlineEmitTemplate(source, stages, fn);
			emitInlineDepth--;
			if (ok) return { kind: 'done' };
		}
		const inlined = tryInlineStreamCall(source, fn);
		if (!inlined) return { kind: 'stop' };
		const reflat = flattenPipe([inlined, ...stages]);
		const first = reflat[0];
		if (!first) return { kind: 'stop' };
		return { kind: 'continue', source: first, stages: reflat.slice(1) };
	}

	function compileOptionalSource(
		source: NodeMap['?'],
		stages: Node[],
		fn: FuncBuilder,
	) {
		compileExpr(source.children[0], fn);
		fn.body.push(OP_IF);
		fn.body.push(0x40);
		fn.blockDepth++;
		const inner = source.children[1];
		if (inner.kind === 'fn') {
			compileFnSource(inner, stages, fn);
		} else {
			const t = compileExpr(inner, fn);
			driveStages(stages, t, fn);
		}
		fn.body.push(OP_END);
		fn.blockDepth--;
	}

	function compilePipe(children: Node[], fn: FuncBuilder): Type {
		const flat = flattenPipe(children);
		let source = flat[0];
		let stages = flat.slice(1);
		if (!source) throw new Error('Invalid pipe');

		let originalUnion: SymbolMap['type'] | undefined;
		while (source.kind === 'call') {
			if (!originalUnion) originalUnion = callReturnUnion(source);
			const r = tryInlinePipeCall(source, stages, fn);
			if (r.kind === 'done') return BaseTypes.Void;
			if (r.kind === 'stop') break;
			source = r.source;
			stages = r.stages;
		}

		if (source.kind === 'loop') {
			compileLoopSource(stages, fn);
			return BaseTypes.Void;
		}
		if (source.kind === 'fn') {
			compileFnSource(source, stages, fn);
			return BaseTypes.Void;
		}
		if (source.kind === '?' && source.children[2] === undefined) {
			compileOptionalSource(source, stages, fn);
			return BaseTypes.Void;
		}

		let sourceType = compileExpr(source, fn);
		if (
			source.kind === 'call' &&
			sourceType.kind === 'type' &&
			sourceType.family === 'unknown'
		) {
			const inferred = inferType(source, fn);
			if (inferred.kind === 'type' && inferred.family !== 'unknown')
				sourceType = inferred;
		}
		return driveStages(stages, originalUnion ?? sourceType, fn);
	}

	/**
	 * Inline a direct-tier fn (single `next val` at tail) used as a pipe
	 * stage: bind input to the first parameter and emit the body's value
	 * through downstream stages.
	 */
	function inlineDirectFnStage(
		fnNode: NodeMap['fn'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const params = fnNode.parameters ?? [];
		const p = params[0];
		if (p) {
			const pSym = p.symbol;
			if (!pSym.type) pSym.type = inputType;
			const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(pSym, localIdx);
		} else {
			fn.body.push(OP_DROP);
		}
		const stmts = fnNode.statements ?? [];
		if (stmts.length !== 1 || stmts[0]?.kind !== 'next')
			throw new Error(
				'Only direct-tier local fns supported as inline pipe stages',
			);
		const val = stmts[0].children?.[0];
		if (!val) return driveStages(rest, BaseTypes.Void, fn);
		const t = compileExpr(val, fn);
		return driveStages(rest, t, fn);
	}

	/**
	 * Inline an anonymous sequence fn `{ ... }` body as a pipe source.
	 * Each top-level expression in the body emits through the stages.
	 */
	function compileFnSource(
		source: NodeMap['fn'],
		stages: Node[],
		fn: FuncBuilder,
	) {
		const stmts = source.statements ?? [];
		const savedFusion = fn.fusion;
		const declaredReturn = source.symbol.returnType;
		const broadenForDispatch = (t: Type): Type =>
			declaredReturn?.kind === 'type' &&
			declaredReturn.family === 'union'
				? declaredReturn
				: t;
		fn.fusion = {
			emit: (t: Type) => {
				if (stages.length === 0) {
					if (savedFusion) savedFusion.emit(t);
					else if (
						hasRuntimeValue(t)
					)
						fn.body.push(OP_DROP);
					return;
				}
				driveStages(stages, broadenForDispatch(t), fn);
			},
			targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
		};
		for (const stmt of stmts) {
			if (stmt.kind === ',') {
				for (const c of stmt.children) emitOne(c, fn);
			} else {
				emitOne(stmt, fn);
			}
		}
		fn.fusion = savedFusion;
	}

	function emitOne(expr: Node, fn: FuncBuilder) {
		if (expr.kind === 'next') {
			compileExpr(expr, fn);
			return;
		}
		if (expr.kind === 'break' || expr.kind === 'done') {
			compileExpr(expr, fn);
			return;
		}
		if (tryInlineEmitCall(expr, fn)) return;
		const t = compileExpr(expr, fn);
		if (
			fn.fusion &&
			hasRuntimeValue(t)
		) {
			fn.fusion.emit(t);
		} else if (
			hasRuntimeValue(t)
		) {
			fn.body.push(OP_DROP);
		}
	}

	function flattenPipe(children: Node[]): Node[] {
		const out: Node[] = [];
		for (const c of children) {
			if (c.kind === '>>') out.push(...flattenPipe(c.children));
			else out.push(c);
		}
		return out;
	}

	/**
	 * Inline a call to a sequence fn (`x = { ... }`) used as a pipe source.
	 * Binds the call's data-block argument to `$` and emits each top-level
	 * expression of the body through downstream stages.
	 */
	function tryInlineSequenceCall(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return false;
		const sym = callee.symbol;
		if (fnTemplates.has(sym)) return false;
		const fnDef = sym.definition;
		if (!fnDef || fnDef.kind !== 'def') return false;
		const fnNode = fnDef.value;
		if (fnNode.kind !== 'fn') return false;
		if (!(fnNode.symbol.flags & Flags.Sequence)) return false;

		const args = callNode.children[1];
		const params = fnNode.parameters ?? [];

		if (params.length > 0) {
			const argList = argListFromCall(args);
			if (!bindInlineParams(params, argList, fn)) return false;
			compileFnSource(fnNode, stages, fn);
			return true;
		}

		const dataType = buildCallDataBlock(args, fn);
		const dollarLocal = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(dollarLocal, fn.body);

		const savedDollarLocal = fn.dollarLocal;
		const savedDollarType = fn.dollarType;
		fn.dollarLocal = dollarLocal;
		fn.dollarType = dataType;
		compileFnSource(fnNode, stages, fn);
		fn.dollarLocal = savedDollarLocal;
		fn.dollarType = savedDollarType;
		return true;
	}

	/**
	 * Materialize a call's argument list as a data block in linear memory,
	 * pushing its pointer onto the stack and returning the resulting data
	 * type (so `$` member access can resolve labels to positions).
	 */
	function buildCallDataBlock(
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		if (!args) {
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Unknown;
		}
		const argList = args.kind === ',' ? args.children : [args];
		const first = argList[0];
		if (!first) {
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Unknown;
		}
		const dataNode: NodeMap['data'] = {
			...first,
			kind: 'data',
			children: [args],
		};
		return compileData(dataNode, fn);
	}

	/**
	 * Inline a multi-emit fn body at a pipe-source call site. Wraps the
	 * inlined body in a WASM block so `done` can branch to its end without
	 * returning from the enclosing function.
	 */
	function isVoidLiteralNode(n: Node | undefined): boolean {
		return (
			n?.kind === 'ident' &&
			n.symbol.kind === 'literal' &&
			n.symbol.type?.kind === 'type' &&
			n.symbol.type.family === 'void'
		);
	}

	function bindInlineParams(
		params: NodeMap['parameter'][],
		argList: Node[],
		fn: FuncBuilder,
	): boolean {
		const byName = new Map<string, Node>();
		let hasNamed = false;
		for (const a of argList)
			if (a.kind === 'propdef' && a.label && a.value) {
				hasNamed = true;
				const n = a.symbol.name;
				if (n && !isVoidLiteralNode(a.value))
					byName.set(n, a.value);
			}
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (!p) return false;
			const pSym = p.symbol;
			let argNode: Node | undefined;
			if (hasNamed) argNode = byName.get(p.symbol.name) ?? p.value;
			else {
				argNode = argList[i];
				if (isVoidLiteralNode(argNode) && p.value) argNode = p.value;
			}
			if (!argNode) return false;
			if (pSym.type?.kind === 'function') {
				// D41: a function-valued argument binds by symbol (like the
				// monomorphization path) rather than compiling as a value.
				const fa = resolveFnArg(argNode);
				if (fa) {
					fnArgBindings.set(pSym, fa);
					continue;
				}
			}
			const argType = compileExpr(argNode, fn);
			if (!pSym.type) pSym.type = argType;
			if (
				pSym.type.kind === 'type' &&
				pSym.type.family === 'union' &&
				argType.kind === 'type' &&
				argType.family !== 'union'
			) {
				pSym.type = argType;
			}
			const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(pSym, localIdx);
		}
		return true;
	}

	function getCallableFn(callNode: NodeMap['call']): NodeMap['fn'] | undefined {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return;
		const fnDef = callee.symbol.definition;
		if (!fnDef || fnDef.kind !== 'def') return;
		const fnNode = fnDef.value;
		if (fnNode.kind !== 'fn') return;
		return fnNode;
	}

	function argListFromCall(args: Node | undefined): Node[] {
		if (!args) return [];
		return args.kind === ',' ? args.children : [args];
	}

	function makeFusion(stages: Node[], savedFusion: Fusion | undefined, fn: FuncBuilder): Fusion {
		return {
			emit: (t: Type) => {
				if (stages.length === 0) {
					if (savedFusion) savedFusion.emit(t);
					else if (
						hasRuntimeValue(t) &&
						!hasRuntimeValue(fn.returnType)
					)
						fn.body.push(OP_DROP);
					return;
				}
				const cur = fn.fusion;
				fn.fusion = savedFusion;
				driveStages(stages, t, fn);
				fn.fusion = cur;
			},
			targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
		};
	}

	function tryInlineEmittingCall(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		const fnNode = getCallableFn(callNode);
		if (!fnNode) return false;
		if (fnNode.symbol.flags & Flags.Sequence) return false;
		const stmts = fnNode.statements ?? [];
		const onlyStmt = stmts.length === 1 ? stmts[0] : undefined;
		const isDirectTier =
			onlyStmt?.kind === 'next' &&
			onlyStmt.children?.[0]?.kind !== ',';
		if (isDirectTier) return false;
		const hasEmitting = stmts.some(
			s => s.kind === 'next' || s.kind === 'done',
		);
		if (!hasEmitting) return false;

		const params = fnNode.parameters ?? [];
		const argList = argListFromCall(callNode.children[1]);
		const savedParamTypes: (Type | undefined)[] = params.map(
			p => p.symbol.type,
		);
		if (!bindInlineParams(params, argList, fn)) return false;

		fn.body.push(OP_BLOCK);
		fn.body.push(0x40);
		fn.blockDepth++;
		const doneDepth = fn.blockDepth;
		const savedFusion = fn.fusion;
		const savedDoneDepth = fn.doneDepth;
		fn.doneDepth = doneDepth;
		fn.fusion = makeFusion(stages, savedFusion, fn);
		for (const stmt of stmts) compileExpr(stmt, fn);
		fn.fusion = savedFusion;
		fn.doneDepth = savedDoneDepth;
		fn.body.push(OP_END);
		fn.blockDepth--;
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			const saved = savedParamTypes[i];
			if (p && saved) p.symbol.type = saved;
		}
		return true;
	}

	function bindStreamParams(
		params: NodeMap['parameter'][],
		argList: Node[],
		fn: FuncBuilder,
	): boolean {
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (!p) return false;
			const pSym = p.symbol;
			let argNode = argList[i];
			if (
				argNode?.kind === 'ident' &&
				argNode.symbol.kind === 'literal' &&
				argNode.symbol.type?.kind === 'type' &&
				argNode.symbol.type.family === 'void' &&
				p.value
			)
				argNode = p.value;
			if (!argNode) return false;
			const argType = compileExpr(argNode, fn);
			if (!pSym.type) pSym.type = argType;
			const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(pSym, localIdx);
		}
		return true;
	}

	function tryInlineStreamCall(
		callNode: NodeMap['call'],
		fn: FuncBuilder,
	): Node | undefined {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return;
		const sym = callee.symbol;
		if (fnTemplates.has(sym)) return;
		const fnNode = getCallableFn(callNode);
		if (!fnNode) return;
		const stmts = fnNode.statements ?? [];
		const tail = stmts[stmts.length - 1];
		if (tail?.kind !== 'next') return;
		const body = tail.children?.[0];
		if (!body) return;
		for (let i = 0; i < stmts.length - 1; i++) {
			const s = stmts[i];
			if (!s || (s.kind !== 'def' && s.kind !== '=')) return;
		}

		const params = fnNode.parameters ?? [];
		const argList = argListFromCall(callNode.children[1]);
		if (!bindStreamParams(params, argList, fn)) return;
		for (let i = 0; i < stmts.length - 1; i++) {
			const s = stmts[i];
			if (s) compileExpr(s, fn);
		}
		return body;
	}

	function compileLoopSource(stages: Node[], fn: FuncBuilder) {
		const counter = allocLocal(fn, I32);
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(counter, fn.body);

		fn.body.push(OP_BLOCK);
		fn.body.push(0x40);
		fn.blockDepth++;
		const targetDepth = fn.blockDepth;
		fn.body.push(OP_LOOP);
		fn.body.push(0x40);
		fn.blockDepth++;

		const savedFusion = fn.fusion;
		fn.fusion = {
			emit: (t: Type) => {
				if (savedFusion) {
					savedFusion.emit(t);
					return;
				}
				if (
					hasRuntimeValue(t)
				)
					fn.body.push(OP_DROP);
			},
			targetDepth,
		};

		fn.body.push(OP_LOCAL_GET);
		uleb128(counter, fn.body);
		driveStages(stages, BaseTypes.Int32, fn);

		fn.body.push(OP_LOCAL_GET);
		uleb128(counter, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(1, fn.body);
		fn.body.push(OP_I32_ADD);
		fn.body.push(OP_LOCAL_SET);
		uleb128(counter, fn.body);

		fn.body.push(OP_BR);
		uleb128(0, fn.body);

		fn.body.push(OP_END);
		fn.blockDepth--;
		fn.body.push(OP_END);
		fn.blockDepth--;

		fn.fusion = savedFusion;
	}

	function driveStagesEmpty(inputType: Type, fn: FuncBuilder): Type {
		const hasValue =
			hasRuntimeValue(inputType);
		if (hasValue && fn.fusion) {
			fn.fusion.emit(inputType);
			return BaseTypes.Void;
		}
		if (hasValue) fn.body.push(OP_DROP);
		return BaseTypes.Void;
	}

	function driveFnStage(
		stage: NodeMap['fn'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const params = stage.parameters ?? [];
		const savedDollarLocal = fn.dollarLocal;
		const savedDollarType = fn.dollarType;
		let savedSlotTypes: (Type | undefined)[] | undefined;
		const scalarLift =
			inTemplateInline > 0 &&
			params.length > 1 &&
			!(inputType.kind === 'type' && inputType.family === 'data');
		const isMultiData = params.length > 1 && !scalarLift;
		if (scalarLift) {
			// D39: scalar input lifts to [scalar] — head slot = the value (on
			// stack), remaining slots = Void. Used by recursive generic stages
			// when the data has collapsed to a scalar (D10).
			savedSlotTypes = params.map(p => p.symbol.type);
			params.forEach((p, idx) => {
				if (!p.type)
					p.symbol.type = idx === 0 ? inputType : BaseTypes.Void;
				const localIdx = allocLocal(fn, I32);
				if (idx !== 0) {
					fn.body.push(OP_I32_CONST);
					sleb128(0, fn.body);
				}
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.paramMap.set(p.symbol, localIdx);
			});
		} else if (isMultiData) {
			const dataLocal = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_SET);
			uleb128(dataLocal, fn.body);
			const itemSize =
				inputType.kind === 'type' && inputType.size > 0
					? inputType.size
					: 4;
			const inputMembers =
				inputType.kind === 'type' &&
				inputType.family === 'data' &&
				Object.keys(inputType.members).length > 0
					? Object.keys(inputType.members)
					: undefined;
			const headCount = params.length - 1;
			// D39/D43: when a slot's type is still abstract (a type param, from
			// inlining a generic stage), derive it from the concrete input via
			// head-rest, per call (save/restore). Concrete slots are left as the
			// checker set them.
			savedSlotTypes = params.map(p => p.symbol.type);
			const allKeys = inputMembers ?? [];
			if (inTemplateInline > 0)
				params.forEach((p, idx) => {
				// Re-derive unannotated slots from the concrete input every call
				// (recursion needs the shrinking per-level type); annotated slots
				// keep their declared type.
				if (p.type) return;
				if (idx < headCount) {
					p.symbol.type =
						inputType.kind === 'type' && inputType.family === 'data'
							? (inputType.members[allKeys[idx] ?? '']?.type ?? BaseTypes.Int32)
							: inputType;
					return;
				}
				if (inputType.kind !== 'type' || inputType.family !== 'data') {
					p.symbol.type = BaseTypes.Void; // scalar → empty rest
					return;
				}
				const restKeys = allKeys.slice(headCount);
				if (restKeys.length === 0) p.symbol.type = BaseTypes.Void;
				else if (restKeys.length === 1)
					p.symbol.type =
						inputType.members[restKeys[0] ?? '']?.type ?? BaseTypes.Int32;
				else {
					const members: Record<string, GbcSymbol> = {};
					restKeys.forEach((k, i) => {
						members[String(i)] = {
							kind: 'variable',
							name: String(i),
							flags: 0,
							type: inputType.members[k]?.type ?? BaseTypes.Int32,
						};
					});
					p.symbol.type = {
						kind: 'type',
						flags: 0,
						name: '__data',
						family: 'data',
						size: 0,
						members,
					};
				}
			});
			params.forEach((p, idx) => {
				const pSym = p.symbol;
				if (!pSym.type) pSym.type = BaseTypes.Int32;
				const ptype = pSym.type;
				const isLast = idx === headCount;
				// D39: empty rest binds Void.
				if (isLast && ptype.kind === 'type' && ptype.family === 'void') {
					const localIdx = allocLocal(fn, I32);
					fn.body.push(OP_I32_CONST);
					sleb128(0, fn.body);
					fn.body.push(OP_LOCAL_SET);
					uleb128(localIdx, fn.body);
					fn.paramMap.set(pSym, localIdx);
					return;
				}
				const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
				// D39: multi-element rest materializes a sub-data-block; a
				// single-element rest (D10 collapse) falls through to slot read.
				if (isLast && ptype.kind === 'type' && ptype.family === 'data') {
					const restCount = Object.keys(ptype.members).length;
					const header: number[] = [];
					u32le(restCount, header);
					u32le(itemSize, header);
					const restOffset = heap;
					heap += header.length;
					datas.push({ offset: restOffset, bytes: header });
					const slotsOffset = heap;
					const empty: number[] = [];
					for (let i = 0; i < restCount * itemSize; i++) empty.push(0);
					datas.push({ offset: slotsOffset, bytes: empty });
					heap += empty.length;
					heap = (heap + 7) & ~7;
					for (let i = 0; i < restCount; i++) {
						fn.body.push(OP_I32_CONST);
						sleb128(slotsOffset + i * itemSize, fn.body);
						fn.body.push(OP_LOCAL_GET);
						uleb128(dataLocal, fn.body);
						fn.body.push(OP_I32_CONST);
						sleb128(8 + (headCount + i) * itemSize, fn.body);
						fn.body.push(OP_I32_ADD);
						fn.body.push(OP_I32_LOAD);
						uleb128(2, fn.body);
						uleb128(0, fn.body);
						fn.body.push(OP_I32_STORE);
						uleb128(2, fn.body);
						uleb128(0, fn.body);
					}
					fn.body.push(OP_I32_CONST);
					sleb128(restOffset, fn.body);
					fn.body.push(OP_LOCAL_SET);
					uleb128(localIdx, fn.body);
					fn.paramMap.set(pSym, localIdx);
					return;
				}
				const labelIdx =
					inputMembers && pSym.name
						? inputMembers.indexOf(pSym.name)
						: -1;
				const slotIdx = labelIdx >= 0 ? labelIdx : idx;
				fn.body.push(OP_LOCAL_GET);
				uleb128(dataLocal, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(8 + slotIdx * itemSize, fn.body);
				fn.body.push(OP_I32_ADD);
				fn.body.push(OP_I32_LOAD);
				uleb128(2, fn.body);
				uleb128(0, fn.body);
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.paramMap.set(pSym, localIdx);
			});
		} else {
			const p = params[0];
			if (p) {
				const pSym = p.symbol;
				if (!pSym.type) {
					if (p.type?.kind === 'typeident' && p.type.symbol.kind === 'type')
						pSym.type = p.type.symbol;
					else pSym.type = inputType;
				}
				const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.paramMap.set(pSym, localIdx);
				if (!p.label) {
					fn.dollarLocal = localIdx;
					fn.dollarType = pSym.type ?? inputType;
				}
			} else {
				const localIdx = allocLocal(fn, I32);
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.dollarLocal = localIdx;
				fn.dollarType = inputType;
			}
		}

		const savedFusion = fn.fusion;
		fn.fusion = makeFusion(rest, savedFusion, fn);
		const isSequence = !!(stage.symbol.flags & Flags.Sequence);
		for (const stmt of stage.statements ?? []) {
			if (!isSequence) compileExpr(stmt, fn);
			else if (stmt.kind === ',')
				for (const c of stmt.children) emitOne(c, fn);
			else emitOne(stmt, fn);
		}
		fn.fusion = savedFusion;
		fn.dollarLocal = savedDollarLocal;
		fn.dollarType = savedDollarType;
		if (savedSlotTypes)
			params.forEach((p, i) => {
				p.symbol.type = savedSlotTypes![i];
			});
		return BaseTypes.Void;
	}

	// D17: drive a generic Sequence template as a pipe stage. The piped value
	// (already on the stack) becomes the template's first value-param; mirrors
	// tryInlineEmitTemplate but sources its input from the pipe, not call args.
	function driveTemplateStage(
		template: NodeMap['fn'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const vparams = template.parameters ?? [];
		const p0 = vparams[0];
		if (!p0) return BaseTypes.Void;
		const isVoid = inputType.kind === 'type' && inputType.family === 'void';
		const isEmpty =
			inputType.kind === 'type' &&
			inputType.family === 'data' &&
			Object.keys(inputType.members).length === 0;
		if (isVoid || isEmpty) {
			if (!isVoid) fn.body.push(OP_DROP);
			return BaseTypes.Void; // base case: nothing to emit
		}
		const saved = vparams.map(p => p.symbol.type);
		if (p0.symbol.type?.kind !== 'function') p0.symbol.type = inputType;
		if (inputType.kind === 'type' && inputType.family === 'unknown')
			throw new Error(
				`stage "${template.symbol.name ?? '?'}" received an unresolved (unknown) input type — the upstream value's type could not be inferred (e.g. an unresolved generic return)`,
			);
		const localIdx = allocLocal(fn, gbcToWasm(inputType));
		fn.body.push(OP_LOCAL_SET);
		uleb128(localIdx, fn.body);
		fn.paramMap.set(p0.symbol, localIdx);
		inTemplateInline++;
		compileFnSource(template, rest, fn);
		inTemplateInline--;
		vparams.forEach((p, i) => {
			p.symbol.type = saved[i];
		});
		return BaseTypes.Void;
	}

	function driveIdentStage(
		stage: NodeMap['ident'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const sym = stage.symbol;
		if (
			sym.kind === 'function' &&
			sym.flags & Flags.Intrinsic &&
			sym.name === 'out'
		) {
			emitOutHostCall(inputType, fn);
			return driveStages(rest, BaseTypes.Void, fn);
		}
		const template = fnTemplates.get(sym);
		if (template && template.symbol.flags & Flags.Sequence)
			return driveTemplateStage(template, inputType, rest, fn);
		const def = sym.definition;
		const fnValue =
			def?.kind === 'def' && def.value.kind === 'fn'
				? def.value
				: undefined;
		if (fnValue && fnValue.symbol.flags & Flags.Sequence) {
			const params = fnValue.parameters ?? [];
			if (params.length > 0)
				return driveFnStage(fnValue, inputType, rest, fn);
			const dollarLocal = allocLocal(fn, gbcToWasm(inputType));
			fn.body.push(OP_LOCAL_SET);
			uleb128(dollarLocal, fn.body);
			const savedDollarLocal = fn.dollarLocal;
			const savedDollarType = fn.dollarType;
			fn.dollarLocal = dollarLocal;
			fn.dollarType = inputType;
			compileFnSource(fnValue, rest, fn);
			fn.dollarLocal = savedDollarLocal;
			fn.dollarType = savedDollarType;
			return BaseTypes.Void;
		}
		const builderIdx = fnDefBuilderIdx.get(sym);
		if (builderIdx !== undefined) {
			emitFixedCall(fn, builderIdx);
			const fnSym =
				sym.kind === 'function'
					? sym
					: sym.type?.kind === 'function'
						? sym.type
						: undefined;
			const retType = fnSym?.returnType ?? BaseTypes.Unknown;
			return driveStages(rest, retType, fn);
		}
		if (fnValue) return inlineDirectFnStage(fnValue, inputType, rest, fn);
		const dt = sym.kind === 'function' ? sym : sym.type;
		if (dt && dt.kind === 'function' && dt.overloads) {
			if (inputType.kind === 'type' && inputType.family === 'void')
				return driveStages(rest, BaseTypes.Void, fn);
			const arm = findDispatchArm(dt.overloads, [inputType]);
			if (arm) {
				const tmpl = fnTemplates.get(arm);
				if (tmpl) {
					const idx = getOrCreateSpec(tmpl, [inputType]);
					emitFixedCall(fn, idx);
					const r = specReturn.get(idx) ?? arm.returnType ?? BaseTypes.Void;
					return driveStages(rest, r, fn);
				}
				emitArmCall(arm, sym.name, fn);
				return driveStages(rest, arm.returnType ?? BaseTypes.Void, fn);
			}
		}
		throw new Error(`Unknown pipe-stage ident: "${sym.name ?? '?'}"`);
	}

	function stageDispatchType(
		stage: Node,
	): SymbolMap['type'] | undefined {
		if (stage.kind !== 'fn') return undefined;
		const params = stage.parameters ?? [];
		const p = params[0];
		if (params.length !== 1 || !p) return undefined;
		let t = p.symbol.type;
		if ((!t || t.kind !== 'type') && p.type?.kind === 'typeident') {
			const ts = p.type.symbol;
			if (ts.kind === 'type') t = ts;
		}
		if (!t || t.kind !== 'type') return undefined;
		if (
			t.family === 'literal' ||
			t.family === 'error' ||
			t.family === 'int' ||
			t.family === 'uint' ||
			t.family === 'float' ||
			t.family === 'bool' ||
			t.family === 'string'
		)
			return t;
		return undefined;
	}

	function isDispatchedInput(t: Type): boolean {
		if (t.kind !== 'type') return false;
		if (t.family === 'union') return true;
		return false;
	}

	function driveStages(
		stages: Node[],
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		if (stages.length === 0) return driveStagesEmpty(inputType, fn);
		const [stage, ...rest] = stages;
		if (!stage) return BaseTypes.Void;

		if (stage.kind === '.') {
			const outType = emitHostStage(stage, fn);
			return driveStages(rest, outType, fn);
		}

		// Dispatch group: when input is a union and consecutive stages are
		// typed to discriminate union members.
		const dispatchOnInput = isDispatchedInput(inputType);
		const firstDispatchType = stageDispatchType(stage);
		const useDispatch =
			(dispatchOnInput && firstDispatchType) ||
			(firstDispatchType && firstDispatchType.family === 'literal');
		if (useDispatch) {
			let n = 0;
			while (n < stages.length) {
				const s = stages[n];
				if (!s || !stageDispatchType(s)) break;
				n++;
			}
			const dispatchStages = stages.slice(0, n);
			const after = stages.slice(n);
			return driveDispatch(dispatchStages, after, inputType, fn);
		}

		if (stage.kind === 'fn') return driveFnStage(stage, inputType, rest, fn);
		if (stage.kind === 'ident') return driveIdentStage(stage, inputType, rest, fn);

		throw new Error(`Unsupported pipe stage: ${stage.kind}`);
	}

	function driveDispatch(
		dispatchStages: Node[],
		afterStages: Node[],
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		const inputLocal = allocLocal(fn, gbcToWasm(inputType));
		fn.body.push(OP_LOCAL_SET);
		uleb128(inputLocal, fn.body);
		for (const ds of dispatchStages) {
			if (ds.kind !== 'fn') continue;
			const dispatchType = stageDispatchType(ds);
			if (!dispatchType) continue;
			fn.body.push(OP_LOCAL_GET);
			uleb128(inputLocal, fn.body);
			if (
				dispatchType.family === 'literal' &&
				typeof dispatchType.value === 'boolean'
			) {
				fn.body.push(OP_I32_CONST);
				sleb128(dispatchType.value ? 1 : 0, fn.body);
				fn.body.push(0x46); // i32.eq
			} else if (
				dispatchType.family === 'literal' &&
				typeof dispatchType.value === 'number'
			) {
				fn.body.push(OP_I32_CONST);
				sleb128(dispatchType.value | 0, fn.body);
				fn.body.push(0x46); // i32.eq
			} else if (
				dispatchType.family === 'literal' &&
				typeof dispatchType.value === 'string'
			) {
				const ptr = intern(dispatchType.value);
				fn.body.push(OP_I32_CONST);
				sleb128(ptr, fn.body);
				fn.body.push(0x46); // i32.eq
			} else if (dispatchType.family === 'error') {
				// Error variant: tagged with high bit set.
				fn.body.push(OP_I32_CONST);
				sleb128(-0x80000000, fn.body);
				fn.body.push(0x71); // i32.and
			} else if (
				dispatchType.family === 'int' ||
				dispatchType.family === 'uint' ||
				dispatchType.family === 'float' ||
				dispatchType.family === 'bool' ||
				dispatchType.family === 'string'
			) {
				// Non-Error variant: dispatch only when Error tag bit is clear.
				fn.body.push(OP_I32_CONST);
				sleb128(-0x80000000, fn.body);
				fn.body.push(0x71); // i32.and
				fn.body.push(0x45); // i32.eqz — true when high bit is 0
			} else {
				fn.body.push(OP_DROP);
				fn.body.push(OP_I32_CONST);
				sleb128(0, fn.body);
			}
			fn.body.push(OP_IF);
			fn.body.push(0x40);
			fn.blockDepth++;
			fn.body.push(OP_LOCAL_GET);
			uleb128(inputLocal, fn.body);
			driveFnStage(ds, inputType, afterStages, fn);
			fn.body.push(OP_END);
			fn.blockDepth--;
		}
		return BaseTypes.Void;
	}

	function emitHostStage(stage: Node, fn: FuncBuilder): Type {
		if (stage.kind !== '.')
			throw new Error(`Unsupported pipe stage: ${stage.kind}`);
		const recv = stage.children[0];
		const field = stage.children[1];
		if (recv.kind !== '@')
			throw new Error('Pipe stage must be a module access (@module.X)');
		if (field.kind !== 'ident')
			throw new Error('Pipe stage must name a member');
		const fname = field.symbol.name;
		if (!fname) throw new Error('Stage member is unnamed');

		if (field.symbol.kind !== 'function')
			throw new Error(`Pipe stage member "${fname}" is not a function`);
		const sig = fnSignature(field.symbol);
		const idx = importHost(fname, sig.params, sig.results);
		fn.body.push(OP_CALL);
		uleb128(idx, fn.body);
		return field.symbol.returnType ?? BaseTypes.Void;
	}

	function allocLocal(fn: FuncBuilder, type: number): number {
		const idx = fn.paramCount + fn.locals.length;
		fn.locals.push(type);
		return idx;
	}

	function compileCallArgs(
		args: Node | undefined,
		calleeSym: SymbolMap['function'],
		fn: FuncBuilder,
		bindings?: Map<GbcSymbol, SymbolMap['function']>,
	) {
		const argList = argListFromCall(args);
		const params = calleeSym.parameters ?? [];
		const anyNamed = argList.some(a => a.kind === 'propdef');
		const anyPositional = argList.some(a => a.kind !== 'propdef');
		if (anyNamed && anyPositional)
			throw new Error('cannot mix positional and named arguments');
		const paramDefault = (sym: GbcSymbol | undefined): Node | undefined => {
			const def = sym?.definition;
			return def?.kind === 'parameter' ? def.value : undefined;
		};
		const isVoidLiteral = (n: Node | undefined) =>
			n?.kind === 'ident' &&
			n.symbol.kind === 'literal' &&
			n.symbol.name === 'void';
		if (anyNamed) {
			const byName = new Map<string, Node>();
			for (const a of argList) {
				if (a.kind === 'propdef' && a.label && a.value) {
					const n = a.symbol.name;
					if (n && !isVoidLiteral(a.value)) byName.set(n, a.value);
				}
			}
			for (const p of params) {
				if (bindings?.has(p)) continue;
				const n = p.name;
				if (!n) throw new Error('Parameter without a name');
				const v = byName.get(n) ?? paramDefault(p);
				if (!v)
					throw new Error(
						`no match: missing argument for parameter "${n}"`,
					);
				compileExpr(v, fn);
			}
		} else {
			for (let i = 0; i < params.length; i++) {
				const p = params[i];
				if (p && bindings?.has(p)) continue;
				let a = argList[i];
				if (isVoidLiteral(a)) a = paramDefault(p);
				a ??= paramDefault(p);
				if (!a)
					throw new Error(
						`Missing argument for parameter "${p?.name ?? '?'}"`,
					);
				compileExpr(a, fn);
			}
		}
	}

	/**
	 * Allocate a fresh `FuncBuilder` for `fnNode` and append it to
	 * `funcBuilders`. Used by both `declareFn` (eager, per source-level fn)
	 * and `getOrCreateSpec` (per-call-site specialization).
	 */
	function buildParamTypes(
		paramSyms: NodeMap['parameter'][],
	): { paramTypes: number[]; paramMap: Map<GbcSymbol, number> } {
		const paramTypes: number[] = [];
		const paramMap = new Map<GbcSymbol, number>();
		let local = 0;
		for (let i = 0; i < paramSyms.length; i++) {
			const p = paramSyms[i];
			if (!p) continue;
			const sym = p.symbol;
			if (fnArgBindings.has(sym)) continue;
			if (!sym.type) sym.type = BaseTypes.Int32;
			paramTypes.push(gbcToWasm(sym.type));
			paramMap.set(sym, local++);
		}
		return { paramTypes, paramMap };
	}

	function resolveFnReturnType(
		fnNode: NodeMap['fn'],
		typeArgs?: Map<string, Type>,
	): Type {
		let returnType: Type = fnNode.returnType
			? resolveTypeFromNode(fnNode.returnType)
			: BaseTypes.Unknown;
		if (
			returnType.kind === 'type' &&
			returnType.family === 'unknown' &&
			returnType.name
		) {
			const concrete = typeArgs?.get(returnType.name);
			if (
				concrete &&
				concrete.kind === 'type' &&
				concrete.family !== 'unknown'
			)
				returnType = concrete;
		}
		// D43: reduce an applied type-level chain return (e.g. `First<T>`)
		// using the now-concrete type-param placeholders (getOrCreateSpec
		// mutated them before this runs).
		if (
			returnType.kind === 'type' &&
			(returnType.application || returnType.family === 'unknown')
		) {
			const reduced = reduceType(returnType, new Map());
			if (reduced.kind === 'type' && reduced.family !== 'unknown')
				returnType = reduced;
		}
		const stmts = fnNode.statements ?? [];
		const single = stmts.length === 1 ? stmts[0] : undefined;
		if (
			!single ||
			returnType.kind !== 'type' ||
			returnType.family !== 'unknown'
		)
			return returnType;
		const fromChecker = fnNode.symbol.returnType;
		if (fromChecker && hasRuntimeValue(fromChecker)) return fromChecker;
		const val =
			single.kind === 'next'
				? single.children?.[0]
				: single.kind === 'def' ||
					  single.kind === 'break' ||
					  single.kind === 'done'
					? undefined
					: single;
		if (val) {
			const inferred = inferType(val);
			if (hasRuntimeValue(inferred)) return inferred;
		}
		return returnType;
	}

	function allocFuncBuilder(
		fnNode: NodeMap['fn'],
		typeArgs?: Map<string, Type>,
	): {
		builder: FuncBuilder;
		builderIdx: number;
		returnType: Type;
	} {
		const paramSyms = fnNode.parameters ?? [];
		const { paramTypes, paramMap } = buildParamTypes(paramSyms);
		const returnType = resolveFnReturnType(fnNode, typeArgs);
		const resultTypes: number[] = [];
		if (
			hasRuntimeValue(returnType)
		)
			resultTypes.push(gbcToWasm(returnType));
		const builder: FuncBuilder = {
			typeIdx: typeIdx(paramTypes, resultTypes),
			body: [],
			locals: [],
			paramCount: paramTypes.length,
			paramMap,
			returnType,
			callFixups: [],
			blockDepth: 0,
		};
		const builderIdx = funcBuilders.length;
		funcBuilders.push(builder);
		return { builder, builderIdx, returnType };
	}

	function declareFn(defSym: GbcSymbol, fnNode: NodeMap['fn']) {
		const paramSyms = fnNode.parameters ?? [];
		const fnSym = fnNode.symbol;
		fnSym.parameters = paramSyms.map(p => p.symbol);
		const needsSpec =
			(fnNode.typeParameters?.length ?? 0) > 0 ||
			paramSyms.some(p => {
				const t = p.symbol.type;
				return (
					t?.kind === 'function' ||
					(t?.kind === 'type' && t.family === 'union')
				);
			});
		if (needsSpec) {
			fnTemplates.set(defSym, fnNode);
			fnTemplates.set(fnSym, fnNode);
			return null;
		}
		const { builder, builderIdx, returnType } = allocFuncBuilder(fnNode);
		fnSym.returnType = returnType;
		fnDefBuilderIdx.set(defSym, builderIdx);
		fnDefBuilderIdx.set(fnSym, builderIdx);
		return { builder, fnNode };
	}

	/**
	 * Compose a deterministic cache key for the (template, argTypes) pair.
	 * Uses the fn symbol's identity (via a side-table id) and the names of
	 * the concrete argument types.
	 */
	function idOf(sym: GbcSymbol): number {
		let id = specTemplateIds.get(sym);
		if (id === undefined) {
			id = specTemplateIds.size;
			specTemplateIds.set(sym, id);
		}
		return id;
	}

	function typeKey(t: Type): string {
		if (t.kind !== 'type') return 'fn';
		if (t.family === 'data')
			return (
				'[' +
				Object.keys(t.members)
					.map(k => typeKey(t.members[k]?.type ?? BaseTypes.Unknown))
					.join(',') +
				']'
			);
		if (t.family === 'union')
			return '(' + t.members.map(typeKey).join('|') + ')';
		return t.name;
	}

	function specKey(
		template: NodeMap['fn'],
		argTypes: Type[],
		bindings: Map<GbcSymbol, SymbolMap['function']>,
	): string {
		const bk = [...bindings.entries()]
			.map(([p, f]) => `${idOf(p)}:${idOf(f)}`)
			.join(',');
		return `${idOf(template.symbol)}|${argTypes
			.map(typeKey)
			.join(',')}|${bk}`;
	}

	/**
	 * Resolve or compile a per-signature specialization of `template`.
	 * Each (template, concrete-arg-types) pair gets its own WASM function
	 * with the union-typed param symbols narrowed to the call's concrete
	 * arms — so `is T` inside the body lowers to a constant from the
	 * narrowed `sym.type`. Save/restore around the body compile keeps
	 * sibling specializations and the parent template's declared types
	 * unaffected.
	 */
	/**
	 * D43: structurally unify a value-param's declared type against the call's
	 * concrete arg type, binding type-param placeholders (by name) to concrete
	 * types. Handles direct params (`x: T`) and nested data (`p: [T, U]`).
	 */
	function unifyTypeParam(
		paramType: Type | undefined,
		argType: Type | undefined,
		names: Set<string>,
		out: Map<string, Type>,
	) {
		if (!paramType || !argType) return;
		if (
			paramType.kind === 'type' &&
			paramType.family === 'unknown' &&
			paramType.name &&
			names.has(paramType.name)
		) {
			if (argType.kind === 'type' && !out.has(paramType.name))
				out.set(paramType.name, argType);
			return;
		}
		if (
			paramType.kind === 'type' &&
			paramType.family === 'data' &&
			argType.kind === 'type' &&
			argType.family === 'data'
		) {
			const pk = Object.keys(paramType.members);
			const ak = Object.keys(argType.members);
			for (let i = 0; i < pk.length; i++)
				unifyTypeParam(
					paramType.members[pk[i] ?? '']?.type,
					argType.members[ak[i] ?? '']?.type,
					names,
					out,
				);
		}
	}

	const inProgressSpecs = new Set<string>();

	function getOrCreateSpec(
		template: NodeMap['fn'],
		argTypes: Type[],
		bindings: Map<GbcSymbol, SymbolMap['function']> = new Map(),
	): number {
		const key = specKey(template, argTypes, bindings);
		const specDesc =
			(template.symbol.name ?? '?') +
			'(' +
			argTypes
				.map(t =>
					t.kind === 'type'
						? t.family +
							(t.family === 'data'
								? '[' + Object.keys(t.members).length + ']'
								: '')
						: t.kind,
				)
				.join(', ') +
			')';
		const cached = specCache.get(key);
		if (cached !== undefined) {
			if (
				inProgressSpecs.has(key) &&
				template.symbol.flags & Flags.Sequence
			)
				throw new Error(
					`Recursive generic ${specDesc} does not reduce toward a base case — its recursive call repeats the same argument type, so it would not terminate.`,
				);
			return cached;
		}
		inProgressSpecs.add(key);
		const params = template.parameters ?? [];
		const saved = params.map(p => p.symbol.type);
		params.forEach((p, i) => {
			const sym = p.symbol;
			const at = argTypes[i];
			if (
				sym.type?.kind === 'type' &&
				sym.type.family === 'union' &&
				at &&
				at.kind === 'type' &&
				at.family !== 'union'
			)
				sym.type = at;
		});
		const prevBindings = new Map<GbcSymbol, SymbolMap['function'] | undefined>();
		for (const [psym, fnsym] of bindings) {
			prevBindings.set(psym, fnArgBindings.get(psym));
			fnArgBindings.set(psym, fnsym);
		}
		// D43: bind type-param placeholders to the call's concrete arg types,
		// mutating each placeholder in place (value params and the return type
		// all reference it) and restoring after the body compiles.
		const setType = (target: object, src: object) => {
			for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
			Object.assign(target, src);
		};
		const tparams = template.typeParameters ?? [];
		const restorePh: { ph: object; saved: object }[] = [];
		const subst = new Map<string, Type>();
		if (tparams.length) {
			const names = new Set(
				tparams.map(tp => tp.symbol.name).filter((n): n is string => !!n),
			);
			params.forEach((p, i) =>
				unifyTypeParam(p.symbol.type, argTypes[i], names, subst),
			);
			for (const tp of tparams) {
				const ph = tp.symbol.type;
				const concrete = tp.symbol.name
					? subst.get(tp.symbol.name)
					: undefined;
				if (ph?.kind === 'type' && concrete?.kind === 'type') {
					restorePh.push({ ph, saved: { ...ph } });
					setType(ph, concrete);
				}
			}
		}
		const { builder, builderIdx, returnType } = allocFuncBuilder(
			template,
			subst,
		);
		specReturn.set(builderIdx, returnType);
		// Register BEFORE compiling the body so recursive calls inside the
		// body resolve to this in-progress spec via the cache.
		specCache.set(key, builderIdx);
		// Return type is now fixed; bind each value param to its concrete arg
		// type for the body so a recursive generic call sees the shrunk
		// per-level type (the shared placeholder is mutated in place and cannot
		// rebind per level). Restored from `saved` after the body compiles.
		params.forEach((p, i) => {
			const at = argTypes[i];
			if (at && at.kind === 'type' && p.symbol.type?.kind !== 'function')
				p.symbol.type = at;
		});
		const seqTemplate = !!(template.symbol.flags & Flags.Sequence);
		if (seqTemplate) inTemplateInline++;
		compileFnBody(builder, template);
		if (seqTemplate) inTemplateInline--;
		params.forEach((p, i) => {
			const t = saved[i];
			if (t) p.symbol.type = t;
		});
		for (const { ph, saved: f } of restorePh) setType(ph, f);
		for (const [psym, prev] of prevBindings) {
			if (prev === undefined) fnArgBindings.delete(psym);
			else fnArgBindings.set(psym, prev);
		}
		inProgressSpecs.delete(key);
		return builderIdx;
	}

	const specTemplateIds = new Map<GbcSymbol, number>();

	/**
	 * Walk the arg list (single arg or comma-separated) and resolve each
	 * arg's static type via `inferType`. Used by `compileCall` to compute
	 * the signature key for monomorphization.
	 */
	function collectArgTypes(
		args: Node | undefined,
		fn: FuncBuilder,
	): Type[] {
		if (!args) return [];
		if (args.kind === ',')
			return args.children.map(c => inferType(c, fn));
		return [inferType(args, fn)];
	}

	function compileFnBody(builder: FuncBuilder, fnNode: NodeMap['fn']) {
		const stmts = fnNode.statements ?? [];
		// Direct tier: single `next val` at tail. Body compiles to "push val".
		if (stmts.length === 1 && stmts[0]?.kind === 'next') {
			const val = stmts[0].children?.[0];
			if (val) {
				const t = compileExpr(val, builder);
				// Drop the value if the fn declares no return type (void).
				const rt = builder.returnType;
				const fnHasNoResult =
					rt.kind !== 'type' ||
					rt.family === 'void' ||
					rt.family === 'unknown';
				if (
					fnHasNoResult &&
					hasRuntimeValue(t)
				) {
					builder.body.push(OP_DROP);
				}
			}
			return;
		}
		// General body: emit each statement. Drop intermediate values. The
		// tail expression keeps its value on the stack when the fn declares
		// a matching non-void return type (provides the return value).
		const rt = builder.returnType;
		const hasReturn =
			hasRuntimeValue(rt);
		for (let i = 0; i < stmts.length; i++) {
			const stmt = stmts[i];
			if (!stmt) continue;
			const isTail = i === stmts.length - 1;
			const t = compileExpr(stmt, builder);
			const valueOnStack =
				hasRuntimeValue(t);
			if (!valueOnStack) continue;
			if (isTail && hasReturn) continue;
			builder.body.push(OP_DROP);
		}
	}

	function initNumberGlobal(
		value: NodeMap['number'],
		declaredType: Type | undefined,
	): { initBuf: number[]; wasmType: number; valueType: Type } {
		const initBuf: number[] = [];
		let valueType: Type = Number.isInteger(value.value)
			? BaseTypes.Int32
			: BaseTypes.Float64;
		if (declaredType && isFloatType(declaredType)) {
			valueType = declaredType;
			initBuf.push(OP_F64_CONST);
			f64le(value.value, initBuf);
			return { initBuf, wasmType: F64, valueType };
		}
		if (isFloatType(valueType)) {
			initBuf.push(OP_F64_CONST);
			f64le(value.value, initBuf);
			return { initBuf, wasmType: F64, valueType };
		}
		initBuf.push(OP_I32_CONST);
		sleb128(value.value | 0, initBuf);
		return { initBuf, wasmType: I32, valueType };
	}

	function initIdentGlobal(
		value: NodeMap['ident'],
	): {
		initBuf: number[];
		wasmType: number;
		valueType: Type | undefined;
		needsRuntimeInit: boolean;
	} {
		const initBuf: number[] = [];
		const idSym = value.symbol;
		if (idSym.kind === 'literal') {
			const t = idSym.type;
			if (t?.kind === 'type') {
				if (t.family === 'bool') {
					initBuf.push(OP_I32_CONST);
					sleb128(idSym.value ? 1 : 0, initBuf);
					return { initBuf, wasmType: I32, valueType: t, needsRuntimeInit: false };
				}
				if (t.family === 'float') {
					initBuf.push(OP_F64_CONST);
					f64le(idSym.value as number, initBuf);
					return { initBuf, wasmType: F64, valueType: t, needsRuntimeInit: false };
				}
			}
		}
		initBuf.push(OP_I32_CONST);
		sleb128(0, initBuf);
		return { initBuf, wasmType: I32, valueType: undefined, needsRuntimeInit: true };
	}

	function initPlaceholderGlobal(
		value: Node,
		declaredType: Type | undefined,
	): { initBuf: number[]; wasmType: number; valueType: Type } {
		const initBuf: number[] = [];
		const inferred = declaredType ?? inferType(value);
		if (inferred.kind === 'type' && inferred.family === 'float') {
			initBuf.push(OP_F64_CONST);
			f64le(0, initBuf);
			return { initBuf, wasmType: F64, valueType: inferred };
		}
		initBuf.push(OP_I32_CONST);
		sleb128(0, initBuf);
		return { initBuf, wasmType: I32, valueType: inferred };
	}

	function compileTopLevelDef(node: NodeMap['def']) {
		const sym = node.symbol;
		const value = node.value;
		if (value.kind === 'fn') return;
		const isMut = !!(sym.flags & Flags.Variable);
		const declaredType = sym.type;
		let valueType: Type | undefined = declaredType;
		let initBuf: number[];
		let wasmType: number;
		let needsRuntimeInit = true;
		if (value.kind === 'number') {
			({ initBuf, wasmType, valueType } = initNumberGlobal(value, declaredType));
			needsRuntimeInit = false;
		} else if (value.kind === 'string') {
			const raw = text(value);
			const decoded = decodeEscapes(raw.slice(1, -1));
			const ptr = intern(decoded);
			initBuf = [OP_I32_CONST];
			sleb128(ptr, initBuf);
			wasmType = I32;
			valueType = BaseTypes.String;
			needsRuntimeInit = false;
		} else if (value.kind === 'ident') {
			const r = initIdentGlobal(value);
			initBuf = r.initBuf;
			wasmType = r.wasmType;
			if (r.valueType) valueType = r.valueType;
			needsRuntimeInit = r.needsRuntimeInit;
		} else {
			({ initBuf, wasmType, valueType } = initPlaceholderGlobal(value, valueType));
		}

		const gIdx = globals.length;
		globals.push({
			type: wasmType,
			mutable: isMut || needsRuntimeInit,
			init: initBuf,
		});
		globalIdx.set(sym, gIdx);
		globalType.set(sym, valueType ?? BaseTypes.Unknown);
		sym.type = valueType ?? sym.type;
		if (needsRuntimeInit) {
			runtimeInits.push({ sym, gIdx, value, expectedType: valueType ?? BaseTypes.Unknown });
		}
	}

	const runtimeInits: {
		sym: SymbolMap['variable'];
		gIdx: number;
		value: Node;
		expectedType: Type;
	}[] = [];

	function compileMainStatement(stmt: Node, fn: FuncBuilder) {
		if (stmt.kind === 'def') {
			compileLocalDef(stmt, fn);
			return;
		}
		if (stmt.kind === '=') {
			compileExpr(stmt, fn);
			return;
		}
		const t = compileExpr(stmt, fn);
		if (
			hasRuntimeValue(t)
		)
			fn.body.push(OP_DROP);
	}

	function dispatchArmNodes(node: Node): Node[] | undefined {
		if (node.kind !== '|') return undefined;
		const arms: Node[] = [];
		const walk = (n: Node): boolean => {
			if (n.kind === '|') return walk(n.children[0]) && walk(n.children[1]);
			if (n.kind === 'fn') {
				arms.push(n);
				return true;
			}
			if (n.kind === 'ident') {
				const s = n.symbol;
				if (
					s.kind === 'function' ||
					(s.definition?.kind === 'def' && s.definition.value.kind === 'fn')
				) {
					arms.push(n);
					return true;
				}
			}
			return false;
		};
		return walk(node) ? arms : undefined;
	}

	function declareTopLevel(): { builder: FuncBuilder; fnNode: NodeMap['fn'] }[] {
		const fnsToCompile: { builder: FuncBuilder; fnNode: NodeMap['fn'] }[] = [];
		if (root.kind !== 'root') return fnsToCompile;
		for (const child of root.children) {
			if (child.kind !== 'def') continue;
			if (child.value.kind === 'fn') {
				const declared = declareFn(child.symbol, child.value);
				if (declared) fnsToCompile.push(declared);
				continue;
			}
			const arms = dispatchArmNodes(child.value);
			if (arms)
				for (const arm of arms) {
					if (arm.kind !== 'fn') continue;
					const p0 = arm.parameters?.[0];
					if (arm.parameters?.length === 1 && p0 && !p0.type) {
						fnTemplates.set(arm.symbol, arm);
						continue;
					}
					const declared = declareFn(arm.symbol, arm);
					if (declared) fnsToCompile.push(declared);
				}
		}
		for (const child of root.children) {
			if (
				child.kind === 'def' &&
				child.value.kind !== 'fn' &&
				!dispatchArmNodes(child.value)
			)
				compileTopLevelDef(child);
		}
		return fnsToCompile;
	}

	function compileRuntimeInits(mainBuilder: FuncBuilder) {
		for (const init of runtimeInits) {
			const t = compileExpr(init.value, mainBuilder);
			if (
				isFloatType(init.expectedType) &&
				!isFloatType(t) &&
				t.kind === 'type' &&
				isIntType(t)
			)
				coerceToFloat(t, mainBuilder);
			mainBuilder.body.push(OP_GLOBAL_SET);
			uleb128(init.gIdx, mainBuilder.body);
		}
	}

	function compileTopLevelStatements(mainBuilder: FuncBuilder) {
		if (root.kind !== 'root') return;
		for (const child of root.children) {
			if (child.kind === '=' || child.kind === '>>') {
				compileExpr(child, mainBuilder);
				continue;
			}
			if (child.kind === 'main') {
				for (const stmt of child.statements)
					compileMainStatement(stmt, mainBuilder);
			}
		}
	}

	function resolveCallFixups(baseFuncIdx: number) {
		for (const b of funcBuilders) {
			for (const fix of b.callFixups) {
				const funcIdx = baseFuncIdx + fix.builderIdx;
				const enc: number[] = [];
				uleb128(funcIdx, enc);
				while (enc.length < fix.size) {
					const last = enc[enc.length - 1] ?? 0;
					enc[enc.length - 1] = (last | 0x80) & 0xff;
					enc.push(0x00);
				}
				for (let i = 0; i < fix.size; i++) {
					const e = enc[i];
					if (e !== undefined) b.body[fix.offset + i] = e;
				}
			}
		}
	}

	const fnsToCompile = declareTopLevel();

	// Phase 3: compile each fn body
	for (const { builder, fnNode } of fnsToCompile) {
		compileFnBody(builder, fnNode);
	}

	// Phase 4: compile main
	const mainBuilder: FuncBuilder = {
		typeIdx: typeIdx([], []),
		body: [],
		locals: [],
		paramCount: 0,
		paramMap: new Map(),
		returnType: BaseTypes.Void,
		callFixups: [],
		blockDepth: 0,
	};
	const mainBuilderIdx = funcBuilders.length;
	funcBuilders.push(mainBuilder);

	compileRuntimeInits(mainBuilder);
	compileTopLevelStatements(mainBuilder);

	// Phase 5: resolve funcidx fixups
	const baseFuncIdx = imports.length;
	resolveCallFixups(baseFuncIdx);
	const mainFuncIdx = baseFuncIdx + mainBuilderIdx;

	const m: Module = {
		types,
		imports,
		functions: funcBuilders.map(b => ({
			typeIdx: b.typeIdx,
			body: b.body,
			locals: b.locals,
		})),
		globals,
		memoryPages: 1,
		exports: [
			{ name: 'main', kind: EXTERNAL_FUNC, idx: mainFuncIdx },
			{ name: 'memory', kind: EXTERNAL_MEMORY, idx: 0 },
		],
		datas,
	};

	return emitModule(m);
}

function decodeEscapes(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '\\' && i + 1 < s.length) {
			const next = s[i + 1];
			i++;
			if (next === 'n') out += '\n';
			else if (next === 'r') out += '\r';
			else if (next === 't') out += '\t';
			else if (next === '0') out += '\0';
			else if (next === "'") out += "'";
			else if (next === '\\') out += '\\';
			else if (next === 'u' && s[i + 1] === '{') {
				const end = s.indexOf('}', i + 2);
				if (end < 0) throw new Error('Invalid unicode escape');
				const code = parseInt(s.slice(i + 2, end), 16);
				out += String.fromCodePoint(code);
				i = end;
			} else out += next;
		} else {
			out += ch;
		}
	}
	return out;
}
