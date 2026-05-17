import { sleb128, text, uleb128 } from '../sdk/index.js';

import { BaseTypes, Flags } from './symbol-table.js';

import type { Node, NodeMap } from './node.js';
import type {
	Symbol as GbcSymbol,
	SymbolMap,
	Type,
} from './symbol-table.js';

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
	for (let i = 0; i < 8; i++) out.push(bytes[i]!);
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

function emitModule(m: Module): Uint8Array {
	const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

	if (m.types.length) {
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

	if (m.imports.length) {
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

	if (m.globals.length) {
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

	if (m.exports.length) {
		const payload: number[] = [];
		uleb128(m.exports.length, payload);
		for (const e of m.exports) {
			name(e.name, payload);
			payload.push(e.kind);
			uleb128(e.idx, payload);
		}
		section(SEC_EXPORT, payload, out);
	}

	if (m.functions.length) {
		const payload: number[] = [];
		uleb128(m.functions.length, payload);
		for (const f of m.functions) {
			const body: number[] = [];
			const groups: { count: number; type: number }[] = [];
			for (const t of f.locals) {
				const last = groups[groups.length - 1];
				if (last && last.type === t) last.count++;
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

	if (m.datas.length) {
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
			return I32;
		case 'void':
			throw new Error('Void has no WASM value type');
		case 'unknown':
			throw new Error('Cannot lower unknown type');
		default:
			throw new Error(`Unsupported type family: ${type.family}`);
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

function findOutExternal(
	t: Type,
	externals: Map<string, SymbolMap['function']>,
): string | undefined {
	if (t.kind !== 'type')
		throw new Error(`Cannot @.out value of kind ${t.kind}`);
	// data dispatches by family — the payload is an i32 pointer.
	if (t.family === 'data' && externals.has('out_data')) return 'out_data';
	// Functions have no out_ equivalent — they pass through @.out as a no-op.
	if (t.family === 'fn') return undefined;
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
	throw new Error(`No host external accepts type ${t.name}`);
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
	fusion?: {
		emit: (valueType: Type) => void;
		targetDepth: number;
	};
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

	function intern(s: string): number {
		const utf8 = enc.encode(s);
		const buf: number[] = [];
		u32le(utf8.length, buf);
		for (const b of utf8) buf.push(b);
		const offset = heap;
		datas.push({ offset, bytes: buf });
		heap += buf.length;
		// 4-byte align
		heap = (heap + 3) & ~3;
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
			const t = types[i]!;
			if (
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

	/**
	 * Resolve a type identifier from a `typeident` node or a defined symbol's
	 * declared type. Falls back to Unknown.
	 */
	function resolveTypeFromNode(node: Node | undefined): Type {
		if (!node) return BaseTypes.Unknown;
		if (node.kind === 'typeident') return node.symbol;
		return BaseTypes.Unknown;
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
			case 'ident': {
				const sym = node.symbol;
				if (sym.kind === 'literal') {
					return sym.type ?? BaseTypes.Unknown;
				}
				if (sym.kind === 'variable' || sym.kind === 'function') {
					return sym.type ?? globalType.get(sym) ?? BaseTypes.Unknown;
				}
				return BaseTypes.Unknown;
			}
			case '+':
			case '-':
			case '*':
			case '/': {
				const lt = inferType(node.children[0], fn);
				const rt = inferType(node.children[1], fn);
				if (isFloatType(lt) || isFloatType(rt)) return BaseTypes.Float64;
				if (isIntType(lt) && isIntType(rt)) return BaseTypes.Int32;
				return BaseTypes.Unknown;
			}
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>':
				return BaseTypes.Int32;
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
			case '?': {
				const t = node.children[1];
				return t ? inferType(t, fn) : BaseTypes.Unknown;
			}
			case 'call': {
				const callee = node.children[0];
				if (callee.kind === 'ident') {
					const sym = callee.symbol;
					const fnSym =
						sym.kind === 'function'
							? sym
							: sym.type?.kind === 'function'
								? sym.type
								: undefined;
					if (fnSym) return fnSym.returnType ?? BaseTypes.Void;
				}
				return BaseTypes.Unknown;
			}
			case '.': {
				const recv = node.children[0];
				const field = node.children[1];
				const recvType = inferType(recv, fn);
				if (recvType.kind === 'type' && recvType.family === 'data') {
					if (field.kind === 'number') {
						const items = dataItems(recv);
						const item = items[field.value];
						if (item) return inferType(itemValue(item), fn);
					}
					if (field.kind === 'ident') {
						const items = dataItems(recv);
						for (const item of items) {
							if (
								item?.kind === 'propdef' &&
								item.label?.symbol.name === field.symbol.name
							) {
								return inferType(itemValue(item), fn);
							}
						}
					}
				}
				// Non-data receiver: codegen treats `recv.field` as a 4-byte
				// load / placeholder — type result is Int32.
				return BaseTypes.Int32;
			}
			case 'data': {
				const items = dataItems(node);
				if (items.length === 1) return inferType(itemValue(items[0]!), fn);
				return BaseTypes.Unknown;
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

	function compileExpr(node: Node, fn: FuncBuilder): Type {
		switch (node.kind) {
			case 'string': {
				const raw = text(node);
				const decoded = decodeEscapes(raw.slice(1, -1));
				const ptr = intern(decoded);
				fn.body.push(OP_I32_CONST);
				sleb128(ptr, fn.body);
				return BaseTypes.String;
			}
			case 'number': {
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
			case 'ident': {
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
				throw new Error(
					`Unsupported ident reference: "${sym.name ?? '?'}"`,
				);
			}
			case '@': {
				throw new Error('Bare @ cannot be lowered to a value');
			}
			case '$': {
				if (fn.dollarLocal !== undefined) {
					fn.body.push(OP_LOCAL_GET);
					uleb128(fn.dollarLocal, fn.body);
					return fn.dollarType ?? BaseTypes.Int32;
				}
				fn.body.push(OP_I32_CONST);
				sleb128(0, fn.body);
				return BaseTypes.Int32;
			}
			case 'call': {
				return compileCall(node, fn);
			}
			case 'next': {
				const val = node.children?.[0];
				if (fn.fusion) {
					if (!val) return BaseTypes.Void;
					const t = compileExpr(val, fn);
					if (
						t.kind === 'type' &&
						t.family !== 'void' &&
						t.family !== 'unknown'
					)
						fn.fusion.emit(t);
					return BaseTypes.Void;
				}
				if (val) return compileExpr(val, fn);
				return BaseTypes.Void;
			}
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
			case '/': {
				return compileArith(node, fn);
			}
			case 'negate': {
				const child = node.children[0];
				const t = compileExpr(child, fn);
				if (isFloatType(t)) {
					fn.body.push(OP_F64_NEG);
					return t;
				}
				// integer negation: 0 - x
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
			case '!': {
				const child = node.children[0];
				compileExpr(child, fn);
				fn.body.push(OP_I32_EQZ);
				return BaseTypes.Bool;
			}
			case '~': {
				const child = node.children[0];
				compileExpr(child, fn);
				fn.body.push(OP_I32_CONST);
				sleb128(-1, fn.body);
				fn.body.push(OP_I32_XOR);
				return BaseTypes.Int32;
			}
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>': {
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
			case '||':
			case '&&': {
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
			case '==':
			case '!=':
			case '<':
			case '>':
			case '<=':
			case '>=': {
				return compileCompare(
					node.kind,
					node.children[0],
					node.children[1],
					fn,
				);
			}
			case 'is': {
				const lhs = node.children[0];
				const rhs = node.children[1];
				const valueType = inferType(lhs, fn);
				const testType =
					rhs.kind === 'typeident' ? rhs.symbol : BaseTypes.Unknown;
				const lhsType = compileExpr(lhs, fn);
				if (
					lhsType.kind === 'type' &&
					lhsType.family !== 'void' &&
					lhsType.family !== 'unknown'
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
			case '?': {
				const cond = node.children[0];
				const thenBranch = node.children[1];
				const elseBranch = node.children[2];
				compileExpr(cond, fn);
				fn.body.push(OP_IF);
				if (!elseBranch) {
					// Optional-else: emit only when truthy. In scalar
					// context, both branches contribute void.
					fn.body.push(0x40);
					fn.blockDepth++;
					const t = compileExpr(thenBranch, fn);
					if (
						t.kind === 'type' &&
						t.family !== 'void' &&
						t.family !== 'unknown'
					)
						fn.body.push(OP_DROP);
					fn.body.push(OP_END);
					fn.blockDepth--;
					return BaseTypes.Void;
				}
				const thenType = inferType(thenBranch, fn);
				const blockType =
					thenType.kind === 'type' &&
					thenType.family !== 'void' &&
					thenType.family !== 'unknown'
						? gbcToWasm(thenType)
						: 0x40;
				fn.body.push(blockType);
				fn.blockDepth++;
				compileExpr(thenBranch, fn);
				fn.body.push(OP_ELSE);
				compileExpr(elseBranch, fn);
				fn.body.push(OP_END);
				fn.blockDepth--;
				return thenType;
			}
			case '>>':
				return compilePipe(node.children, fn);
			case 'data':
				return compileData(node, fn);
			case '.':
				return compileMember(node, fn);
			case 'fn':
				return compileInlineFn(node, fn);
			case ',': {
				// In a fusion (pipe stage body) context, each child emits a
				// value through downstream stages — like JS yield. Otherwise,
				// comma evaluates each left-to-right and discards all but the
				// last (matches JS comma operator).
				if (fn.fusion) {
					for (const c of node.children) {
						if (!c) continue;
						const t = compileExpr(c, fn);
						// next(c) within fusion already emits; raw exprs do not.
						// Treat bare expressions as `next` would.
						if (
							c.kind !== 'next' &&
							c.kind !== 'break' &&
							c.kind !== 'done' &&
							t.kind === 'type' &&
							t.family !== 'void' &&
							t.family !== 'unknown'
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
						t.kind === 'type' &&
						t.family !== 'void' &&
						t.family !== 'unknown'
					)
						fn.body.push(OP_DROP);
				}
				return last;
			}
			case 'propdef': {
				const v = node.value;
				if (v) return compileExpr(v, fn);
				return BaseTypes.Void;
			}
			case '=': {
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
				throw new Error(
					`Cannot assign to "${sym.name ?? '?'}" (not bound)`,
				);
			}
			case 'def': {
				return compileLocalDef(node, fn);
			}
			case 'loop': {
				throw new Error('`loop` outside pipe source not supported');
			}
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

	function compileCall(node: NodeMap['call'], fn: FuncBuilder): Type {
		const callee = node.children[0];
		const args = node.children[1];
		if (callee.kind !== 'ident')
			throw new Error('Indirect call not yet supported');
		const calleeSym = callee.symbol;
		// Template path: callee is a union-param fn. Resolve (or compile)
		// the per-signature specialization and dispatch to its funcidx.
		const templateNode = fnTemplates.get(calleeSym);
		if (templateNode) {
			const fnSym = templateNode.symbol;
			const argTypes = collectArgTypes(args, fn);
			const builderIdx = getOrCreateSpec(templateNode, argTypes);
			compileCallArgs(args, fnSym, fn);
			fn.body.push(OP_CALL);
			const fixupOffset = fn.body.length;
			for (let i = 0; i < 5; i++) fn.body.push(0);
			fn.callFixups.push({
				offset: fixupOffset,
				builderIdx,
				size: 5,
			});
			return fnSym.returnType ?? BaseTypes.Void;
		}
		const builderIdx = fnDefBuilderIdx.get(calleeSym);
		if (builderIdx === undefined)
			throw new Error(
				`Unknown function: "${calleeSym.name ?? '?'}"`,
			);
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
		fn.body.push(OP_CALL);
		// Reserve 5-byte placeholder for funcidx (max uleb128 for i32).
		const fixupOffset = fn.body.length;
		for (let i = 0; i < 5; i++) fn.body.push(0);
		fn.callFixups.push({
			offset: fixupOffset,
			builderIdx,
			size: 5,
		});
		return fnSym.returnType ?? BaseTypes.Void;
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
		if (items.length === 1 && !hasLabels) {
			return compileExpr(itemValue(items[0]!), fn);
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
			const itemNode = itemValue(items[i]!);
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
		for (let i = 0; i < items.length; i++) {
			const item = items[i]!;
			if (item.kind === 'propdef' && item.label) {
				const sym = item.label.symbol;
				if (sym.name) members[sym.name] = sym;
			}
		}
		return {
			kind: 'type',
			flags: 0,
			name: '__data',
			family: 'data',
			size: slotSize,
			members,
		};
	}

	function compileMember(node: NodeMap['.'], fn: FuncBuilder): Type {
		const recv = node.children[0];
		const field = node.children[1];
		// Compile-time index/label access on a literal data block.
		if (recv.kind === 'data') {
			const items = dataItems(recv).flatMap(flattenDataItem);
			let idx: number | undefined;
			let resultType: Type = BaseTypes.Unknown;
			if (field.kind === 'number') idx = field.value;
			else if (field.kind === 'ident') {
				for (let i = 0; i < items.length; i++) {
					const item = items[i]!;
					if (
						item.kind === 'propdef' &&
						item.label?.symbol.name === field.symbol.name
					) {
						idx = i;
						break;
					}
				}
			}
			if (idx === undefined || idx >= items.length)
				throw new Error('Member access target not found');
			const target = itemValue(items[idx]!);
			resultType = compileExpr(target, fn);
			return resultType;
		}
		// Variable reference holding a data block pointer: runtime load.
		if (recv.kind === 'ident') {
			const recvType = inferType(recv, fn);
			if (recvType.kind === 'type' && recvType.family === 'data') {
				const recvSym = recv.symbol;
				if (recvSym.kind === 'variable') {
					return compileMemberLoad(recv, recvType, field, fn);
				}
			}
			// Member access on a non-data ident — push 0 placeholder.
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Int32;
		}
		if (recv.kind === '$') {
			if (
				fn.dollarLocal !== undefined &&
				fn.dollarType?.kind === 'type' &&
				fn.dollarType.family === 'data'
			) {
				const slotSize = fn.dollarType.size || 4;
				let idx = 0;
				if (field.kind === 'number') idx = field.value;
				else if (field.kind === 'ident') {
					const keys = Object.keys(fn.dollarType.members ?? {});
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
		throw new Error(`Unsupported member access target: ${recv.kind}`);
	}

	function compileMemberLoad(
		recv: NodeMap['ident'],
		recvType: Type,
		field: Node,
		fn: FuncBuilder,
	): Type {
		if (recvType.kind !== 'type' || recvType.family !== 'data')
			throw new Error('compileMemberLoad: not a data type');
		const slotSize = recvType.size || 4;
		const members = recvType.members ?? {};
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
		const sym = node.label.symbol;
		if (sym.kind !== 'variable')
			throw new Error('Local def label must be a variable');
		const rt = compileExpr(node.value, fn);
		const wasmType = rt.kind === 'type' && rt.family !== 'void' && rt.family !== 'unknown'
			? gbcToWasm(rt)
			: I32;
		const localIdx = allocLocal(fn, wasmType);
		fn.body.push(OP_LOCAL_SET);
		uleb128(localIdx, fn.body);
		fn.paramMap.set(sym, localIdx);
		sym.type = rt;
		return BaseTypes.Void;
	}

	function compilePipe(children: Node[], fn: FuncBuilder): Type {
		const flat = flattenPipe(children);
		let source = flat[0];
		let stages = flat.slice(1);
		if (!source) throw new Error('Invalid pipe');

		while (source.kind === 'call') {
			const sequenceInlined = tryInlineSequenceCall(source, stages, fn);
			if (sequenceInlined) return BaseTypes.Void;
			const emittingInlined = tryInlineEmittingCall(source, stages, fn);
			if (emittingInlined) return BaseTypes.Void;
			const inlined = tryInlineStreamCall(source, fn);
			if (!inlined) break;
			const reflat = flattenPipe([inlined, ...stages]);
			source = reflat[0]!;
			stages = reflat.slice(1);
		}

		if (source.kind === 'loop') {
			compileLoopSource(stages, fn);
			return BaseTypes.Void;
		}

		// Anonymous sequence fn as source — inline body in fusion. Each
		// top-level expression in the body auto-emits through the stages.
		if (source.kind === 'fn' && source.symbol.flags & Flags.Sequence) {
			compileFnSource(source, stages, fn);
			return BaseTypes.Void;
		}

		// Data block source with @.each — emit each item separately.
		if (source.kind === 'data' && stages[0] && isEachStage(stages[0])) {
			const items = dataItems(source).flatMap(flattenDataItem);
			const rest = stages.slice(1);
			for (const item of items) {
				const v = itemValue(item);
				const t = compileExpr(v, fn);
				driveStages(rest, t, fn);
			}
			return BaseTypes.Void;
		}

		// Optional-else ternary as pipe source: emit only when truthy.
		if (
			source.kind === '?' &&
			source.children.length >= 2 &&
			source.children[2] === undefined
		) {
			compileExpr(source.children[0]!, fn);
			fn.body.push(OP_IF);
			fn.body.push(0x40);
			fn.blockDepth++;
			const inner = source.children[1]!;
			if (inner.kind === 'fn') {
				compileFnSource(inner, stages, fn);
			} else {
				const t = compileExpr(inner, fn);
				driveStages(stages, t, fn);
			}
			fn.body.push(OP_END);
			fn.blockDepth--;
			return BaseTypes.Void;
		}

		const sourceType = compileExpr(source, fn);
		return driveStages(stages, sourceType, fn);
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
			const pSym = p.label.symbol;
			if (pSym.kind !== 'variable')
				throw new Error(
					`Stage parameter "${pSym.name ?? '?'}" is not a variable`,
				);
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
		fn.fusion = {
			emit: (t: Type) => {
				if (stages.length === 0) {
					if (savedFusion) savedFusion.emit(t);
					else if (
						t.kind === 'type' &&
						t.family !== 'void' &&
						t.family !== 'unknown'
					)
						fn.body.push(OP_DROP);
					return;
				}
				driveStages(stages, t, fn);
			},
			targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
		};
		for (const stmt of stmts) {
			if (!stmt) continue;
			if (stmt.kind === ',') {
				for (const c of stmt.children) {
					if (!c) continue;
					emitOne(c, fn);
				}
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
		const t = compileExpr(expr, fn);
		if (
			fn.fusion &&
			t.kind === 'type' &&
			t.family !== 'void' &&
			t.family !== 'unknown'
		) {
			fn.fusion.emit(t);
		} else if (
			t.kind === 'type' &&
			t.family !== 'void' &&
			t.family !== 'unknown'
		) {
			fn.body.push(OP_DROP);
		}
	}

	function isEachStage(stage: Node): boolean {
		return (
			stage.kind === '.' &&
			stage.children[0].kind === '@' &&
			stage.children[1].kind === 'ident' &&
			stage.children[1].symbol.name === 'each'
		);
	}

	function flattenPipe(children: Node[]): Node[] {
		const out: Node[] = [];
		for (const c of children) {
			if (c && c.kind === '>>') out.push(...flattenPipe(c.children));
			else if (c) out.push(c);
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
		// Union-param fns are monomorphized per call site via compileCall →
		// getOrCreateSpec, not inlined. Inlining here would compile the body
		// once with the declared union type, defeating narrowing.
		if (fnTemplates.has(sym)) return false;
		const fnDef = sym.definition;
		if (!fnDef || fnDef.kind !== 'def') return false;
		const fnNode = fnDef.value;
		if (fnNode.kind !== 'fn') return false;
		if (!(fnNode.symbol.flags & Flags.Sequence)) return false;

		const args = callNode.children[1];
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
		const items = argList.filter((a): a is Node => !!a);
		const itemNodes: Node[] = items;
		const dataNode: NodeMap['data'] = {
			...items[0]!,
			kind: 'data',
			children: [args],
		};
		void itemNodes;
		return compileData(dataNode, fn);
	}

	/**
	 * Inline a multi-emit fn body at a pipe-source call site. Wraps the
	 * inlined body in a WASM block so `done` can branch to its end without
	 * returning from the enclosing function.
	 */
	function tryInlineEmittingCall(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return false;
		const sym = callee.symbol;
		const fnDef = sym.definition;
		if (!fnDef || fnDef.kind !== 'def') return false;
		const fnNode = fnDef.value;
		if (fnNode.kind !== 'fn') return false;
		if (fnNode.symbol.flags & Flags.Sequence) return false;
		const stmts = fnNode.statements ?? [];
		// Direct-tier carve-out: single `next val` body. `next(a, b, ...)`
		// (val is a comma) is multi-emit and belongs in this emitting-tier
		// inlining path so each comma child emits through fusion.
		const onlyStmt = stmts.length === 1 ? stmts[0] : undefined;
		const isDirectTier =
			onlyStmt?.kind === 'next' &&
			onlyStmt.children?.[0]?.kind !== ',';
		if (isDirectTier) return false;
		const hasEmitting = stmts.some(
			s => s?.kind === 'next' || s?.kind === 'done',
		);
		if (!hasEmitting) return false;

		const params = fnNode.parameters ?? [];
		const args = callNode.children[1];
		const argList = args
			? args.kind === ','
				? args.children
				: [args]
			: [];
		// Per-call narrowing of union params: while the body compiles
		// inline for this call site, the param symbol's type is the
		// concrete arm derived from the arg. Restored before return so
		// other call sites see the declared union again.
		const savedParamTypes: (Type | undefined)[] = params.map(
			p => p.label.symbol.type,
		);
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (!p) return false;
			const pSym = p.label.symbol;
			const argNode = argList[i];
			if (!argNode || pSym.kind !== 'variable') return false;
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

		fn.body.push(OP_BLOCK);
		fn.body.push(0x40);
		fn.blockDepth++;
		const doneDepth = fn.blockDepth;
		const savedFusion = fn.fusion;
		const savedDoneDepth = fn.doneDepth;
		fn.doneDepth = doneDepth;
		fn.fusion = {
			emit: (t: Type) => {
				if (stages.length === 0) {
					if (savedFusion) savedFusion.emit(t);
					else if (
						t.kind === 'type' &&
						t.family !== 'void' &&
						t.family !== 'unknown'
					)
						fn.body.push(OP_DROP);
					return;
				}
				driveStages(stages, t, fn);
			},
			targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
		};
		for (const stmt of stmts) if (stmt) compileExpr(stmt, fn);
		fn.fusion = savedFusion;
		fn.doneDepth = savedDoneDepth;
		fn.body.push(OP_END);
		fn.blockDepth--;
		// Restore param symbol types so siblings/recursive call sites see
		// the declared union, not this call's narrowed arm.
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			const saved = savedParamTypes[i];
			if (p && saved) p.label.symbol.type = saved;
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
		const fnDef = sym.definition;
		if (!fnDef || fnDef.kind !== 'def') return;
		const fnNode = fnDef.value;
		if (fnNode.kind !== 'fn') return;
		const stmts = fnNode.statements ?? [];
		const tail = stmts[stmts.length - 1];
		if (tail?.kind !== 'next') return;
		const body = tail.children?.[0];
		if (!body) return;
		// Only inline when non-tail statements are pure local defs/
		// reassignments. Multi-emit/done patterns need emit-callback tier.
		for (let i = 0; i < stmts.length - 1; i++) {
			const s = stmts[i];
			if (!s || (s.kind !== 'def' && s.kind !== '=')) return;
		}

		const params = fnNode.parameters ?? [];
		const args = callNode.children[1];
		const argList = args
			? args.kind === ','
				? args.children
				: [args]
			: [];
		for (let i = 0; i < params.length; i++) {
			const p = params[i]!;
			const pSym = p.label.symbol;
			const argNode = argList[i];
			if (!argNode || pSym.kind !== 'variable') return;
			const argType = compileExpr(argNode, fn);
			if (!pSym.type) pSym.type = argType;
			const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(pSym, localIdx);
		}
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
				if (
					t.kind === 'type' &&
					t.family !== 'void' &&
					t.family !== 'unknown'
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

	function driveStages(
		stages: Node[],
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		if (stages.length === 0) {
			const hasValue =
				inputType.kind === 'type' &&
				inputType.family !== 'void' &&
				inputType.family !== 'unknown';
			if (hasValue && fn.fusion) {
				fn.fusion.emit(inputType);
				return BaseTypes.Void;
			}
			if (hasValue) fn.body.push(OP_DROP);
			return BaseTypes.Void;
		}
		const [stage, ...rest] = stages;
		if (!stage) return BaseTypes.Void;

		if (stage.kind === '.') {
			if (isEachStage(stage)) {
				// @.each receives a single value here; just pass through.
				return driveStages(rest, inputType, fn);
			}
			const outType = emitHostStage(stage, inputType, fn);
			return driveStages(rest, outType, fn);
		}

		if (stage.kind === 'fn') {
			const params = stage.parameters ?? [];
			const p = params[0];
			const savedDollarLocal = fn.dollarLocal;
			const savedDollarType = fn.dollarType;
			if (p) {
				const pSym = p.label.symbol;
				if (pSym.kind !== 'variable')
					throw new Error(
						`Stage parameter "${pSym.name ?? '?'}" symbol is not a variable`,
					);
				if (!pSym.type) pSym.type = inputType;
				const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.paramMap.set(pSym, localIdx);
			} else {
				const localIdx = allocLocal(fn, I32);
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.dollarLocal = localIdx;
				fn.dollarType = inputType;
			}

			const savedFusion = fn.fusion;
			fn.fusion = {
				emit: (t: Type) => {
					if (rest.length === 0) {
						if (savedFusion) savedFusion.emit(t);
						else if (
							t.kind === 'type' &&
							t.family !== 'void' &&
							t.family !== 'unknown'
						)
							fn.body.push(OP_DROP);
						return;
					}
					driveStages(rest, t, fn);
				},
				targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
			};
			const isSequence = !!(stage.symbol.flags & Flags.Sequence);
			for (const stmt of stage.statements ?? []) {
				if (isSequence) emitOne(stmt, fn);
				else compileExpr(stmt, fn);
			}
			fn.fusion = savedFusion;
			fn.dollarLocal = savedDollarLocal;
			fn.dollarType = savedDollarType;
			return BaseTypes.Void;
		}

		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			const builderIdx = fnDefBuilderIdx.get(sym);
			if (builderIdx !== undefined) {
				fn.body.push(OP_CALL);
				const fixupOffset = fn.body.length;
				for (let i = 0; i < 5; i++) fn.body.push(0);
				fn.callFixups.push({
					offset: fixupOffset,
					builderIdx,
					size: 5,
				});
				const fnSym =
					sym.kind === 'function'
						? sym
						: sym.type?.kind === 'function'
							? sym.type
							: undefined;
				const retType = fnSym?.returnType ?? BaseTypes.Unknown;
				return driveStages(rest, retType, fn);
			}
			const def = sym.definition;
			if (def?.kind === 'def') {
				const fnValue = def.value;
				if (fnValue.kind === 'fn') {
					if (fnValue.symbol.flags & Flags.Sequence) {
						const dollarLocal = allocLocal(
							fn,
							gbcToWasm(inputType),
						);
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
					return inlineDirectFnStage(fnValue, inputType, rest, fn);
				}
			}
			throw new Error(
				`Unknown pipe-stage ident: "${sym.name ?? '?'}"`,
			);
		}

		throw new Error(`Unsupported pipe stage: ${stage.kind}`);
	}

	function emitHostStage(
		stage: Node,
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		if (stage.kind !== '.')
			throw new Error(`Unsupported pipe stage: ${stage.kind}`);
		const recv = stage.children[0];
		const field = stage.children[1];
		if (recv.kind !== '@')
			throw new Error('Pipe stage must be a stdlib access (@.X)');
		if (field.kind !== 'ident')
			throw new Error('Pipe stage must name a member');
		const fname = field.symbol.name;
		if (!fname) throw new Error('Stage member is unnamed');

		if (fname === 'out') {
			let inT = inputType;
			if (inT.kind !== 'type' || inT.family === 'unknown') {
				// Default to Int32 when type is unknown (e.g. ident with no inference).
				inT = BaseTypes.Int32;
			}
			const hostField = findOutExternal(inT, externals);
			if (!hostField) {
				// No host external for this type (e.g. fn). Drop the value.
				fn.body.push(OP_DROP);
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

		if (field.symbol.kind !== 'function')
			throw new Error(
				`Pipe stage "@.${fname}" is not a function`,
			);
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
	) {
		const argList = args
			? args.kind === ','
				? args.children
				: [args]
			: [];
		const params = calleeSym.parameters ?? [];
		const anyNamed = argList.some(a => a?.kind === 'propdef');
		const paramDefault = (sym: GbcSymbol | undefined): Node | undefined => {
			const def = sym?.definition;
			return def?.kind === 'parameter' ? def.value : undefined;
		};
		if (anyNamed) {
			const byName = new Map<string, Node>();
			for (const a of argList) {
				if (a?.kind === 'propdef' && a.label && a.value) {
					const n = a.label.symbol.name;
					if (n) byName.set(n, a.value);
				}
			}
			for (const p of params) {
				const n = p.name;
				if (!n) throw new Error('Parameter without a name');
				const v = byName.get(n) ?? paramDefault(p);
				if (!v)
					throw new Error(
						`Missing argument for parameter "${n}"`,
					);
				compileExpr(v, fn);
			}
		} else {
			for (let i = 0; i < params.length; i++) {
				const p = params[i];
				const a = argList[i] ?? paramDefault(p);
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
	function allocFuncBuilder(fnNode: NodeMap['fn']): {
		builder: FuncBuilder;
		builderIdx: number;
		returnType: Type;
	} {
		const paramSyms = fnNode.parameters ?? [];
		const paramTypes: number[] = [];
		const paramMap = new Map<GbcSymbol, number>();
		for (let i = 0; i < paramSyms.length; i++) {
			const p = paramSyms[i]!;
			const sym = p.label.symbol;
			if (sym.kind !== 'variable')
				throw new Error(
					`Parameter "${sym.name ?? '?'}" symbol is not a variable`,
				);
			// Untyped params default to Int32 (i32).
			if (!sym.type) sym.type = BaseTypes.Int32;
			paramTypes.push(gbcToWasm(sym.type));
			paramMap.set(sym, i);
		}
		// Return type. Declared annotation wins. For direct-tier fns (single
		// `next val` body) prefer the checker-resolved type; fall back to a
		// local `inferType` walk for cases the checker leaves Unknown
		// (e.g. untyped params don't get their default until below).
		// Emitting-tier fns have no WASM return value.
		let returnType: Type = fnNode.returnType
			? resolveTypeFromNode(fnNode.returnType)
			: BaseTypes.Unknown;
		const stmts = fnNode.statements ?? [];
		const tail = stmts[0];
		const isDirectTier = stmts.length === 1 && tail?.kind === 'next';
		if (
			isDirectTier &&
			tail?.kind === 'next' &&
			returnType.kind === 'type' &&
			returnType.family === 'unknown'
		) {
			const fromChecker = fnNode.symbol.returnType;
			if (
				fromChecker?.kind === 'type' &&
				fromChecker.family !== 'unknown' &&
				fromChecker.family !== 'void'
			) {
				returnType = fromChecker;
			} else {
				const val = tail.children?.[0];
				if (val) {
					const inferred = inferType(val);
					if (
						inferred.kind === 'type' &&
						inferred.family !== 'unknown' &&
						inferred.family !== 'void'
					)
						returnType = inferred;
				}
			}
		}
		const resultTypes: number[] = [];
		if (
			returnType.kind === 'type' &&
			returnType.family !== 'void' &&
			returnType.family !== 'unknown'
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

	function declareFn(label: NodeMap['ident'], fnNode: NodeMap['fn']) {
		const paramSyms = fnNode.parameters ?? [];
		const fnSym = fnNode.symbol;
		fnSym.parameters = paramSyms.map(p => p.label.symbol);
		// Fns with any union-typed parameter are monomorphized per call site.
		// Skip the eager builder/funcidx allocation; record as a template.
		const hasUnionParam = paramSyms.some(p => {
			const t = p.label.symbol.type;
			return t?.kind === 'type' && t.family === 'union';
		});
		if (hasUnionParam) {
			fnTemplates.set(label.symbol, fnNode);
			fnTemplates.set(fnSym, fnNode);
			return null;
		}
		const { builder, builderIdx, returnType } = allocFuncBuilder(fnNode);
		fnSym.returnType = returnType;
		fnDefBuilderIdx.set(label.symbol, builderIdx);
		// Also register the fn's own symbol so direct calls to it (without
		// going via the def-label) resolve.
		fnDefBuilderIdx.set(fnSym, builderIdx);
		return { builder, fnNode };
	}

	/**
	 * Compose a deterministic cache key for the (template, argTypes) pair.
	 * Uses the fn symbol's identity (via a side-table id) and the names of
	 * the concrete argument types.
	 */
	function specKey(template: NodeMap['fn'], argTypes: Type[]): string {
		let id = specTemplateIds.get(template.symbol);
		if (id === undefined) {
			id = specTemplateIds.size;
			specTemplateIds.set(template.symbol, id);
		}
		return `${id}|${argTypes.map(t => t.name).join(',')}`;
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
	function getOrCreateSpec(
		template: NodeMap['fn'],
		argTypes: Type[],
	): number {
		const key = specKey(template, argTypes);
		const cached = specCache.get(key);
		if (cached !== undefined) return cached;
		const params = template.parameters ?? [];
		const saved = params.map(p => p.label.symbol.type);
		params.forEach((p, i) => {
			const sym = p.label.symbol;
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
		const { builder, builderIdx } = allocFuncBuilder(template);
		// Register BEFORE compiling the body so recursive calls inside the
		// body resolve to this in-progress spec via the cache.
		specCache.set(key, builderIdx);
		compileFnBody(builder, template);
		params.forEach((p, i) => {
			p.label.symbol.type = saved[i]!;
		});
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
			return args.children.map(c => (c ? inferType(c, fn) : BaseTypes.Unknown));
		return [inferType(args, fn)];
	}

	function compileFnBody(builder: FuncBuilder, fnNode: NodeMap['fn']) {
		const stmts = fnNode.statements ?? [];
		// Direct tier: single `next val` at tail. Body compiles to "push val".
		if (
			stmts.length === 1 &&
			stmts[0] !== undefined &&
			stmts[0].kind === 'next'
		) {
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
					t.kind === 'type' &&
					t.family !== 'void' &&
					t.family !== 'unknown'
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
			rt.kind === 'type' &&
			rt.family !== 'void' &&
			rt.family !== 'unknown';
		for (let i = 0; i < stmts.length; i++) {
			const stmt = stmts[i];
			if (!stmt) continue;
			const isTail = i === stmts.length - 1;
			const t = compileExpr(stmt, builder);
			const valueOnStack =
				t.kind === 'type' &&
				t.family !== 'void' &&
				t.family !== 'unknown';
			if (!valueOnStack) continue;
			if (isTail && hasReturn) continue;
			builder.body.push(OP_DROP);
		}
	}

	function compileTopLevelDef(node: NodeMap['def']) {
		const sym = node.label.symbol;
		if (sym.kind !== 'variable') return;
		const value = node.value;
		// Top-level fn defs are handled separately via declareFn.
		if (value.kind === 'fn') return;
		const isMut = !!(sym.flags & Flags.Variable);
		// Try to infer the type
		const declaredType = sym.type;
		let valueType: Type | undefined = declaredType;
		// Evaluate in init expression context (must be const at module load).
		// We support only const-initializable globals here; for non-const init,
		// store as zero and assign at main start.
		const initBuf: number[] = [];
		let wasmType: number;
		let needsRuntimeInit = true;
		if (value.kind === 'number') {
			valueType = Number.isInteger(value.value)
				? BaseTypes.Int32
				: BaseTypes.Float64;
			if (declaredType && isFloatType(declaredType)) {
				valueType = declaredType;
				initBuf.push(OP_F64_CONST);
				f64le(value.value, initBuf);
				wasmType = F64;
			} else if (isFloatType(valueType)) {
				initBuf.push(OP_F64_CONST);
				f64le(value.value, initBuf);
				wasmType = F64;
			} else {
				initBuf.push(OP_I32_CONST);
				sleb128(value.value | 0, initBuf);
				wasmType = I32;
			}
			needsRuntimeInit = false;
		} else if (value.kind === 'string') {
			const raw = text(value);
			const decoded = decodeEscapes(raw.slice(1, -1));
			const ptr = intern(decoded);
			initBuf.push(OP_I32_CONST);
			sleb128(ptr, initBuf);
			wasmType = I32;
			valueType = BaseTypes.String;
			needsRuntimeInit = false;
		} else if (value.kind === 'ident') {
			const idSym = value.symbol;
			if (idSym.kind === 'literal') {
				const t = idSym.type;
				if (t?.kind === 'type') {
					if (t.family === 'bool') {
						initBuf.push(OP_I32_CONST);
						sleb128(idSym.value ? 1 : 0, initBuf);
						wasmType = I32;
						valueType = t;
						needsRuntimeInit = false;
					} else if (t.family === 'float') {
						initBuf.push(OP_F64_CONST);
						f64le(idSym.value as number, initBuf);
						wasmType = F64;
						valueType = t;
						needsRuntimeInit = false;
					} else {
						initBuf.push(OP_I32_CONST);
						sleb128(0, initBuf);
						wasmType = I32;
					}
				} else {
					initBuf.push(OP_I32_CONST);
					sleb128(0, initBuf);
					wasmType = I32;
				}
			} else {
				initBuf.push(OP_I32_CONST);
				sleb128(0, initBuf);
				wasmType = I32;
			}
		} else {
			// Determine type for placeholder
			const inferred = valueType ?? inferType(value);
			valueType = inferred;
			if (inferred.kind === 'type' && inferred.family === 'float') {
				initBuf.push(OP_F64_CONST);
				f64le(0, initBuf);
				wasmType = F64;
			} else {
				initBuf.push(OP_I32_CONST);
				sleb128(0, initBuf);
				wasmType = I32;
			}
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

	// Phase 1: declare every top-level fn def. Allows forward references.
	// Union-param templates return null and are compiled lazily per call site.
	const fnsToCompile: { builder: FuncBuilder; fnNode: NodeMap['fn'] }[] = [];
	if (root.kind === 'root') {
		for (const child of root.children) {
			if (child.kind === 'def' && child.value.kind === 'fn') {
				const declared = declareFn(child.label, child.value);
				if (declared) fnsToCompile.push(declared);
			}
		}
	}

	// Phase 2: declare top-level non-fn defs as globals.
	if (root.kind === 'root') {
		for (const child of root.children) {
			if (child.kind === 'def' && child.value.kind !== 'fn') {
				compileTopLevelDef(child);
			}
		}
	}

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

	// Emit runtime initializers for top-level globals before main body.
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

	if (root.kind === 'root') {
		for (const child of root.children) {
			if (child.kind === '=') {
				// Top-level reassignment of mutable global.
				compileExpr(child, mainBuilder);
			}
			if (child.kind === '>>') {
				compileExpr(child, mainBuilder);
			}
			if (child.kind === 'main') {
				for (const stmt of child.statements)
					compileMainStatement(stmt, mainBuilder);
			}
		}
	}

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
			t.kind === 'type' &&
			t.family !== 'void' &&
			t.family !== 'unknown'
		)
			fn.body.push(OP_DROP);
	}

	// Phase 5: resolve funcidx fixups
	const baseFuncIdx = imports.length;
	for (const b of funcBuilders) {
		for (const fix of b.callFixups) {
			const funcIdx = baseFuncIdx + fix.builderIdx;
			const enc: number[] = [];
			uleb128(funcIdx, enc);
			// Pad to fix.size bytes (5 reserved). Set continuation bit on all
			// but the last byte for proper LEB128 encoding.
			while (enc.length < fix.size) {
				enc[enc.length - 1] = (enc[enc.length - 1]! | 0x80) & 0xff;
				enc.push(0x00);
			}
			for (let i = 0; i < fix.size; i++) {
				b.body[fix.offset + i] = enc[i]!;
			}
		}
	}
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
