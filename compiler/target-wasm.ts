import { sleb128, sleb128big, text, uleb128 } from '../sdk/index.js';

import { reduceType } from './checker.js';
import {
	bufferTypeOf,
	BaseTypes,
	Flags,
	isFloatType,
	isInt64Type,
	isIntType,
	isNumericType,
	isUintType,
	numberLiteralType,
	numericResultType,
	StackIntrinsic,
	unifyTypeParam,
} from './symbol-table.js';

import type { Node, NodeMap } from './node.js';
import type {
	Symbol as GbcSymbol,
	SymbolMap,
	Type,
	TypeFamily,
} from './symbol-table.js';
import type { SerialObject, SerialRef } from './bundle.js';

export interface SpliceInput {
	objects: Map<GbcSymbol, SerialObject>;
	resolveRef: (ref: SerialRef) => GbcSymbol | undefined;
}

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

// The stdlib `DivByZero` type, injected at program init so integer
// division codegen can build and tag the error value.
let divByZeroType: Type | undefined;
export function setDivByZeroType(t: Type | undefined): void {
	divByZeroType = t;
}
// The stdlib `Trace` and `Frame` types, injected at program init.
// Every Error-composed value carries a hidden one-word `__trace` slot filled
// at construction with a static origin-frame pointer; `origin(e)` retypes it.
let traceType: Type | undefined;
let frameType: Type | undefined;
export function setTraceTypes(
	trace: Type | undefined,
	frame: Type | undefined,
): void {
	traceType = trace;
	frameType = frame;
}
function isTraceComposed(
	t: Type | undefined,
): t is Extract<SymbolMap['type'], { family: 'data' }> {
	return (
		!!t &&
		!!traceType &&
		t.kind === 'type' &&
		t.family === 'data' &&
		composes(t, traceType)
	);
}
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
const OP_BR_IF = 0x0d;
const OP_RETURN = 0x0f;
const OP_CALL = 0x10;
const OP_RETURN_CALL = 0x12;
const OP_DROP = 0x1a;
const OP_LOCAL_GET = 0x20;
const OP_LOCAL_SET = 0x21;
const OP_LOCAL_TEE = 0x22;
const OP_GLOBAL_GET = 0x23;
const OP_GLOBAL_SET = 0x24;

const OP_I32_LOAD = 0x28;
const OP_I64_LOAD = 0x29;
const OP_F32_LOAD = 0x2a;
const OP_F64_LOAD = 0x2b;
const OP_I32_LOAD8_U = 0x2d;
const OP_I32_LOAD16_U = 0x2f;
const OP_I32_STORE = 0x36;
const OP_I64_STORE = 0x37;
const OP_F32_STORE = 0x38;
const OP_F64_STORE = 0x39;
const OP_I32_STORE8 = 0x3a;
const OP_I32_STORE16 = 0x3b;

const OP_I32_CONST = 0x41;
const OP_F64_CONST = 0x44;

const OP_I32_EQZ = 0x45;
const OP_I32_EQ = 0x46;
const OP_I32_NE = 0x47;
const OP_I32_LT_S = 0x48;
const OP_I32_LT_U = 0x49;
const OP_I32_GT_S = 0x4a;
const OP_I32_GT_U = 0x4b;
const OP_I32_LE_S = 0x4c;
const OP_I32_LE_U = 0x4d;
const OP_I32_GE_S = 0x4e;
const OP_I32_GE_U = 0x4f;

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
const OP_I32_DIV_U = 0x6e;
const OP_I32_REM_S = 0x6f;
const OP_I32_REM_U = 0x70;
const OP_I32_AND = 0x71;

const SCALAR_CTORS: Record<string, SymbolMap['type']> = {
	Int8: BaseTypes.Int8,
	Int16: BaseTypes.Int16,
	Int32: BaseTypes.Int32,
	Int64: BaseTypes.Int64,
	Uint8: BaseTypes.Uint8,
	Uint16: BaseTypes.Uint16,
	Uint32: BaseTypes.Uint32,
	Uint64: BaseTypes.Uint64,
	Float32: BaseTypes.Float32,
	Float64: BaseTypes.Float64,
};
const OP_I32_OR = 0x72;
const OP_I32_XOR = 0x73;
const OP_I32_SHL = 0x74;
const OP_I32_SHR_S = 0x75;
const OP_SELECT = 0x1b;

const OP_F64_ADD = 0xa0;
const OP_F64_SUB = 0xa1;
const OP_F64_MUL = 0xa2;
const OP_F64_DIV = 0xa3;
const OP_F64_NEG = 0x9a;

const OP_F64_CONVERT_I32_S = 0xb7;

const OP_I32_WRAP_I64 = 0xa7;
const OP_I64_EXTEND_I32_S = 0xac;
const OP_I64_EXTEND_I32_U = 0xad;
const OP_I32_REINTERPRET_F32 = 0xbc;
const OP_I64_REINTERPRET_F64 = 0xbd;
const OP_F32_REINTERPRET_I32 = 0xbe;
const OP_F64_REINTERPRET_I64 = 0xbf;
const OP_I64_TRUNC_F64_S = 0xb0;
const OP_I64_TRUNC_F64_U = 0xb1;
const OP_F64_CONVERT_I64_S = 0xb9;
const OP_F64_PROMOTE_F32 = 0xbb;

const OP_I64_CONST = 0x42;
const OP_I64_ADD = 0x7c;
const OP_I64_SUB = 0x7d;
const OP_I64_MUL = 0x7e;
const OP_I64_DIV_S = 0x7f;
const OP_I64_DIV_U = 0x80;
const OP_I64_REM_S = 0x81;
const OP_I64_REM_U = 0x82;
const OP_I64_EQZ = 0x50;
const OP_I64_EQ = 0x51;
const OP_I64_NE = 0x52;
const OP_I64_LT_S = 0x53;
const OP_I64_LT_U = 0x54;
const OP_I64_GT_S = 0x55;
const OP_I64_GT_U = 0x56;
const OP_I64_LE_S = 0x57;
const OP_I64_LE_U = 0x58;
const OP_I64_GE_S = 0x59;
const OP_I64_GE_U = 0x5a;
const OP_I64_AND = 0x83;
const OP_I64_OR = 0x84;
const OP_I64_XOR = 0x85;
const OP_I64_SHL = 0x86;
const OP_I64_SHR_S = 0x87;

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

function writeFixed5(n: number, out: number[]) {
	for (let i = 0; i < 5; i++) {
		const b = n & 0x7f;
		n >>= 7;
		out.push(i < 4 ? b | 0x80 : b);
	}
}

function patchFixed5(body: number[], offset: number, n: number) {
	for (let i = 0; i < 5; i++) {
		body[offset + i] = (i < 4 ? (n & 0x7f) | 0x80 : n & 0x7f) & 0xff;
		n >>= 7;
	}
}

function setTypeInPlace(target: object, src: object) {
	for (const k of Object.keys(target)) Reflect.deleteProperty(target, k);
	Object.assign(target, src);
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
	name?: string;
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
	start?: number;
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

function emitNameSection(m: Module, out: number[]) {
	const entries: [number, string][] = [];
	m.imports.forEach((im, i) => entries.push([i, im.field]));
	m.functions.forEach((fb, i) => {
		if (fb.name) entries.push([m.imports.length + i, fb.name]);
	});
	if (!entries.length) return;
	const sub: number[] = [];
	uleb128(entries.length, sub);
	for (const [idx, nm] of entries) {
		uleb128(idx, sub);
		name(nm, sub);
	}
	const payload: number[] = [];
	name('name', payload);
	payload.push(1);
	uleb128(sub.length, payload);
	for (const b of sub) payload.push(b);
	section(0, payload, out);
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
	if (m.start !== undefined) {
		const payload: number[] = [];
		uleb128(m.start, payload);
		section(8, payload, out);
	}
	emitCodeSection(m, out);
	emitDataSection(m, out);
	emitNameSection(m, out);

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
		case 'char':
		case 'string':
		case 'fn':
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

function unionPayloadWasm(t: Type): number {
	if (t.kind !== 'type' || t.family !== 'union') return I32;
	let maxSize = 0;
	for (const m of t.members)
		if (m.kind === 'type' && m.size > maxSize) maxSize = m.size;
	return maxSize > 4 ? I64 : I32;
}

function wasmTypesOf(t: Type): number[] {
	if (isUnionType(t)) return [unionPayloadWasm(t), I32];
	if (t.kind === 'type' && t.family === 'void') return [];
	return [gbcToWasm(t)];
}

function isUnknownType(t: Type): boolean {
	return t.kind === 'type' && t.family === 'unknown';
}

function isUnionType(t: Type): boolean {
	if (t.kind !== 'type' || t.family !== 'union') return false;
	if (
		t.members.length > 0 &&
		t.members.every(m => m.kind === 'type' && m.family === 'literal')
	)
		return false;
	return true;
}

function isInlineData(t: Type): boolean {
	return t.kind === 'type' && t.family === 'data' && !t.elem;
}

function fieldBytes(t: Type): number {
	if (isUnionType(t)) return (unionPayloadWasm(t) === I64 ? 8 : 4) + 4;
	if (t.kind === 'type') {
		if (t.family === 'float') return t.size === 4 ? 4 : 8;
		if (t.family === 'int' || t.family === 'uint') return t.size;
		if (t.family === 'data') return isInlineData(t) ? fieldLayout(t.members).total : 4;
	}
	return 4;
}

// Does a value of this type own heap allocations that drop-glue must free?
// Scalars/void: no. String: yes. A collection always owns its block. A record
// owns heap iff any member (or the hidden trace slot) does.
function typeOwnsHeap(t: Type | undefined): boolean {
	if (!t || t.kind !== 'type') return false;
	if (t.family === 'string') return true;
	if (t.family === 'data') {
		if (t.elem) return true;
		return Object.keys(t.members).some(
			k => k === '__trace' || typeOwnsHeap(t.members[k]?.type),
		);
	}
	return false;
}

function fieldAlign(t: Type): number {
	if (isUnionType(t)) return unionPayloadWasm(t) === I64 ? 8 : 4;
	if (t.kind === 'type' && t.family === 'data') {
		let a = 1;
		for (const k of Object.keys(t.members)) {
			const fa = fieldAlign(t.members[k]?.type ?? BaseTypes.Int32);
			if (fa > a) a = fa;
		}
		return a;
	}
	return fieldBytes(t);
}

function layoutTypes(types: Type[]): { offs: number[]; total: number } {
	const offs: number[] = [];
	let off = 0;
	let maxAlign = 1;
	for (const ft of types) {
		const a = fieldAlign(ft);
		const b = fieldBytes(ft);
		off = (off + a - 1) & ~(a - 1);
		offs.push(off);
		off += b;
		if (a > maxAlign) maxAlign = a;
	}
	return { offs, total: (off + maxAlign - 1) & ~(maxAlign - 1) };
}

function fieldLayout(members: Record<string, GbcSymbol>): {
	keys: string[];
	offs: number[];
	total: number;
} {
	const keys = Object.keys(members);
	const { offs, total } = layoutTypes(
		keys.map(k => members[k]?.type ?? BaseTypes.Int32),
	);
	return { keys, offs, total };
}

function fnSignature(fn: SymbolMap['function']): {
	params: number[];
	results: number[];
} {
	const params = (fn.parameters ?? []).flatMap(p => {
		if (!p.type)
			throw new Error(
				`Function "${fn.name ?? '?'}" parameter has no type`,
			);
		return wasmTypesOf(p.type);
	});
	const ret = fn.returnType;
	const results: number[] = ret ? wasmTypesOf(ret) : [];
	return { params, results };
}

function isStringType(t: Type): boolean {
	return t.kind === 'type' && t.family === 'string';
}

function composes(m: Type, target: Type): boolean {
	return m === target || !!m.components?.some(c => composes(c, target));
}

function namedData(t: Type): boolean {
	return t.kind === 'type' && t.family === 'data' && t.name !== '__data';
}

interface Fusion {
	/** Drive one emitted value through the downstream stages. Returns the
	 * chain's result type when known — a scalar/void result proves no stage
	 * forwarded the pointer, so the emitter may free a fresh heap temp;
	 * `undefined` means the value escapes (kept as the frame result). */
	emit: (valueType: Type) => Type | undefined;
	targetDepth: number;
}

type Reloc =
	| { kind: 'data'; offset: number; str: string }
	| { kind: 'tag'; offset: number; key: string }
	| { kind: 'global'; offset: number; sym: GbcSymbol };

export type ObjReloc =
	| { kind: 'data'; offset: number; str: string }
	| { kind: 'tag'; offset: number; key: string }
	| { kind: 'global'; offset: number; sym: GbcSymbol }
	| { kind: 'call'; offset: number; sym: GbcSymbol }
	| { kind: 'callrt'; offset: number; rt: string };

export interface LibraryObject {
	sym: GbcSymbol;
	params: number[];
	results: number[];
	locals: number[];
	code: number[];
	relocs: ObjReloc[];
}

interface FuncBuilder {
	typeIdx: number;
	body: number[];
	locals: number[];
	paramCount: number;
	paramMap: Map<GbcSymbol, number>;
	tagMap?: Map<GbcSymbol, number>;
	returnType: Type;
	callFixups: { offset: number; builderIdx: number; size: number }[];
	blockDepth: number;
	name?: string;
	fusion?: Fusion;
	/** Local index holding the current pipe-stage input value (`$`). */
	dollarLocal?: number;
	dollarTagLocal?: number;
	/** Type of `$` in the current pipe-stage scope. */
	dollarType?: Type;
	/** Block depth that `done` should branch to (inside inline-emit). */
	doneDepth?: number;
	/**
	 * When set, a pipe whose stages run out leaves its value on the stack for an
	 * enclosing expression (e.g. a ternary branch) instead of emitting it into
	 * the active `fusion`. `fusion` is still kept so `break` can reach its
	 * `targetDepth`.
	 */
	pipeValue?: boolean;
	/** Heap values owned by this body; still-owned entries are freed at
	 * body exit, `next`-moved ones are released. Union entries branch on
	 * the tag; error-composed values also free their trace chain. `temp`
	 * entries are anonymous argument temporaries — no name can reference
	 * one, so a tail call may free them and still `return_call`. */
	owned?: {
		sym: GbcSymbol;
		localIdx: number;
		tagIdx?: number;
		type?: Type;
		temp?: boolean;
		/** An owned-in param — every call site feeds it a fresh value, so
		 * this body owns it like a temp, but by its real name (moves and
		 * re-passes release it). Tail calls may free these too. */
		paramOwned?: boolean;
	}[];
	/** Source line of the fn definition — chain-frame attribution (debug). */
	originLine?: number;
	/** The local currently being bound (`r = <expr>`): a borrow-returning
	 * call inside the expr keys its fresh arg temps to this name, so the
	 * binder adopts them — freed at block exit, or released together with
	 * the binder if it escapes. */
	bindingSym?: GbcSymbol;
	relocs?: Reloc[];
	relocTainted?: boolean;
}

export function compileWasm(
	root: Node,
	testMode = false,
	debugBuild = false,
	hostExports?: NodeMap['def'][],
	sourcePaths?: Map<string, string>,
	objectSink?: LibraryObject[],
	splice?: SpliceInput,
): Uint8Array {
	const recordObjects = !!objectSink;
	const datas: ModuleData[] = [];
	const enc = new TextEncoder();
	let heap = 0;
	const internCache = new Map<string, number>();
	// Every `intern` call while recording a fn for `.gbm` storage must be
	// matched by a `data` reloc (via `emitDataConst`/`dataImm`); an unmatched
	// one means a data offset was baked without a relocation, so the fn is
	// tainted rather than stored with a wrong offset. Counted, not per-fn
	// attributed, so it is snapshotted around each recorded body.
	let internCalls = 0;

	function intern(s: string): number {
		internCalls++;
		const cached = internCache.get(s);
		if (cached !== undefined) return cached;
		const utf8 = enc.encode(s);
		const buf: number[] = [];
		u32le(utf8.length, buf);
		u32le(1, buf);
		for (const b of utf8) buf.push(b);
		const offset = heap;
		datas.push({ offset, bytes: buf });
		heap += buf.length;
		// 4-byte align
		heap = (heap + 3) & ~3;
		internCache.set(s, offset);
		return offset;
	}

	function internWords(words: number[]): number {
		const buf: number[] = [];
		for (const w of words) u32le(w, buf);
		const offset = heap;
		datas.push({ offset, bytes: buf });
		heap += buf.length;
		return offset;
	}

	// A static origin frame `[name, fn, file, line]` (the headerless Frame
	// layout), deduped per construction site. `file` comes from the module
	// loader's source→path registry; single-source compiles have none.
	const frameCache = new Map<string, number>();
	function staticFramePtr(
		typeName: string,
		fnName: string,
		line: number,
		file = '',
	): number {
		const key = `${typeName}\0${fnName}\0${line}\0${file}`;
		const cached = frameCache.get(key);
		if (cached !== undefined) return cached;
		const ptr = internWords([
			intern(typeName),
			intern(fnName),
			intern(file),
			line,
		]);
		frameCache.set(key, ptr);
		return ptr;
	}

	function sourceFileOf(node: Node): string {
		return sourcePaths?.get(node.source) ?? '';
	}

	const hostImportsByField = new Map<string, number>();
	const imports: ModuleImport[] = [];
	const types: ModuleType[] = [];
	const globals: ModuleGlobal[] = [];

	// Debug builds: a shadow call stack lives between static data and the
	// heap (below heapStart, so `__free`'s static guard ignores it). Three
	// globals — sp, base, limit — whose inits are patched at assembly once
	// the static segment size is known; instrumentation reads only globals,
	// so no immediates need fixups.
	const SHADOW_BYTES = 4096;
	const shadowSpIdx = debugBuild ? globals.length : -1;
	const shadowBaseIdx = debugBuild ? globals.length + 1 : -1;
	const shadowLimitIdx = debugBuild ? globals.length + 2 : -1;
	if (debugBuild)
		for (let i = 0; i < 3; i++)
			globals.push({
				type: I32,
				mutable: i === 0,
				init: [OP_I32_CONST, 0],
			});

	function emitShadowPush(fn: FuncBuilder, framePtr: number) {
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowLimitIdx, fn.body);
		fn.body.push(0x49); // i32.lt_u — saturate when the region is full
		fn.body.push(OP_IF, 0x40);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(framePtr, fn.body);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_I32_CONST, 4, OP_I32_ADD);
		fn.body.push(OP_GLOBAL_SET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_END);
	}

	function emitShadowPop(fn: FuncBuilder) {
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowBaseIdx, fn.body);
		fn.body.push(0x4b); // i32.gt_u
		fn.body.push(OP_IF, 0x40);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_I32_CONST, 4, OP_I32_SUB);
		fn.body.push(OP_GLOBAL_SET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_END);
	}

	/** A tail call replaces the physical frame — mirror it: overwrite the
	 * top shadow entry, leaving depth unchanged (TCO chains collapse). */
	function emitShadowReplaceTop(fn: FuncBuilder, framePtr: number) {
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowBaseIdx, fn.body);
		fn.body.push(0x4b); // i32.gt_u
		fn.body.push(OP_IF, 0x40);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, fn.body);
		fn.body.push(OP_I32_CONST, 4, OP_I32_SUB);
		fn.body.push(OP_I32_CONST);
		sleb128(framePtr, fn.body);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_END);
	}

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
	const allocBuilderIdx = funcBuilders.length;
	const allocBuilder: FuncBuilder = {
		typeIdx: typeIdx([I32], [I32]),
		body: [],
		locals: [],
		paramCount: 1,
		paramMap: new Map(),
		returnType: BaseTypes.Int32,
		callFixups: [],
		blockDepth: 0,
		name: '__alloc',
	};
	funcBuilders.push(allocBuilder);
	const streqBuilderIdx = funcBuilders.length;
	const streqBuilder: FuncBuilder = {
		typeIdx: typeIdx([I32, I32], [I32]),
		body: [],
		locals: [I32, I32],
		paramCount: 2,
		paramMap: new Map(),
		returnType: BaseTypes.Bool,
		callFixups: [],
		blockDepth: 0,
		name: '__streq',
	};
	funcBuilders.push(streqBuilder);
	const freeBuilderIdx = funcBuilders.length;
	const freeBuilder: FuncBuilder = {
		typeIdx: typeIdx([I32], []),
		body: [],
		locals: [I32],
		paramCount: 1,
		paramMap: new Map(),
		returnType: BaseTypes.Void,
		callFixups: [],
		blockDepth: 0,
		name: '__free',
	};
	funcBuilders.push(freeBuilder);
	// __capture(origin) -> chain handle: [count][origin][entries...] copied
	// from the shadow region. Debug builds only.
	const captureBuilderIdx = funcBuilders.length;
	const captureBuilder: FuncBuilder = {
		typeIdx: typeIdx([I32], [I32]),
		body: [],
		locals: [I32, I32],
		paramCount: 1,
		paramMap: new Map(),
		returnType: BaseTypes.Int32,
		callFixups: [],
		blockDepth: 0,
		name: '__capture',
	};
	if (debugBuild) funcBuilders.push(captureBuilder);

	const builderFrames = new Map<number, number>();
	function builderFramePtr(builderIdx: number): number {
		const cached = builderFrames.get(builderIdx);
		if (cached !== undefined) return cached;
		const b = funcBuilders[builderIdx];
		const name = b?.name ?? '?';
		const ptr = staticFramePtr(name, name, b?.originLine ?? 0);
		builderFrames.set(builderIdx, ptr);
		return ptr;
	}
	const fnDefBuilderIdx = new Map<GbcSymbol, number>();
	const fnNodeBySym = new Map<GbcSymbol, NodeMap['fn']>();
	const builderSym = new Map<number, GbcSymbol>();
	const spliceByBuilder = new Map<FuncBuilder, SerialObject>();
	const ownedInParams = new Map<GbcSymbol, boolean[]>();

	/** Owned-in params: a self-recursive fn whose every call site feeds a
	 * heap param a fresh (or static) value owns that param — the body
	 * frees it at exit and releases it when moved, and callers stop
	 * temp-marking the slot. A bare re-pass of the same param is allowed
	 * only at the fn's own tail (the thread-through accumulator); any
	 * other bare-ident argument, a non-call use of the fn (stage, value),
	 * or a host export disqualifies the slot. */
	function computeOwnedInParams(rootNode: Node) {
		if (rootNode.kind !== 'root') return;
		interface Info {
			defSym: GbcSymbol;
			fnNode: NodeMap['fn'];
			sites: NodeMap['call'][];
			nonCall: boolean;
			selfSites: Set<NodeMap['call']>;
		}
		const infos = new Map<GbcSymbol, Info>();
		for (const child of rootNode.children) {
			if (child.kind !== 'def' || child.value.kind !== 'fn') continue;
			const fnNode = child.value;
			const params = fnNode.parameters ?? [];
			if (!params.length) continue;
			// Dispatch (union-typed) params are handled by other machinery — skip
			// those fns. Function and type-param value params are fine: the fn is
			// analyzed and the per-param type gate excludes them, while a concrete
			// `Buffer<U>` accumulator alongside a function param (e.g. `map`'s
			// destination) still qualifies.
			const hasUnionParam = params.some(p => {
				const t = p.symbol.type;
				return t?.kind === 'type' && t.family === 'union';
			});
			if (hasUnionParam) continue;
			if (hostExports && child.symbol.flags & Flags.Export) continue;
			infos.set(child.symbol, {
				defSym: child.symbol,
				fnNode,
				sites: [],
				nonCall: false,
				selfSites: new Set(),
			});
		}
		if (!infos.size) return;
		const calleeIdents = new Set<Node>();
		const fnStack: NodeMap['fn'][] = [];
		const visit = (n: Node | undefined): void => {
			if (!n) return;
			const isFn = n.kind === 'fn';
			if (isFn) fnStack.push(n);
			if (n.kind === 'call') {
				const callee = n.children[0];
				if (callee.kind === 'ident') {
					calleeIdents.add(callee);
					const info = infos.get(callee.symbol);
					if (info) {
						info.sites.push(n);
						if (fnStack.includes(info.fnNode))
							info.selfSites.add(n);
					}
				}
			} else if (n.kind === 'ident') {
				const info = infos.get(n.symbol);
				if (info && !calleeIdents.has(n)) info.nonCall = true;
			}
			if ('children' in n && n.children) {
				const kids = n.children;
				for (let i = 0; i < kids.length; i++) visit(kids[i]);
			}
			if ('statements' in n && n.statements) {
				const stmts = n.statements;
				for (let i = 0; i < stmts.length; i++) visit(stmts[i]);
			}
			if (n.kind === 'def' || n.kind === 'propdef') visit(n.value);
			if (isFn) fnStack.pop();
		};
		visit(rootNode);
		const tailCallsOf = (fnNode: NodeMap['fn']): Set<Node> => {
			const tails = new Set<Node>();
			const visitTail = (n: Node | undefined): void => {
				if (!n) return;
				if (n.kind === 'next') return visitTail(n.children?.[0]);
				if (n.kind === '?') {
					visitTail(n.children[1]);
					visitTail(n.children[2]);
					return;
				}
				if (n.kind === 'call') tails.add(n);
			};
			const stmts = fnNode.statements ?? [];
			visitTail(stmts[stmts.length - 1]);
			return tails;
		};
		// paramSym -> its owning fn + index, so an arg that is itself an
		// owned-in param can be recognized as movable-in.
		const paramOwner = new Map<GbcSymbol, { info: Info; idx: number }>();
		for (const info of infos.values())
			(info.fnNode.parameters ?? []).forEach((p, i) =>
				paramOwner.set(p.symbol, { info, idx: i }),
			);
		// Walk the body; true when `sym` appears at an arg position of a
		// `set`/`transfer` call that `match(name, argIndex)` accepts. Buffer args
		// (arg 0) are relocated; a `set` value arg (arg 2) is embedded — both
		// move `sym` into the buffer, so the param must be owned-in.
		const paramFlowsInto = (
			fnNode: NodeMap['fn'],
			sym: GbcSymbol,
			match: (name: string, argIndex: number) => boolean,
		): boolean => {
			const flowsAtCall = (n: NodeMap['call']): boolean => {
				const callee = n.children[0];
				if (
					callee.kind !== 'ident' ||
					callee.symbol.kind !== 'function' ||
					!(callee.symbol.flags & Flags.Intrinsic) ||
					(callee.symbol.name !== 'set' &&
						callee.symbol.name !== 'transfer')
				)
					return false;
				const a = n.children[1];
				const args = a?.kind === ',' ? a.children : a ? [a] : [];
				for (let k = 0; k < args.length; k++) {
					const ak = args[k];
					if (
						ak?.kind === 'ident' &&
						ak.symbol === sym &&
						match(callee.symbol.name ?? '', k)
					)
						return true;
				}
				return false;
			};
			let hit = false;
			const walk = (n: Node | undefined): void => {
				if (!n || hit) return;
				if (n.kind === 'call' && flowsAtCall(n)) hit = true;
				if ('children' in n && n.children) {
					const kids = n.children;
					for (let j = 0; j < kids.length; j++) walk(kids[j]);
				}
				if ('statements' in n && n.statements) {
					const stmts = n.statements;
					for (let j = 0; j < stmts.length; j++) walk(stmts[j]);
				}
				if (n.kind === 'def' || n.kind === 'propdef') walk(n.value);
			};
			(fnNode.statements ?? []).forEach(walk);
			return hit;
		};
		const consumesBuffer = (fnNode: NodeMap['fn'], sym: GbcSymbol): boolean =>
			paramFlowsInto(
				fnNode,
				sym,
				(name, i) =>
					(name === 'set' && i === 0) ||
					(name === 'transfer' && (i === 0 || i === 1)),
			);
		const embedsValue = (fnNode: NodeMap['fn'], sym: GbcSymbol): boolean =>
			paramFlowsInto(fnNode, sym, (nm, i) => nm === 'set' && i === 2);
		const flagsOf = new Map<Info, boolean[]>();
		const meta = new Map<Info, { paramSyms: GbcSymbol[]; tails: Set<Node> }>();
		const isOwnedInParam = (sym: GbcSymbol): boolean => {
			const o = paramOwner.get(sym);
			return !!o && !!flagsOf.get(o.info)?.[o.idx];
		};
		// The caller owns `a` and can move it into a consuming slot: a fresh
		// block, an owned local (fresh-valued binding — incl. a `push`/`set`
		// result once its callee is known owned-in), or an owned-in param.
		const argMovableIn = (a: Node): boolean => {
			if (a.kind === 'string') return true;
			if (ownableExpr(a)) return true;
			if (a.kind === 'ident') {
				if (isOwnedInParam(a.symbol)) return true;
				const def = a.symbol.definition;
				if (def?.kind === 'def' && ownableExpr(def.value)) return true;
			}
			// A call to a higher-order (function-typed) param produces a value the
			// caller relinquishes into the consumer — treat it as movable so a
			// consumer like `push` stays owned-in even when one caller feeds it
			// `f(get(a, i))` (as `map` does). Sound when `f` returns a fresh value;
			// a passthrough/identity `f` over heap elements would alias.
			if (a.kind === 'call') {
				const callee = a.children[0];
				if (callee.kind === 'ident' && callee.symbol.type?.kind === 'function')
					return true;
			}
			return false;
		};
		const typedHeap = (sym: GbcSymbol): boolean => {
			const t = sym.type;
			return (
				t?.kind === 'type' &&
				(t.family === 'string' || t.family === 'data')
			);
		};
		// A self-recursive accumulator keeps the original site rule (string |
		// fresh | tail re-pass); a consuming param admits any movable-in arg.
		const okSites = (
			info: Info,
			i: number,
			paramSyms: GbcSymbol[],
			tails: Set<Node>,
			accum: boolean,
		): boolean =>
			info.sites.every(site => {
				const a = resolveArgNodes(
					paramSyms,
					argListFromCall(site.children[1]),
				)[i];
				if (!a) return false;
				if (accum && a.kind === 'string') return true;
				if (
					a.kind === 'ident' &&
					a.symbol === paramSyms[i] &&
					info.selfSites.has(site) &&
					tails.has(site)
				)
					return true;
				return accum ? ownableExpr(a) : argMovableIn(a);
			});
		const qualifies = (
			info: Info,
			i: number,
			paramSyms: GbcSymbol[],
			tails: Set<Node>,
		): boolean => {
			const sym = paramSyms[i];
			if (!sym) return false;
			const heap = typedHeap(sym);
			// An embedded value param (`set`'s value arg) is owned-in even when
			// its declared type is a type variable — it monomorphizes to a heap
			// element in some specs; `compileFnBody` gates the actual drop-glue
			// on the concrete type, so a scalar spec stays a no-op.
			const embed = embedsValue(info.fnNode, sym);
			if (!heap && !embed) return false;
			if (
				heap &&
				info.selfSites.size > 0 &&
				okSites(info, i, paramSyms, tails, true)
			)
				return true;
			return (
				((heap && consumesBuffer(info.fnNode, sym)) || embed) &&
				okSites(info, i, paramSyms, tails, false)
			);
		};
		// Seed: self-accumulators are decided by the map-independent rule;
		// consuming params start optimistic so a `push`-of-a-`push` chain can
		// converge (a consuming fn's result is owned only when its own param is
		// owned-in). The fixpoint below is monotone decreasing.
		for (const info of infos.values()) {
			if (info.nonCall || !info.sites.length) continue;
			const paramSyms = (info.fnNode.parameters ?? []).map(p => p.symbol);
			const tails = tailCallsOf(info.fnNode);
			meta.set(info, { paramSyms, tails });
			flagsOf.set(
				info,
				paramSyms.map(
					sym =>
						(typedHeap(sym) &&
							(info.selfSites.size > 0 ||
								consumesBuffer(info.fnNode, sym))) ||
						embedsValue(info.fnNode, sym),
				),
			);
		}
		// Publish working flags so `ownableExpr`/`fnReturnsOwned` reflect them
		// while checking movability; refine until stable.
		const publish = () => {
			ownedInParams.clear();
			returnsOwnedMemo.clear();
			for (const [info, flags] of flagsOf)
				if (flags.some(Boolean)) {
					ownedInParams.set(info.defSym, flags);
					ownedInParams.set(info.fnNode.symbol, flags);
				}
		};
		let changed = true;
		while (changed) {
			changed = false;
			publish();
			for (const [info, { paramSyms, tails }] of meta) {
				const cur = flagsOf.get(info);
				if (!cur) continue;
				const next = cur.map(
					(on, i) => on && qualifies(info, i, paramSyms, tails),
				);
				if (next.some((v, i) => v !== cur[i])) {
					changed = true;
					flagsOf.set(info, next);
				}
			}
		}
		publish();
	}
	/**
	 * Fns with at least one union-typed parameter. They are NOT given an
	 * eager FuncBuilder; each call site monomorphizes a per-signature
	 * specialization via `getOrCreateSpec`.
	 */
	const fnTemplates = new Map<GbcSymbol, NodeMap['fn']>();
	const specCache = new Map<string, number>();
	// Depth guard for inlining emit-position calls (re-emission). Bounded
	// recursion (e.g. `each` over fixed-arity data) unrolls; unbounded runtime
	// recursion hits the cap and falls back to a plain call.
	let emitInlineDepth = 0;
	const MAX_EMIT_INLINE = 64;
	// >0 while inlining a generic Sequence template body — gates the per-level
	// slot re-derivation / scalar-lift in driveFnStage so non-generic stages
	// keep the checker's slot types.
	let inTemplateInline = 0;
	const inliningStages = new Set<GbcSymbol>();
	// A spec's actual return type after type-param and return reduction,
	// keyed by builder index — used so a template call reports the concrete
	// result type, not the template's abstract one.
	const specReturn = new Map<number, Type>();
	const nominalIds = new Map<Type, number>();

	function nominalId(t: Type): number | undefined {
		if (!namedData(t)) return undefined;
		let id = nominalIds.get(t);
		if (id === undefined) {
			id = nominalIds.size + 1;
			nominalIds.set(t, id);
		}
		return id;
	}
	// Function-typed params are bound to a concrete function at each call
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
		node: NodeMap['+' | '-' | '*' | '/' | '%'],
		fn?: FuncBuilder,
	): Type {
		const lt = inferType(node.children[0], fn);
		const rt = inferType(node.children[1], fn);
		return numericResultType(lt, rt) ?? BaseTypes.Unknown;
	}

	function inferCallType(node: NodeMap['call']): Type {
		const callee = node.children[0];
		if (callee.kind === '.') {
			const sfn = resolveStaticMemberFn(callee);
			return sfn ? sfn.returnType ?? BaseTypes.Void : BaseTypes.Unknown;
		}
		if (callee.kind === 'typeident') {
			const cs = callee.symbol;
			if (cs.kind === 'type' && cs.flags & Flags.Collection)
				return cs.family === 'data' && cs.elem
					? cs
					: bufferTypeOf(BaseTypes.Unknown);
			return cs;
		}
		if (callee.kind !== 'ident') return BaseTypes.Unknown;
		const sym = callee.symbol;
		const buf = inferBufferIntrinsic(sym, node);
		if (buf) return buf;
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
		if (rt.kind === 'type' && rt.family === 'unknown' && rt.name)
			return inferGenericReturn(fnSym, rt, node);
		return rt;
	}

	// `get(b,i)` → the buffer's element type; mutations → a buffer type.
	function inferBufferIntrinsic(
		sym: GbcSymbol,
		node: NodeMap['call'],
	): Type | undefined {
		if (!(sym.kind === 'function' && sym.flags & Flags.Intrinsic))
			return undefined;
		const name = sym.name;
		if (name !== 'get' && name !== 'set' && name !== 'transfer')
			return undefined;
		const argsNode = node.children[1];
		const args =
			argsNode?.kind === ',' ? argsNode.children : argsNode ? [argsNode] : [];
		const value = args[name === 'transfer' ? 1 : 0];
		if (!value) return undefined;
		const bt = inferType(value);
		if (bt.kind !== 'type' || bt.family !== 'data' || !bt.elem) return undefined;
		return name === 'get' ? bt.elem : bt;
	}

	// When a fn's declared return is itself a type parameter, recover the
	// concrete return by matching that parameter against the call's args.
	function inferGenericReturn(
		fnSym: SymbolMap['function'],
		rt: SymbolMap['type'],
		node: NodeMap['call'],
	): Type {
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
		return rt;
	}

	function inferStageReturn(stage: Node): Type {
		if (stage.kind === '.') {
			const fnSym = resolveStaticMemberFn(stage);
			if (fnSym) return fnSym.returnType ?? BaseTypes.Void;
		}
		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			const fnSym =
				sym.kind === 'function'
					? sym
					: sym.type?.kind === 'function'
						? sym.type
						: undefined;
			if (fnSym) return fnSym.returnType ?? BaseTypes.Void;
		}
		if (stage.kind === 'fn') return stage.symbol.returnType ?? BaseTypes.Unknown;
		return BaseTypes.Unknown;
	}

	function inferPipeType(node: NodeMap['>>'], fn?: FuncBuilder): Type {
		const flat = flattenPipe(node.children);
		const last = flat[flat.length - 1];
		if (!last) return BaseTypes.Unknown;
		if (flat.length === 1) return inferType(last, fn);
		return inferStageReturn(last);
	}

	function inferMemberType(node: NodeMap['.'], fn?: FuncBuilder): Type {
		const recv = node.children[0];
		const field = node.children[1];
		const recvType = inferType(recv, fn);
		if (recvType.kind === 'type' && recvType.family === 'data') {
			const members = recvType.members;
			if (field.kind === 'ident') {
				const m = members[field.symbol.name ?? ''];
				if (m && m.kind === 'variable' && m.type) return m.type;
			}
			if (field.kind === 'number') {
				// Positional access on a typed receiver: index the member
				// record like `compileMemberLoad` does — `dataItems` only
				// works when the receiver is a literal in hand.
				const key = Object.keys(members)[Number(field.value)];
				const m = key === undefined ? undefined : members[key];
				if (m && m.kind === 'variable' && m.type) return m.type;
				const items = dataItems(recv);
				const item = items[Number(field.value)];
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
				return node.float
					? BaseTypes.Float64
					: node.value >= -0x80000000 && node.value <= 0x7fffffff
						? BaseTypes.Int32
						: BaseTypes.Int64;
			case 'string':
			case 'interp':
				return BaseTypes.String;
			case '$':
				return fn?.dollarType ?? BaseTypes.Int32;
			case 'ident':
				return inferIdentType(node);
			case '+':
			case '-':
			case '*':
			case '/':
			case '%':
				return inferArithType(node, fn);
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>':
			case '~': {
				const lt = inferType(node.children[0], fn);
				const c1 = node.children[1];
				const rt = c1 ? inferType(c1, fn) : lt;
				return isInt64Type(lt) || isInt64Type(rt)
					? BaseTypes.Int64
					: BaseTypes.Int32;
			}
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
			case '>>':
				return inferPipeType(node, fn);
			case 'call':
				return inferCallType(node);
			case '.':
				return inferMemberType(node, fn);
			case 'data': {
				if (isTraceComposed(node.nominal)) return node.nominal;
				const items = dataItems(node)
			.flatMap(flattenDataItem)
			.filter(it => {
				const v = itemValue(it);
				return !(v.kind === 'ident' && v.symbol.kind === 'function');
			});
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
		if (isInt64Type(have)) fn.body.push(OP_F64_CONVERT_I64_S);
		else if (isIntType(have)) fn.body.push(OP_F64_CONVERT_I32_S);
	}

	function coerceToInt64(have: Type, fn: FuncBuilder) {
		if (gbcToWasm(have) === I32)
			fn.body.push(
				isUintType(have) ? OP_I64_EXTEND_I32_U : OP_I64_EXTEND_I32_S,
			);
	}

	/** Widen a 32-bit-or-narrower int on the stack when an Int64 is wanted. */
	function coerceIntWidth(have: Type, want: Type | undefined, fn: FuncBuilder) {
		if (isInt64Type(want) && isIntType(have) && !isInt64Type(have))
			coerceToInt64(have, fn);
	}

	const memberTagMap = new Map<string, number>();
	function memberTagByKey(key: string): number {
		let id = memberTagMap.get(key);
		if (id === undefined) {
			id = memberTagMap.size + 1;
			memberTagMap.set(key, id);
		}
		return id;
	}
	function memberTag(t: Type): number {
		if (t.kind !== 'type') return 0;
		return memberTagByKey(t.family + '#' + t.name);
	}

	function memberKey(t: Type): string {
		return t.kind === 'type' ? t.family + '#' + t.name : '#';
	}
	function resolveUnionMember(union: Type, have: Type): Type {
		if (
			union.kind === 'type' &&
			union.family === 'union' &&
			have.kind === 'type'
		) {
			for (const m of union.members)
				if (
					m.kind === 'type' &&
					m.family === have.family &&
					m.name === have.name
				)
					return m;
			for (const m of union.members)
				if (m.kind === 'type' && composes(have, m)) return m;
		}
		return have;
	}
	function unionTagOf(union: Type, have: Type): number {
		return memberTag(resolveUnionMember(union, have));
	}
	function relocTaint(fn: FuncBuilder) {
		if (fn.relocs) fn.relocTainted = true;
	}

	function matchingTags(union: Type, dt: Type): number[] {
		if (union.kind !== 'type' || union.family !== 'union') return [];
		const tags: number[] = [];
		union.members.forEach(m => {
			if (m.kind !== 'type') return;
			if (
				composes(m, dt) ||
				(dt.kind === 'type' && m.family === dt.family && m.name === dt.name)
			)
				tags.push(memberTag(m));
		});
		return tags;
	}

	function bitcast(from: number, to: number, fn: FuncBuilder) {
		if (from === to) return;
		if (from === I32 && to === I64) fn.body.push(OP_I64_EXTEND_I32_U);
		else if (from === I64 && to === I32) fn.body.push(OP_I32_WRAP_I64);
		else if (from === F64 && to === I64) fn.body.push(OP_I64_REINTERPRET_F64);
		else if (from === I64 && to === F64) fn.body.push(OP_F64_REINTERPRET_I64);
		else if (from === F32 && to === I32) fn.body.push(OP_I32_REINTERPRET_F32);
		else if (from === I32 && to === F32) fn.body.push(OP_F32_REINTERPRET_I32);
		else if (from === F32 && to === I64) {
			fn.body.push(OP_I32_REINTERPRET_F32);
			fn.body.push(OP_I64_EXTEND_I32_U);
		} else if (from === I64 && to === F32) {
			fn.body.push(OP_I32_WRAP_I64);
			fn.body.push(OP_F32_REINTERPRET_I32);
		} else throw new Error(`Cannot bitcast wasm type ${from} to ${to}`);
	}

	function coerceToUnion(have: Type, union: Type, fn: FuncBuilder) {
		if (hasRuntimeValue(have))
			bitcast(gbcToWasm(have), unionPayloadWasm(union), fn);
		const m = resolveUnionMember(union, have);
		emitTagConst(memberTag(m), memberKey(m), fn);
	}

	function compileString(node: NodeMap['string'], fn: FuncBuilder): Type {
		const raw = text(node);
		const decoded = decodeEscapes(raw.slice(1, -1));
		emitDataConst(decoded, fn);
		return BaseTypes.String;
	}

	function compileNumber(node: NodeMap['number'], fn: FuncBuilder): Type {
		const value = node.value;
		if (node.float) {
			fn.body.push(OP_F64_CONST);
			f64le(Number(value), fn.body);
			return BaseTypes.Float64;
		}
		if (typeof value === 'number') {
			if (value >= -0x80000000 && value <= 0x7fffffff) {
				fn.body.push(OP_I32_CONST);
				sleb128(value | 0, fn.body);
				return BaseTypes.Int32;
			}
			fn.body.push(OP_I64_CONST);
			sleb128big(BigInt(value), fn.body);
			return BaseTypes.Int64;
		}
		fn.body.push(OP_I64_CONST);
		sleb128big(value >= 1n << 63n ? value - (1n << 64n) : value, fn.body);
		return numberLiteralType(value);
	}

	function compileIdent(node: NodeMap['ident'], fn: FuncBuilder): Type {
		const sym = node.symbol;
		if (sym.kind === 'literal') {
			const t = sym.type;
			if (t?.kind === 'type') {
				if (t.family === 'void')
					throw new Error(
						'"void" is not a value and cannot be emitted; a chain stops on void — use "cond ? value" for conditional emission',
					);
				if (t.family === 'bool') {
					fn.body.push(OP_I32_CONST);
					sleb128(sym.value ? 1 : 0, fn.body);
					return t;
				}
				if (t.family === 'float') {
					fn.body.push(OP_F64_CONST);
					f64le(Number(sym.value), fn.body);
					return t;
				}
			}
		}
		if (sym.kind === 'variable') {
			const localIdx = fn.paramMap.get(sym);
			if (localIdx !== undefined) {
				fn.body.push(OP_LOCAL_GET);
				uleb128(localIdx, fn.body);
				const tagIdx = fn.tagMap?.get(sym);
				if (
					tagIdx !== undefined &&
					sym.type &&
					isUnionType(sym.type)
				) {
					fn.body.push(OP_LOCAL_GET);
					uleb128(tagIdx, fn.body);
				}
				return sym.type ?? BaseTypes.Unknown;
			}
			const gIdx = globalIdx.get(sym);
			if (gIdx !== undefined) {
				fn.body.push(OP_GLOBAL_GET);
				emitGlobalIdx(gIdx, sym, fn);
				return globalType.get(sym) ?? sym.type ?? BaseTypes.Unknown;
			}
		}
		throw new Error(`Unsupported ident reference: "${sym.name ?? '?'}"`);
	}

	function compileDollar(fn: FuncBuilder): Type {
		if (fn.dollarLocal !== undefined) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(fn.dollarLocal, fn.body);
			if (
				fn.dollarTagLocal !== undefined &&
				fn.dollarType &&
				isUnionType(fn.dollarType)
			) {
				fn.body.push(OP_LOCAL_GET);
				uleb128(fn.dollarTagLocal, fn.body);
			}
			return fn.dollarType ?? BaseTypes.Int32;
		}
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	// Inline a generic Sequence template (e.g. `each`) in emit
	// position — monomorphize the type-params, inline the body driving the
	// current fusion. Recursive calls re-enter here with a shrunk arg type and
	// terminate when it reduces to Void / empty data.
	function pipeTemplateBails(tbody: Node): boolean {
		if (tbody.kind !== '>>') return false;
		const flat = flattenPipe(tbody.children);
		const last = flat[flat.length - 1];
		const innerStmts = last?.kind === 'fn' ? last.statements ?? [] : [];
		return innerStmts.length === 1 && innerStmts[0]?.kind !== ',';
	}

	function tryInlineEmitTemplate(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		const callee = callNode.children[0];
		if (callee.kind !== 'ident') return false;
		const template = fnTemplates.get(callee.symbol);
		if (!template || !(template.symbol.flags & Flags.Sequence)) return false;
		const tStmts = template.statements ?? [];
		const tbody = tStmts[0];
		if (tStmts.length === 1 && tbody?.kind === 'call') return false;
		if (tbody && pipeTemplateBails(tbody)) return false;
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
			// Leave function-typed params alone — they bind by symbol.
			if (at && p.symbol.type?.kind !== 'function') p.symbol.type = at;
		});
		// Template params are shared per-process symbols — restore even
		// when a nested compile error throws.
		try {
			const ok = bindInlineParams(valueParams, argListFromCall(args), fn);
			if (ok) {
				inTemplateInline++;
				try {
					compileFnSource(template, stages, fn);
				} finally {
					inTemplateInline--;
				}
			}
			return ok;
		} finally {
			valueParams.forEach((p, i) => {
				p.symbol.type = savedParamTypes[i];
			});
		}
	}

	// Re-emit a callee's emissions by inlining its body so its `next`s
	// drive the current fusion (empty stages → emit flows to savedFusion).
	function tryInlineEmitCall(val: Node, fn: FuncBuilder): boolean {
		if (val.kind !== 'call' || !fn.fusion) return false;
		if (emitInlineDepth >= MAX_EMIT_INLINE) return false;
		emitInlineDepth++;
		const ok =
			tryInlineSequenceCall(val, [], fn) ||
			tryInlineEmittingCall(val, [], fn) ||
			tryInlineEmitTemplate(val, [], fn);
		emitInlineDepth--;
		return ok;
	}

	/** Mark a data literal flowing into an Error-composed slot so compileData
	 * lays out and fills the hidden `__trace` origin frame. */
	function stampErrorData(
		node: Node | undefined,
		expected: Type | undefined,
		originFn?: string,
	) {
		if (!node || !expected) return;
		if (expected.kind === 'type' && expected.family === 'union') {
			const member = expected.members.find(m => isTraceComposed(m));
			if (member) stampErrorData(node, member, originFn);
			return;
		}
		if (node.kind === 'data') {
			if (isTraceComposed(expected)) {
				node.nominal = expected;
				if (originFn) node.originFn = originFn;
			}
			return;
		}
		if (node.kind === 'call') {
			const callee = node.children[0];
			if (
				callee.kind === 'typeident' &&
				isTraceComposed(callee.symbol) &&
				originFn
			)
				node.originFn = originFn;
			return;
		}
		if (node.kind === 'next' && node.children?.[0])
			return stampErrorData(node.children[0], expected, originFn);
		if (node.kind === '?') {
			stampErrorData(node.children[1], expected, originFn);
			if (node.children[2])
				stampErrorData(node.children[2], expected, originFn);
		}
	}

	/** A `next`-ed (moved-out) owned local must not be freed at body exit. */
	function releaseOwned(fn: FuncBuilder, node: Node | undefined) {
		if (node?.kind === 'ident' && fn.owned)
			fn.owned = fn.owned.filter(o => o.sym !== node.symbol);
	}

	/** Is `callee` a reference to the named prelude intrinsic? */
	function isIntrinsicCallee(callee: Node, name: string): boolean {
		return (
			callee.kind === 'ident' &&
			callee.symbol.kind === 'function' &&
			!!(callee.symbol.flags & Flags.Intrinsic) &&
			callee.symbol.name === name
		);
	}

	/** A tail expression that moves an owned buffer out: a bare owned ident, or
	 * a `set(b, …)` passthrough whose buffer is itself moved out (`set` returns
	 * its buffer unchanged). `transfer` releases at its own call site. */
	function releaseTailOwned(fn: FuncBuilder, node: Node | undefined) {
		if (!node) return;
		if (node.kind === 'ident') return releaseOwned(fn, node);
		if (node.kind !== 'call' || !isIntrinsicCallee(node.children[0], 'set'))
			return;
		const argsNode = node.children[1];
		const a0 = argsNode?.kind === ',' ? argsNode.children[0] : argsNode;
		releaseTailOwned(fn, a0);
	}

	/** `String(x)` allocates for these argument families — via a ctor arm
	 * whose return paths are fresh-or-static, or the built-in char/float
	 * conversions when no arm matches. */
	function ctorAllocsFresh(t: Type): boolean {
		if (t.kind !== 'type') return false;
		if (
			t.family !== 'int' &&
			t.family !== 'uint' &&
			t.family !== 'float' &&
			t.family !== 'bool' &&
			t.family !== 'char'
		)
			return false;
		const arm = findCtorArm('String', t);
		if (arm) return fnReturnsOwned(arm);
		return true;
	}

	/** The node's value is a fresh heap allocation this expression owns —
	 * structurally, or via a callee whose every return path is fresh-or-static
	 * (a static pointer reaching `__free` is a no-op). Borrows are never
	 * ownable, so freeing an ownable temp cannot invalidate an owner. */
	function isFreeableScalar(vt: Type): boolean {
		return (
			vt.kind === 'type' &&
			(vt.family === 'int' ||
				vt.family === 'uint' ||
				vt.family === 'float' ||
				vt.family === 'bool' ||
				vt.family === 'char' ||
				vt.family === 'void')
		);
	}

	// `Buffer<T>(cap)` allocates a fresh collection block; a `String(x)` ctor is
	// ownable when its arm allocates fresh. Other type ctors are not.
	function typeidentOwnable(
		callee: NodeMap['typeident'],
		args: Node | undefined,
		fn?: FuncBuilder,
	): boolean {
		if (callee.symbol.kind === 'type' && callee.symbol.flags & Flags.Collection)
			return true;
		if (callee.symbol.kind !== 'type' || callee.symbol.family !== 'string')
			return false;
		if (!args || args.kind === ',') return false;
		return ctorAllocsFresh(inferType(args, fn));
	}

	// A user fn/dispatch is ownable when the resolved arm returns an owned value.
	function callableOwnable(
		def: NodeMap['def'],
		args: Node | undefined,
		fn?: FuncBuilder,
	): boolean {
		if (def.value.kind === 'fn') return fnReturnsOwned(def.value);
		const armNodes = dispatchArmNodes(def.value);
		if (!armNodes) return false;
		const overloads: SymbolMap['function'][] = [];
		for (const a of armNodes) {
			if (a.kind !== 'fn') return false;
			overloads.push(a.symbol);
		}
		const argList = args ? (args.kind === ',' ? args.children : [args]) : [];
		const arm = findDispatchArm(
			overloads,
			argList.map(a => inferType(a, fn)),
		);
		const armNode = armNodes.find(a => a.kind === 'fn' && a.symbol === arm);
		return armNode?.kind === 'fn' ? fnReturnsOwned(armNode) : false;
	}

	function ownableCall(node: NodeMap['call'], fn?: FuncBuilder): boolean {
		const callee = node.children[0];
		const args = node.children[1];
		if (callee.kind === '.') {
			// `runtime.stack(e)` materializes a fresh collection; its members
			// are static frame words, so a block free suffices.
			const sfn = resolveStaticMemberFn(callee);
			return !!sfn && sfn === StackIntrinsic;
		}
		if (callee.kind === 'typeident')
			return typeidentOwnable(callee, args, fn);
		if (callee.kind !== 'ident') return false;
		if (isIntrinsicCallee(callee, 'transfer')) return true;
		if (isIntrinsicCallee(callee, 'set')) {
			const a0 = args?.kind === ',' ? args.children[0] : args;
			return !!a0 && ownableExpr(a0, fn);
		}
		if (
			callee.symbol.kind === 'function' &&
			callee.symbol.flags & Flags.Intrinsic
		)
			return false;
		const def = callee.symbol.definition;
		return def?.kind === 'def' ? callableOwnable(def, args, fn) : false;
	}

	function ownableExpr(node: Node, fn?: FuncBuilder): boolean {
		if (node.kind === 'interp') return true;
		const vt = inferType(node, fn);
		// vacuous: scalars carry nothing to free
		if (isFreeableScalar(vt)) return true;
		if (node.kind === 'data') {
			const items = dataItems(node).flatMap(flattenDataItem);
			const hasLabels = items.some(
				it => it.kind === 'propdef' && it.label,
			);
			const first = items[0];
			if (items.length === 1 && !hasLabels && first && !node.nominal)
				return ownableExpr(itemValue(first), fn); // collapse = alias
			return true; // labeled/multi/nominal blocks allocate fresh
		}
		if (node.kind === '?')
			return (
				!!node.children[2] &&
				ownableExpr(node.children[1], fn) &&
				ownableExpr(node.children[2], fn)
			);
		if (node.kind === 'call') return ownableCall(node, fn);
		return false;
	}

	const returnsOwnedMemo = new Map<NodeMap['fn'], boolean>();

	function fnReturnsOwned(fnNode: NodeMap['fn']): boolean {
		const memo = returnsOwnedMemo.get(fnNode);
		if (memo !== undefined) return memo;
		returnsOwnedMemo.set(fnNode, true);
		const stmts = fnNode.statements ?? [];
		let result = stmts.length > 0;
		for (let i = 0; i < stmts.length - 1; i++)
			if (stmts[i]?.kind === 'next') result = false;
		const last = stmts[stmts.length - 1];
		if (result && last) result = returnPathOwned(last, fnNode);
		returnsOwnedMemo.set(fnNode, result);
		return result;
	}

	// `next s` of a local this body owns is a move of a fresh value — the
	// idiomatic constructor. Params and outer locals stay borrows, except an
	// owned-in param: returning it moves a value this body owned, fresh to
	// every caller.
	function returnIdentOwned(
		node: NodeMap['ident'],
		fnNode: NodeMap['fn'],
	): boolean {
		const flags = ownedInParams.get(fnNode.symbol);
		if (flags) {
			const idx = (fnNode.parameters ?? []).findIndex(
				p => p.symbol === node.symbol,
			);
			if (idx >= 0 && flags[idx]) return true;
		}
		const def = node.symbol.definition;
		return (
			def?.kind === 'def' &&
			def.start >= fnNode.start &&
			def.end <= fnNode.end &&
			ownableExpr(def.value)
		);
	}

	function returnPathOwned(node: Node, fnNode: NodeMap['fn']): boolean {
		if (node.kind === 'next')
			return node.children?.[0]
				? returnPathOwned(node.children[0], fnNode)
				: false;
		if (node.kind === 'string') return true;
		if (isFreeableScalar(inferType(node))) return true;
		if (node.kind === '?')
			return node.children[2]
				? returnPathOwned(node.children[1], fnNode) &&
						returnPathOwned(node.children[2], fnNode)
				: false;
		if (node.kind === 'ident') return returnIdentOwned(node, fnNode);
		// `set(b, i, x)` returns its buffer arg unchanged — the return owns a
		// value iff that buffer does (an owned-in param, an owned local, or a
		// fresh block). `transfer` already reports owned via `ownableExpr` below.
		if (node.kind === 'call' && isIntrinsicCallee(node.children[0], 'set')) {
			const argsNode = node.children[1];
			const a0 = argsNode?.kind === ',' ? argsNode.children[0] : argsNode;
			return a0 ? returnPathOwned(a0, fnNode) : false;
		}
		return ownableExpr(node);
	}

	/** Records own their members (embedding moves ownership), so dropping a
	 * record frees its heap members before its block — string pointer words
	 * directly, nested records by recursing at their inline offset (a member
	 * record is embedded by value, never a separate block). The `__trace`
	 * word may point at a captured heap chain; statics no-op in `__free`,
	 * so freeing every candidate word is uniformly safe. */
	// Free the heap elements of a runtime-length collection `[len][cap][elem…]`
	// with a real loop over `[0,len)`. The block itself is freed by the caller.
	// Scalar/all-scalar-record elements own nothing → no loop.
	function emitCollectionElemFrees(
		loadBase: () => void,
		elemType: Type | undefined,
		fn: FuncBuilder,
	) {
		if (!typeOwnsHeap(elemType) || elemType?.kind !== 'type') return;
		const stride = fieldBytes(elemType);
		const base = allocLocal(fn, I32);
		const len = allocLocal(fn, I32);
		const i = allocLocal(fn, I32);
		loadBase();
		fn.body.push(OP_LOCAL_TEE);
		uleb128(base, fn.body);
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(len, fn.body);
		fn.body.push(OP_I32_CONST, 0);
		fn.body.push(OP_LOCAL_SET);
		uleb128(i, fn.body);
		fn.body.push(OP_BLOCK, 0x40);
		fn.blockDepth++;
		fn.body.push(OP_LOOP, 0x40);
		fn.blockDepth++;
		fn.body.push(OP_LOCAL_GET);
		uleb128(i, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(len, fn.body);
		fn.body.push(OP_I32_GE_S);
		fn.body.push(OP_BR_IF, 1);
		const addr = () => {
			fn.body.push(OP_LOCAL_GET);
			uleb128(base, fn.body);
			fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
			fn.body.push(OP_LOCAL_GET);
			uleb128(i, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(stride, fn.body);
			fn.body.push(OP_I32_MUL);
			fn.body.push(OP_I32_ADD);
		};
		if (elemType.family === 'string') {
			addr();
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			emitFixedCall(fn, freeBuilderIdx);
		} else if (elemType.family === 'data' && elemType.elem) {
			const eptr = allocLocal(fn, I32);
			addr();
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(eptr, fn.body);
			const loadEptr = () => {
				fn.body.push(OP_LOCAL_GET);
				uleb128(eptr, fn.body);
			};
			emitCollectionElemFrees(loadEptr, elemType.elem, fn);
			loadEptr();
			emitFixedCall(fn, freeBuilderIdx);
		} else {
			emitDataMemberFrees(addr, elemType, fn);
		}
		fn.body.push(OP_LOCAL_GET);
		uleb128(i, fn.body);
		fn.body.push(OP_I32_CONST, 1, OP_I32_ADD);
		fn.body.push(OP_LOCAL_SET);
		uleb128(i, fn.body);
		fn.body.push(OP_BR, 0);
		fn.body.push(OP_END);
		fn.blockDepth--;
		fn.body.push(OP_END);
		fn.blockDepth--;
	}

	// Free one record member at `off`: a string/`__trace` pointer word directly,
	// a collection member by freeing its elements then its block, a nested
	// record by recursing inline. Scalars own nothing.
	function freeMemberAt(
		loadPtr: () => void,
		key: string,
		mt: Type | undefined,
		off: number,
		fn: FuncBuilder,
		visiting: Set<Type>,
	): void {
		if (key === '__trace' || (mt?.kind === 'type' && mt.family === 'string')) {
			loadPtr();
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(off, fn.body);
			emitFixedCall(fn, freeBuilderIdx);
			return;
		}
		if (mt?.kind !== 'type' || mt.family !== 'data') return;
		if (!mt.elem) return emitDataMemberFrees(loadPtr, mt, fn, off, visiting);
		const eptr = allocLocal(fn, I32);
		loadPtr();
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(off, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(eptr, fn.body);
		const loadEptr = () => {
			fn.body.push(OP_LOCAL_GET);
			uleb128(eptr, fn.body);
		};
		emitCollectionElemFrees(loadEptr, mt.elem, fn);
		loadEptr();
		emitFixedCall(fn, freeBuilderIdx);
	}

	function emitDataMemberFrees(
		loadPtr: () => void,
		t: Type | undefined,
		fn: FuncBuilder,
		base = 0,
		visiting: Set<Type> = new Set(),
	) {
		if (!t || t.kind !== 'type' || t.family !== 'data') return;
		if (t.elem) {
			// A runtime-length collection: free its elements (the caller frees
			// the block). Collections are pointer-referenced, never inline.
			emitCollectionElemFrees(loadPtr, t.elem, fn);
			return;
		}
		if (visiting.has(t)) return;
		visiting.add(t);
		const layout = fieldLayout(t.members);
		for (let i = 0; i < layout.keys.length; i++) {
			const key = layout.keys[i];
			if (!key) continue;
			const off = base + (layout.offs[i] ?? 0);
			freeMemberAt(loadPtr, key, t.members[key]?.type, off, fn, visiting);
		}
		visiting.delete(t);
	}

	function emitOwnedFrees(fn: FuncBuilder, from = 0) {
		if (!fn.owned) return;
		for (const o of fn.owned.slice(from)) {
			const u = o.type;
			if (
				o.tagIdx !== undefined &&
				u &&
				u.kind === 'type' &&
				u.family === 'union'
			) {
				// Free only when the live member is heap-typed; scalars in
				// the payload slot are numbers, not pointers.
				const wide = unionPayloadWasm(u) === I64;
				const loadPay = () => {
					fn.body.push(OP_LOCAL_GET);
					uleb128(o.localIdx, fn.body);
					if (wide) fn.body.push(OP_I32_WRAP_I64);
				};
				for (const m of u.members) {
					if (
						m.kind !== 'type' ||
						(m.family !== 'string' && m.family !== 'data')
					)
						continue;
					fn.body.push(OP_LOCAL_GET);
					uleb128(o.tagIdx, fn.body);
					emitTagConst(memberTag(m), memberKey(m), fn);
					fn.body.push(OP_I32_EQ);
					fn.body.push(OP_IF, 0x40);
					emitDataMemberFrees(loadPay, m, fn);
					loadPay();
					emitFixedCall(fn, freeBuilderIdx);
					fn.body.push(OP_END);
				}
				continue;
			}
			const loadPay = () => {
				fn.body.push(OP_LOCAL_GET);
				uleb128(o.localIdx, fn.body);
			};
			emitDataMemberFrees(loadPay, o.type, fn);
			loadPay();
			emitFixedCall(fn, freeBuilderIdx);
		}
	}

	function compileNext(node: NodeMap['next'], fn: FuncBuilder): Type {
		const val = node.children?.[0];
		releaseOwned(fn, val);
		if (fn.fusion) {
			if (!val) return BaseTypes.Void;
			if (tryInlineEmitCall(val, fn)) return BaseTypes.Void;
			const t = compileExpr(val, fn);
			if (
				hasRuntimeValue(t)
			)
				emitToFusion(val, t, fn);
			return BaseTypes.Void;
		}
		if (val) return compileExpr(val, fn);
		return BaseTypes.Void;
	}

	/** Push one emission through the fusion; a fresh heap value that the
	 * chain fully consumed (scalar/void drive result — no stage forwarded
	 * the pointer) is freed right after, so fused loops run flat. */
	function emitToFusion(val: Node, t: Type, fn: FuncBuilder) {
		const fusion = fn.fusion;
		if (!fusion) return;
		let tmp: number | undefined;
		if (
			t.kind === 'type' &&
			(t.family === 'string' || t.family === 'data') &&
			ownableExpr(val, fn)
		) {
			tmp = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(tmp, fn.body);
		}
		const rt = fusion.emit(t);
		const idx = tmp;
		if (idx === undefined || rt === undefined || !scalarOrVoidReturn(rt))
			return;
		const loadTmp = () => {
			fn.body.push(OP_LOCAL_GET);
			uleb128(idx, fn.body);
		};
		emitDataMemberFrees(loadTmp, t, fn);
		loadTmp();
		emitFixedCall(fn, freeBuilderIdx);
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

	function bitwiseOpcode(
		kind: '|' | '&' | '^' | '<:' | ':>',
		useWide: boolean,
	): number {
		if (useWide)
			return kind === '|'
				? OP_I64_OR
				: kind === '&'
					? OP_I64_AND
					: kind === '^'
						? OP_I64_XOR
						: kind === '<:'
							? OP_I64_SHL
							: OP_I64_SHR_S;
		return kind === '|'
			? OP_I32_OR
			: kind === '&'
				? OP_I32_AND
				: kind === '^'
					? OP_I32_XOR
					: kind === '<:'
						? OP_I32_SHL
						: OP_I32_SHR_S;
	}

	function compileBitwise(
		node: NodeMap['|' | '&' | '^' | '<:' | ':>'],
		fn: FuncBuilder,
	): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		const useWide =
			isInt64Type(inferType(lhs, fn)) || isInt64Type(inferType(rhs, fn));
		const actualLt = compileExpr(lhs, fn);
		if (useWide) coerceToInt64(actualLt, fn);
		const actualRt = compileExpr(rhs, fn);
		if (useWide) coerceToInt64(actualRt, fn);
		fn.body.push(bitwiseOpcode(node.kind, useWide));
		return useWide ? BaseTypes.Int64 : BaseTypes.Int32;
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
		if (node.kind === 'number' && !node.float && typeof node.value === 'number')
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
			if (fn.fusion && hasRuntimeValue(t)) fn.fusion.emit(t);
			else if (hasRuntimeValue(t)) fn.body.push(OP_DROP);
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
		const savedPipeValue = fn.pipeValue;
		fn.pipeValue = true;
		try {
			return compileTernaryValue(
				thenBranch,
				elseBranch,
				effective,
				isBottom,
				fn,
			);
		} finally {
			fn.pipeValue = savedPipeValue;
		}
	}

	function compileTernaryValue(
		thenBranch: Node,
		elseBranch: Node,
		effective: Type,
		isBottom: (n: Node) => boolean,
		fn: FuncBuilder,
	): Type {
		if (isUnionType(effective)) {
			const payloadLocal = allocLocal(fn, unionPayloadWasm(effective));
			const tagLocal = allocLocal(fn, I32);
			const emitBranch = (branch: Node) => {
				const t = compileExpr(branch, fn);
				if (isBottom(branch)) return;
				if (!isUnionType(t)) coerceToUnion(t, effective, fn);
				fn.body.push(OP_LOCAL_SET);
				uleb128(tagLocal, fn.body);
				fn.body.push(OP_LOCAL_SET);
				uleb128(payloadLocal, fn.body);
			};
			fn.body.push(0x40);
			fn.blockDepth++;
			emitBranch(thenBranch);
			fn.body.push(OP_ELSE);
			emitBranch(elseBranch);
			fn.body.push(OP_END);
			fn.blockDepth--;
			fn.body.push(OP_LOCAL_GET);
			uleb128(payloadLocal, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(tagLocal, fn.body);
			return effective;
		}
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
				coerceIntWidth(rt, sym.type, fn);
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				return BaseTypes.Void;
			}
			const gIdx = globalIdx.get(sym);
			if (gIdx !== undefined) {
				const gt = globalType.get(sym) ?? rt;
				if (isFloatType(gt) && !isFloatType(rt))
					coerceToFloat(rt, fn);
				else coerceIntWidth(rt, gt, fn);
				fn.body.push(OP_GLOBAL_SET);
				emitGlobalIdx(gIdx, sym, fn);
				return BaseTypes.Void;
			}
		}
		throw new Error(`Cannot assign to "${sym.name ?? '?'}" (not bound)`);
	}

	function compileExpr(node: Node, fn: FuncBuilder): Type {
		switch (node.kind) {
			case 'import':
				return BaseTypes.Void;
			case 'string':
				return compileString(node, fn);
			case 'interp':
				return compileInterp(node, fn);
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
					// Frees for owned locals registered so far; later defs'
					// locals are still zero, and __free(0) no-ops (static
					// guard), so the early return leaks nothing.
					emitOwnedFrees(fn);
					fn.body.push(OP_RETURN);
				}
				return BaseTypes.Void;
			}
			case '+':
			case '-':
			case '*':
			case '/':
			case '%':
				return compileArith(node, fn);
			case 'negate':
				return compileNegate(node, fn);
			case '!': {
				compileExpr(node.children[0], fn);
				fn.body.push(OP_I32_EQZ);
				return BaseTypes.Bool;
			}
			case '~': {
				const at = compileExpr(node.children[0], fn);
				if (isInt64Type(at)) {
					fn.body.push(OP_I64_CONST);
					sleb128(-1, fn.body);
					fn.body.push(OP_I64_XOR);
					return BaseTypes.Int64;
				}
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

	function arithOpcode(
		kind: '+' | '-' | '*' | '/' | '%',
		useFloat: boolean,
		useWide: boolean,
		unsigned = false,
	): number {
		if (useFloat)
			return kind === '+'
				? OP_F64_ADD
				: kind === '-'
					? OP_F64_SUB
					: kind === '*'
						? OP_F64_MUL
						: OP_F64_DIV;
		if (useWide)
			return kind === '+'
				? OP_I64_ADD
				: kind === '-'
					? OP_I64_SUB
					: kind === '*'
						? OP_I64_MUL
						: kind === '%'
							? unsigned
								? OP_I64_REM_U
								: OP_I64_REM_S
							: unsigned
								? OP_I64_DIV_U
								: OP_I64_DIV_S;
		return kind === '+'
			? OP_I32_ADD
			: kind === '-'
				? OP_I32_SUB
				: kind === '*'
					? OP_I32_MUL
					: kind === '%'
						? unsigned
							? OP_I32_REM_U
							: OP_I32_REM_S
						: unsigned
							? OP_I32_DIV_U
							: OP_I32_DIV_S;
	}

	// Integer `/`/`%` by a divisor not known non-zero returns
	// `Int | DivByZero` — emit a zero-check that builds the tagged error value
	// instead of letting `div_s`/`rem_s` trap. Returns undefined (caller falls
	// through to a plain op) when the checked form doesn't apply.
	function compileCheckedDivMod(
		node: NodeMap['/'] | NodeMap['%'],
		fn: FuncBuilder,
		useFloat: boolean,
		useWide: boolean,
		intType: Type,
		payWasm: number,
	): Type | undefined {
		const rhs = node.children[1];
		const dz = divByZeroType;
		if (useFloat || !dz || (rhs.kind === 'number' && rhs.value !== 0))
			return undefined;
		if (nominalId(dz) === undefined) return undefined;
		const lhs = node.children[0];
		const divUnion = unionOfTypes(intType, dz);
		const errTag = unionTagOf(divUnion, dz);
		const okTag = unionTagOf(divUnion, intType);
		const at = compileExpr(lhs, fn);
		if (useWide) coerceToInt64(at, fn);
		const dividendLocal = allocLocal(fn, payWasm);
		fn.body.push(OP_LOCAL_SET);
		uleb128(dividendLocal, fn.body);
		const bt = compileExpr(rhs, fn);
		if (useWide) coerceToInt64(bt, fn);
		const divLocal = allocLocal(fn, payWasm);
		fn.body.push(OP_LOCAL_SET);
		uleb128(divLocal, fn.body);
		const payloadLocal = allocLocal(fn, payWasm);
		const tagLocal = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_GET);
		uleb128(divLocal, fn.body);
		fn.body.push(useWide ? OP_I64_EQZ : OP_I32_EQZ);
		fn.body.push(OP_IF);
		fn.body.push(0x40);
		fn.blockDepth++;
		const dzFrame = staticFramePtr(
			dz.name ?? 'DivByZero',
			fn.name ?? 'main',
			node.line + 1,
			sourceFileOf(node),
		);
		if (debugBuild) {
			const boxLocal = allocLocal(fn, I32);
			fn.body.push(OP_I32_CONST, 4);
			emitFixedCall(fn, allocBuilderIdx);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(boxLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(dzFrame, fn.body);
			emitFixedCall(fn, captureBuilderIdx);
			fn.body.push(OP_I32_STORE);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(boxLocal, fn.body);
			if (useWide) fn.body.push(OP_I64_EXTEND_I32_U);
		} else {
			relocTaint(fn);
			fn.body.push(useWide ? OP_I64_CONST : OP_I32_CONST);
			sleb128(internWords([dzFrame]), fn.body);
		}
		fn.body.push(OP_LOCAL_SET);
		uleb128(payloadLocal, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(errTag, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(tagLocal, fn.body);
		fn.body.push(OP_ELSE);
		fn.body.push(OP_LOCAL_GET);
		uleb128(dividendLocal, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(divLocal, fn.body);
		fn.body.push(
			arithOpcode(
				node.kind,
				false,
				useWide,
				isUintType(inferType(node.children[0], fn)) ||
					isUintType(inferType(node.children[1], fn)),
			),
		);
		fn.body.push(OP_LOCAL_SET);
		uleb128(payloadLocal, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(okTag, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(tagLocal, fn.body);
		fn.body.push(OP_END);
		fn.blockDepth--;
		fn.body.push(OP_LOCAL_GET);
		uleb128(payloadLocal, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(tagLocal, fn.body);
		return divUnion;
	}

	function compileArith(
		node:
			| NodeMap['+']
			| NodeMap['-']
			| NodeMap['*']
			| NodeMap['/']
			| NodeMap['%'],
		fn: FuncBuilder,
	): Type {
		const lhs = node.children[0];
		const rhs = node.children[1];
		const lt = inferType(lhs, fn);
		const rt = inferType(rhs, fn);
		const useFloat = isFloatType(lt) || isFloatType(rt);
		const useWide = !useFloat && (isInt64Type(lt) || isInt64Type(rt));
		const intType =
			(!useFloat ? numericResultType(lt, rt) : undefined) ??
			(useWide ? BaseTypes.Int64 : BaseTypes.Int32);
		const payWasm = useWide ? I64 : I32;

		// Integer division by a divisor that isn't a known non-zero literal
		// returns `Int | DivByZero` — emit a zero-check that builds the tagged
		// error value instead of letting `div_s`/`rem_s` trap.
		if (node.kind === '/' || node.kind === '%') {
			const checked = compileCheckedDivMod(
				node,
				fn,
				useFloat,
				useWide,
				intType,
				payWasm,
			);
			if (checked) return checked;
		}

		const actualLt = compileExpr(lhs, fn);
		if (useFloat && !isFloatType(actualLt)) coerceToFloat(actualLt, fn);
		else if (useWide) coerceToInt64(actualLt, fn);
		const actualRt = compileExpr(rhs, fn);
		if (useFloat && !isFloatType(actualRt)) coerceToFloat(actualRt, fn);
		else if (useWide) coerceToInt64(actualRt, fn);

		if (useFloat) {
			fn.body.push(arithOpcode(node.kind, true, false));
			return BaseTypes.Float64;
		}
		if (!isIntType(actualLt) || !isIntType(actualRt))
			throw new Error(
				`Operator "${node.kind}" requires numeric operands`,
			);
		fn.body.push(arithOpcode(node.kind, false, useWide, isUintType(lt) || isUintType(rt)));
		return intType;
	}

	type CompareKind = '==' | '!=' | '<' | '>' | '<=' | '>=';
	function floatCompareOp(kind: CompareKind): number {
		return kind === '=='
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
	}
	function wideCompareOp(kind: CompareKind, unsigned: boolean): number {
		return kind === '=='
			? OP_I64_EQ
			: kind === '!='
				? OP_I64_NE
				: kind === '<'
					? unsigned ? OP_I64_LT_U : OP_I64_LT_S
					: kind === '>'
						? unsigned ? OP_I64_GT_U : OP_I64_GT_S
						: kind === '<='
							? unsigned ? OP_I64_LE_U : OP_I64_LE_S
							: unsigned ? OP_I64_GE_U : OP_I64_GE_S;
	}
	function intCompareOp(kind: CompareKind, unsigned: boolean): number {
		return kind === '=='
			? OP_I32_EQ
			: kind === '!='
				? OP_I32_NE
				: kind === '<'
					? unsigned ? OP_I32_LT_U : OP_I32_LT_S
					: kind === '>'
						? unsigned ? OP_I32_GT_U : OP_I32_GT_S
						: kind === '<='
							? unsigned ? OP_I32_LE_U : OP_I32_LE_S
							: unsigned ? OP_I32_GE_U : OP_I32_GE_S;
	}
	function compareOpcode(
		kind: CompareKind,
		useFloat: boolean,
		useWide: boolean,
		unsigned = false,
	): number {
		if (useFloat) return floatCompareOp(kind);
		if (useWide) return wideCompareOp(kind, unsigned);
		return intCompareOp(kind, unsigned);
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
		const useWide = !useFloat && (isInt64Type(lt) || isInt64Type(rt));

		const actualLt = compileExpr(lhs, fn);
		if (useFloat && !isFloatType(actualLt)) coerceToFloat(actualLt, fn);
		else if (useWide) coerceToInt64(actualLt, fn);
		const actualRt = compileExpr(rhs, fn);
		if (useFloat && !isFloatType(actualRt)) coerceToFloat(actualRt, fn);
		else if (useWide) coerceToInt64(actualRt, fn);

		if (
			(kind === '==' || kind === '!=') &&
			isStringType(actualLt) &&
			isStringType(actualRt)
		) {
			emitFixedCall(fn, streqBuilderIdx);
			if (kind === '!=') fn.body.push(OP_I32_EQZ);
			return BaseTypes.Bool;
		}

		if (useFloat) {
			fn.body.push(compareOpcode(kind, true, false));
			return BaseTypes.Bool;
		}
		fn.body.push(compareOpcode(kind, false, useWide, isUintType(lt) || isUintType(rt)));
		return BaseTypes.Bool;
	}

	function emitHeaderLength(args: Node, fn: FuncBuilder): Type {
		// Runtime-length collection: the count is the header word.
		compileExpr(args, fn);
		if (ownableExpr(args, fn)) {
			const scratch = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(scratch, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			emitLoadLocal(scratch, fn);
			emitFixedCall(fn, freeBuilderIdx);
			return BaseTypes.Int32;
		}
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	function compileLength(args: Node | undefined, fn: FuncBuilder): Type {
		if (!args) throw new Error('length() requires an argument');
		const argType = inferType(args, fn);
		if (argType.kind === 'type' && argType.family === 'data' && argType.elem)
			return emitHeaderLength(args, fn);
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
		return emitHeaderLength(args, fn);
	}

	function compileDropped(node: Node, fn: FuncBuilder) {
		const t = compileExpr(node, fn);
		if (hasRuntimeValue(t)) {
			fn.body.push(OP_DROP);
			if (isUnionType(t)) fn.body.push(OP_DROP);
		}
	}

	function compileTraceIntrinsic(
		name: string,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const argList = args
			? args.kind === ','
				? args.children
				: [args]
			: [];
		const errArg = argList[0];
		if (!errArg) throw new Error(`${name}() requires an argument`);
		const at = inferType(errArg, fn);
		let off = 0;
		if (at.kind === 'type' && at.family === 'data' && at.members['__trace']) {
			const l = fieldLayout(at.members);
			const idx = l.keys.indexOf('__trace');
			off = idx >= 0 ? (l.offs[idx] ?? 0) : 0;
		}
		compileExpr(errArg, fn);
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(off, fn.body);
		// Handle on the stack: below heapStart it IS the (static) origin
		// frame; above, it points at a captured chain [count][origin][…].
		if (!debugBuild) {
			if (name === 'frames') {
				fn.body.push(OP_DROP);
				fn.body.push(OP_I32_CONST, 1);
				return BaseTypes.Int32;
			}
			if (name === 'frameAt' && argList[1]) compileDropped(argList[1], fn);
			return frameType ?? BaseTypes.Unknown;
		}
		const h = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(h, fn.body);
		if (name === 'frames') {
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_GLOBAL_GET);
			uleb128(shadowLimitIdx, fn.body);
			fn.body.push(0x49, OP_IF, I32); // i32.lt_u
			fn.body.push(OP_I32_CONST, 1);
			fn.body.push(OP_ELSE);
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_END);
			return BaseTypes.Int32;
		}
		if (name === 'frameAt') {
			const iArg = argList[1];
			if (!iArg) throw new Error('frameAt() requires an index');
			const iL = allocLocal(fn, I32);
			compileExpr(iArg, fn);
			fn.body.push(OP_LOCAL_SET);
			uleb128(iL, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_GLOBAL_GET);
			uleb128(shadowLimitIdx, fn.body);
			fn.body.push(0x49, OP_IF, I32);
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_ELSE);
			fn.body.push(OP_LOCAL_GET);
			uleb128(iL, fn.body);
			fn.body.push(OP_I32_EQZ, OP_IF, I32);
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(4, fn.body);
			fn.body.push(OP_ELSE);
			// entries at +8, outermost-first; logical i (innermost-first)
			// -> physical count-1-i.
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(h, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_I32_CONST, 1, OP_I32_SUB);
			fn.body.push(OP_LOCAL_GET);
			uleb128(iL, fn.body);
			fn.body.push(OP_I32_SUB);
			fn.body.push(OP_I32_CONST, 2, OP_I32_SHL);
			fn.body.push(OP_I32_ADD);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(8, fn.body);
			fn.body.push(OP_END);
			fn.body.push(OP_END);
			return frameType ?? BaseTypes.Unknown;
		}
		// origin
		fn.body.push(OP_LOCAL_GET);
		uleb128(h, fn.body);
		fn.body.push(OP_GLOBAL_GET);
		uleb128(shadowLimitIdx, fn.body);
		fn.body.push(0x49, OP_IF, I32);
		fn.body.push(OP_LOCAL_GET);
		uleb128(h, fn.body);
		fn.body.push(OP_ELSE);
		fn.body.push(OP_LOCAL_GET);
		uleb128(h, fn.body);
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		fn.body.push(OP_END);
		return frameType ?? BaseTypes.Unknown;
	}

	function compileStackIntrinsic(
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		// runtime.stack(e): materialize the trace as [len][cap][frame…] —
		// each frame's 16 bytes copied inline, so the result is an
		// ordinary record collection (each/length/member access work).
		if (!args) throw new Error('stack() requires an argument');
		const at = inferType(args, fn);
		let off = 0;
		if (at.kind === 'type' && at.family === 'data' && at.members['__trace']) {
			const l = fieldLayout(at.members);
			const idx = l.keys.indexOf('__trace');
			off = idx >= 0 ? (l.offs[idx] ?? 0) : 0;
		}
		const fSize =
			frameType?.kind === 'type' && frameType.family === 'data'
				? fieldLayout(frameType.members).total
				: 16;
		compileExpr(args, fn);
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(off, fn.body);
		const h = allocLocal(fn, I32);
		const b = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(h, fn.body);
		const emitSingle = () => {
				fn.body.push(OP_I32_CONST);
				sleb128(8 + fSize, fn.body);
				emitFixedCall(fn, allocBuilderIdx);
				fn.body.push(OP_LOCAL_SET);
				uleb128(b, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_I32_CONST, 1);
				fn.body.push(OP_I32_STORE);
				uleb128(2, fn.body);
				uleb128(0, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_I32_CONST, 1);
				fn.body.push(OP_I32_STORE);
				uleb128(2, fn.body);
				uleb128(4, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
				fn.body.push(OP_LOCAL_GET);
				uleb128(h, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(fSize, fn.body);
				fn.body.push(0xfc, 0x0a, 0x00, 0x00);
			};
			if (!debugBuild) {
				emitSingle();
			} else {
				const t = allocLocal(fn, I32);
				const i = allocLocal(fn, I32);
				fn.body.push(OP_LOCAL_GET);
				uleb128(h, fn.body);
				fn.body.push(OP_GLOBAL_GET);
				uleb128(shadowLimitIdx, fn.body);
				fn.body.push(0x49, OP_IF, 0x40); // i32.lt_u: static handle
				emitSingle();
				fn.body.push(OP_ELSE);
				fn.body.push(OP_LOCAL_GET);
				uleb128(h, fn.body);
				fn.body.push(OP_I32_LOAD);
				uleb128(2, fn.body);
				uleb128(0, fn.body);
				fn.body.push(OP_LOCAL_SET);
				uleb128(t, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(t, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(fSize, fn.body);
				fn.body.push(OP_I32_MUL);
				fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
				emitFixedCall(fn, allocBuilderIdx);
				fn.body.push(OP_LOCAL_SET);
				uleb128(b, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(t, fn.body);
				fn.body.push(OP_I32_STORE);
				uleb128(2, fn.body);
				uleb128(0, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(t, fn.body);
				fn.body.push(OP_I32_STORE);
				uleb128(2, fn.body);
				uleb128(4, fn.body);
				// frame 0 = origin (pointer at h+4)
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
				fn.body.push(OP_LOCAL_GET);
				uleb128(h, fn.body);
				fn.body.push(OP_I32_LOAD);
				uleb128(2, fn.body);
				uleb128(4, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(fSize, fn.body);
				fn.body.push(0xfc, 0x0a, 0x00, 0x00);
				// frames 1..t-1: entries at h+8, outermost-first — logical i
				// (innermost-first) reads physical t-1-i.
				fn.body.push(OP_I32_CONST, 1);
				fn.body.push(OP_LOCAL_SET);
				uleb128(i, fn.body);
				fn.body.push(OP_BLOCK, 0x40);
				fn.body.push(OP_LOOP, 0x40);
				fn.body.push(OP_LOCAL_GET);
				uleb128(i, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(t, fn.body);
				fn.body.push(OP_I32_GE_S);
				fn.body.push(OP_BR_IF, 1);
				fn.body.push(OP_LOCAL_GET);
				uleb128(b, fn.body);
				fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
				fn.body.push(OP_LOCAL_GET);
				uleb128(i, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(fSize, fn.body);
				fn.body.push(OP_I32_MUL);
				fn.body.push(OP_I32_ADD);
				fn.body.push(OP_LOCAL_GET);
				uleb128(h, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(t, fn.body);
				fn.body.push(OP_I32_CONST, 1, OP_I32_SUB);
				fn.body.push(OP_LOCAL_GET);
				uleb128(i, fn.body);
				fn.body.push(OP_I32_SUB);
				fn.body.push(OP_I32_CONST, 2, OP_I32_SHL);
				fn.body.push(OP_I32_ADD);
				fn.body.push(OP_I32_LOAD);
				uleb128(2, fn.body);
				uleb128(8, fn.body);
				fn.body.push(OP_I32_CONST);
				sleb128(fSize, fn.body);
				fn.body.push(0xfc, 0x0a, 0x00, 0x00);
				fn.body.push(OP_LOCAL_GET);
				uleb128(i, fn.body);
				fn.body.push(OP_I32_CONST, 1, OP_I32_ADD);
				fn.body.push(OP_LOCAL_SET);
				uleb128(i, fn.body);
				fn.body.push(OP_BR, 0);
				fn.body.push(OP_END);
				fn.body.push(OP_END);
				fn.body.push(OP_END);
			}
		fn.body.push(OP_LOCAL_GET);
		uleb128(b, fn.body);
		return StackIntrinsic.returnType ?? BaseTypes.Unknown;
	}

	function compileIntrinsic(
		name: string,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		if (name === 'length') return compileLength(args, fn);
		if (name === 'get') return compileBufferGet(args, fn);
		if (name === 'set') return compileBufferSet(args, fn);
		if (name === 'capacity') return compileBufferCap(args, fn);
		if (name === 'transfer') return compileBufferTransfer(args, fn);
		if (name === 'origin' || name === 'frames' || name === 'frameAt')
			return compileTraceIntrinsic(name, args, fn);
		if (name === 'stack') return compileStackIntrinsic(args, fn);
		if (name === 'out_buffer') {
			if (!args) throw new Error('out_buffer() requires an argument');
			compileExpr(args, fn);
			const buf = allocLocal(fn, I32);
			emitStoreLocal(buf, fn);
			emitLoadLocal(buf, fn);
			emitConst(8, fn);
			fn.body.push(OP_I32_ADD);
			emitLoadLocal(buf, fn);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			const idx = importHost('out_buffer', [I32, I32], []);
			fn.body.push(OP_CALL);
			uleb128(idx, fn.body);
			if (ownableExpr(args, fn)) {
				emitLoadLocal(buf, fn);
				emitFixedCall(fn, freeBuilderIdx);
			}
			return BaseTypes.Void;
		}
		throw new Error(`Unknown intrinsic: "${name}"`);
	}

	function compileScalarCtor(
		target: SymbolMap['type'],
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		if (!args) throw new Error(`${target.name}() requires an argument`);
		const t = compileExpr(args, fn);
		if (target.family === 'float') {
			if (!isFloatType(t)) coerceToFloat(t, fn);
			return target;
		}
		if (target.size === 8) {
			if (isFloatType(t))
				fn.body.push(
					target.family === 'uint'
						? OP_I64_TRUNC_F64_U
						: OP_I64_TRUNC_F64_S,
				);
			else if (gbcToWasm(t) === I32)
				fn.body.push(
					target.family === 'uint'
						? OP_I64_EXTEND_I32_U
						: OP_I64_EXTEND_I32_S,
				);
			return target;
		}
		if (isFloatType(t)) fn.body.push(0xaa);
		else if (gbcToWasm(t) === I64) fn.body.push(OP_I32_WRAP_I64);
		if (target.family === 'uint') {
			if (target.size === 1 || target.size === 2) {
				fn.body.push(OP_I32_CONST);
				sleb128(target.size === 1 ? 0xff : 0xffff, fn.body);
				fn.body.push(OP_I32_AND);
			}
		} else if (target.size === 1 || target.size === 2) {
			const bits = target.size === 1 ? 24 : 16;
			fn.body.push(OP_I32_CONST);
			sleb128(bits, fn.body);
			fn.body.push(0x74);
			fn.body.push(OP_I32_CONST);
			sleb128(bits, fn.body);
			fn.body.push(0x75);
		}
		return target;
	}

	function emitLoadLocal(local: number, fn: FuncBuilder) {
		fn.body.push(OP_LOCAL_GET);
		uleb128(local, fn.body);
	}

	function emitStoreLocal(local: number, fn: FuncBuilder) {
		fn.body.push(OP_LOCAL_SET);
		uleb128(local, fn.body);
	}

	function emitConst(value: number, fn: FuncBuilder) {
		fn.body.push(OP_I32_CONST);
		sleb128(value, fn.body);
	}

	function dataImm(str: string, fn: FuncBuilder) {
		const offset = intern(str);
		if (fn.relocs) {
			fn.relocs.push({ kind: 'data', offset: fn.body.length, str });
			writeFixed5(offset, fn.body);
		} else sleb128(offset, fn.body);
	}
	function emitDataConst(str: string, fn: FuncBuilder) {
		fn.body.push(OP_I32_CONST);
		dataImm(str, fn);
	}
	function tagImm(tagValue: number, key: string, fn: FuncBuilder) {
		if (fn.relocs) {
			fn.relocs.push({ kind: 'tag', offset: fn.body.length, key });
			writeFixed5(tagValue, fn.body);
		} else sleb128(tagValue, fn.body);
	}
	function emitTagConst(tagValue: number, key: string, fn: FuncBuilder) {
		fn.body.push(OP_I32_CONST);
		tagImm(tagValue, key, fn);
	}
	function emitGlobalIdx(gIdx: number, sym: GbcSymbol, fn: FuncBuilder) {
		if (fn.relocs) {
			fn.relocs.push({ kind: 'global', offset: fn.body.length, sym });
			writeFixed5(gIdx, fn.body);
		} else uleb128(gIdx, fn.body);
	}

	const typeCtorArms = new Map<string, NodeMap['fn'][]>();
	if (root.kind === 'root')
		for (const c of root.children)
			if (c.kind === 'extend') {
				const nm = text(c.children[0]);
				const arms = typeCtorArms.get(nm) ?? [];
				arms.push(c.children[1]);
				typeCtorArms.set(nm, arms);
			}

	// A `extend Type (x: In): Type { … }` arm converts `In` to `Type` — the
	// stdlib's own `Int32`/`Int64`/`Bool` to-text arms use the same mechanism.
	// Exact input match first, then a narrower int widens to a wider int arm
	// (the dispatch rule).
	function findCtorArm(
		typeName: string,
		at: Type,
	): NodeMap['fn'] | undefined {
		const arms = typeCtorArms.get(typeName);
		if (!arms || at.kind !== 'type') return undefined;
		const paramType = (arm: NodeMap['fn']) => {
			const p = arm.parameters?.[0];
			return p?.symbol.type ?? resolveTypeFromNode(p?.type);
		};
		for (const arm of arms) {
			const pt = paramType(arm);
			if (
				pt.kind === 'type' &&
				pt.family === at.family &&
				pt.name === at.name
			)
				return arm;
		}
		for (const arm of arms) {
			const pt = paramType(arm);
			if (isIntType(pt) && isIntType(at) && pt.kind === 'type' && pt.size >= at.size)
				return arm;
		}
		// β composition: a NotFound argument selects the (e: Error) arm.
		for (const arm of arms) {
			const pt = paramType(arm);
			if (pt.kind === 'type' && composes(at, pt)) return arm;
		}
		return undefined;
	}

	function tryUserCtorArm(
		typeName: string,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type | undefined {
		if (!args) return undefined;
		const arm = findCtorArm(typeName, inferType(args, fn));
		return arm ? compileTemplateCall(arm, args, fn) : undefined;
	}

	function compileInterp(node: NodeMap['interp'], fn: FuncBuilder): Type {
		const { strings, children } = node;
		const parts: number[] = [];
		const holeFrees: number[] = [];
		for (let i = 0; i < strings.length; i++) {
			const chunk = strings[i];
			if (chunk) {
				emitDataConst(decodeEscapes(chunk), fn);
				const local = allocLocal(fn, I32);
				emitStoreLocal(local, fn);
				parts.push(local);
			}
			const hole = children[i];
			if (hole) {
				const t = inferType(hole, fn);
				let freeable: boolean;
				if (t.kind === 'type' && t.family === 'string') {
					compileExpr(hole, fn);
					freeable = ownableExpr(hole, fn);
				} else {
					compileStringCtor(hole, fn);
					freeable = ctorAllocsFresh(t);
				}
				const local = allocLocal(fn, I32);
				emitStoreLocal(local, fn);
				parts.push(local);
				if (freeable) holeFrees.push(local);
			}
		}
		const result = emitConcat(parts, fn);
		for (const local of holeFrees) {
			emitLoadLocal(local, fn);
			emitFixedCall(fn, freeBuilderIdx);
		}
		return result;
	}

	function emitConcat(parts: number[], fn: FuncBuilder): Type {
		const total = allocLocal(fn, I32);
		emitConst(0, fn);
		emitStoreLocal(total, fn);
		for (const p of parts) {
			emitLoadLocal(total, fn);
			emitLoadLocal(p, fn);
			emitElemLoad(4, 0, fn);
			fn.body.push(OP_I32_ADD);
			emitStoreLocal(total, fn);
		}
		emitLoadLocal(total, fn);
		emitConst(8, fn);
		fn.body.push(OP_I32_ADD);
		emitFixedCall(fn, allocBuilderIdx);
		const buf = allocLocal(fn, I32);
		emitStoreLocal(buf, fn);
		emitLoadLocal(buf, fn);
		emitLoadLocal(total, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		emitLoadLocal(buf, fn);
		emitConst(1, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		const cur = allocLocal(fn, I32);
		emitLoadLocal(buf, fn);
		emitConst(8, fn);
		fn.body.push(OP_I32_ADD);
		emitStoreLocal(cur, fn);
		for (const p of parts) {
			emitLoadLocal(cur, fn);
			emitLoadLocal(p, fn);
			emitConst(8, fn);
			fn.body.push(OP_I32_ADD);
			emitLoadLocal(p, fn);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(0xfc, 0x0a, 0x00, 0x00);
			emitLoadLocal(cur, fn);
			emitLoadLocal(p, fn);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_I32_ADD);
			emitStoreLocal(cur, fn);
		}
		emitLoadLocal(buf, fn);
		return BaseTypes.String;
	}

	// UTF-8-encode a code point (assumed valid — Char(x) substitutes invalid
	// input with U+FFFD) into a fresh String of 1-4 bytes.
	function emitCharToString(fn: FuncBuilder): Type {
		const cp = allocLocal(fn, I32);
		emitStoreLocal(cp, fn);
		const geAdd = (v: number) => {
			emitLoadLocal(cp, fn);
			emitConst(v, fn);
			fn.body.push(OP_I32_GE_S);
			fn.body.push(OP_I32_ADD);
		};
		const len = allocLocal(fn, I32);
		emitConst(1, fn);
		geAdd(0x80);
		geAdd(0x800);
		geAdd(0x10000);
		emitStoreLocal(len, fn);
		emitLoadLocal(len, fn);
		emitConst(8, fn);
		fn.body.push(OP_I32_ADD);
		emitFixedCall(fn, allocBuilderIdx);
		const buf = allocLocal(fn, I32);
		emitStoreLocal(buf, fn);
		emitLoadLocal(buf, fn);
		emitLoadLocal(len, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		emitLoadLocal(buf, fn);
		emitConst(1, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		const shifted = (sh: number) => {
			emitLoadLocal(cp, fn);
			if (sh) {
				emitConst(sh, fn);
				fn.body.push(OP_I32_SHR_S);
			}
		};
		const lead = (sh: number, prefix: number) => {
			shifted(sh);
			emitConst(prefix, fn);
			fn.body.push(OP_I32_OR);
		};
		const cont = (sh: number) => {
			shifted(sh);
			emitConst(0x3f, fn);
			fn.body.push(OP_I32_AND);
			emitConst(0x80, fn);
			fn.body.push(OP_I32_OR);
		};
		const store8 = (off: number, emitVal: () => void) => {
			emitLoadLocal(buf, fn);
			emitVal();
			fn.body.push(OP_I32_STORE8);
			uleb128(0, fn.body);
			uleb128(off, fn.body);
		};
		const beginIf = (bound: number) => {
			emitLoadLocal(cp, fn);
			emitConst(bound, fn);
			fn.body.push(OP_I32_LT_S);
			fn.body.push(OP_IF);
			fn.body.push(0x40);
			fn.blockDepth++;
		};
		const endIf = () => {
			fn.body.push(OP_END);
			fn.blockDepth--;
		};
		beginIf(0x80);
		store8(8, () => shifted(0));
		fn.body.push(OP_ELSE);
		beginIf(0x800);
		store8(8, () => lead(6, 0xc0));
		store8(9, () => cont(0));
		fn.body.push(OP_ELSE);
		beginIf(0x10000);
		store8(8, () => lead(12, 0xe0));
		store8(9, () => cont(6));
		store8(10, () => cont(0));
		fn.body.push(OP_ELSE);
		store8(8, () => lead(18, 0xf0));
		store8(9, () => cont(12));
		store8(10, () => cont(6));
		store8(11, () => cont(0));
		endIf();
		endIf();
		endIf();
		emitLoadLocal(buf, fn);
		return BaseTypes.String;
	}

	function compileCharCtor(args: Node | undefined, fn: FuncBuilder): Type {
		if (!args) throw new Error('Char() requires a codepoint argument');
		const t = compileExpr(args, fn);
		if (!(t.kind === 'type' && (t.family === 'int' || t.family === 'uint')))
			throw new Error(
				`Char(...) expects an integer codepoint, got ${t.name}`,
			);
		if (t.size === 8) fn.body.push(OP_I32_WRAP_I64);
		if (t.family === 'uint' && t.size === 1) return BaseTypes.Char;
		const cp = allocLocal(fn, I32);
		emitStoreLocal(cp, fn);
		emitConst(0xfffd, fn);
		emitLoadLocal(cp, fn);
		emitLoadLocal(cp, fn);
		emitConst(0, fn);
		fn.body.push(OP_I32_LT_S);
		emitLoadLocal(cp, fn);
		emitConst(0x110000, fn);
		fn.body.push(OP_I32_GE_S);
		fn.body.push(OP_I32_OR);
		emitLoadLocal(cp, fn);
		emitConst(0xd800, fn);
		fn.body.push(OP_I32_GE_S);
		emitLoadLocal(cp, fn);
		emitConst(0xe000, fn);
		fn.body.push(OP_I32_LT_S);
		fn.body.push(OP_I32_AND);
		fn.body.push(OP_I32_OR);
		fn.body.push(OP_SELECT);
		return BaseTypes.Char;
	}

	// String(Float64): allocate a header + digit buffer, let the host `ftoa`
	// format the value into it (host writes UTF-8 at buf+8, returns byte count),
	// then stamp the [len][itemSize] header. Value is on the stack (f64).
	function emitFloatToString(fn: FuncBuilder): Type {
		const f = allocLocal(fn, F64);
		emitStoreLocal(f, fn);
		emitConst(8 + 32, fn);
		emitFixedCall(fn, allocBuilderIdx);
		const buf = allocLocal(fn, I32);
		emitStoreLocal(buf, fn);
		emitLoadLocal(f, fn);
		emitLoadLocal(buf, fn);
		emitConst(8, fn);
		fn.body.push(OP_I32_ADD);
		emitConst(32, fn);
		const idx = importHost('ftoa', [F64, I32, I32], [I32]);
		fn.body.push(OP_CALL);
		uleb128(idx, fn.body);
		const len = allocLocal(fn, I32);
		emitStoreLocal(len, fn);
		emitLoadLocal(buf, fn);
		emitLoadLocal(len, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		emitLoadLocal(buf, fn);
		emitConst(1, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		emitLoadLocal(buf, fn);
		return BaseTypes.String;
	}

	/** A type's default constructor takes its own structural value: a data
	 * block re-brands (zero-op for plain records, trace-injected for errors),
	 * and a field-less error's structure is `[]` = Void, so `T()` constructs
	 * it (the hidden trace is what gives the value runtime existence). */
	function compileDataCtor(
		target: Extract<SymbolMap['type'], { family: 'data' }>,
		args: Node | undefined,
		fn: FuncBuilder,
		node: NodeMap['call'],
	): Type {
		const visible = Object.keys(target.members).filter(
			k => k !== '__trace',
		);
		if (!args) {
			if (visible.length || !isTraceComposed(target))
				throw new Error(
					visible.length
						? `${target.name}(…) requires its structural value: [ ${visible[0]} = … ]`
						: `${target.name} has no fields — its structure is void, and there is no value to construct`,
				);
			return compileErrorCtor(target, fn, node);
		}
		if (args.kind === 'data') {
			stampErrorData(args, target, node.originFn);
			compileExpr(args, fn);
			return target;
		}
		if (isTraceComposed(target))
			throw new Error(
				`${target.name}(…) constructs from a literal block — an existing value has no trace slot`,
			);
		compileExpr(args, fn);
		return target;
	}

	// `Buffer<T>(cap)` → a fresh runtime-length collection `[len=0][cap][elem×cap]`
	// (payload at offset 8). Payload is left uninitialized: `get` and drop-glue
	// are bounded by `len` (which starts 0), so a slot is only ever read/freed
	// after `set` initialized it — the Rust `Vec::with_capacity` model.
	function compileBufferCtor(
		target: SymbolMap['type'],
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const elem = target.family === 'data' ? target.elem : undefined;
		if (!elem)
			throw new Error('Buffer requires a type argument: Buffer<T>(capacity)');
		if (!args)
			throw new Error('Buffer<T>(capacity) requires a capacity');
		const stride = fieldBytes(elem);
		const cap = allocLocal(fn, I32);
		const buf = allocLocal(fn, I32);
		compileExpr(args, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(cap, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(cap, fn.body);
		fn.body.push(OP_I32_CONST, 0, OP_I32_LT_S);
		emitTrapIf(fn);
		fn.body.push(OP_LOCAL_GET);
		uleb128(cap, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(Math.floor((0x7fffffff - 8) / stride), fn.body);
		fn.body.push(OP_I32_GT_S);
		emitTrapIf(fn);
		fn.body.push(OP_I32_CONST);
		sleb128(8, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(cap, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(stride, fn.body);
		fn.body.push(OP_I32_MUL);
		fn.body.push(OP_I32_ADD);
		emitFixedCall(fn, allocBuilderIdx);
		fn.body.push(OP_LOCAL_SET);
		uleb128(buf, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(buf, fn.body);
		fn.body.push(OP_I32_CONST, 0);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(buf, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(cap, fn.body);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(buf, fn.body);
		return bufferTypeOf(elem);
	}

	function bufArgList(args: Node | undefined): Node[] {
		if (!args) return [];
		return args.kind === ',' ? args.children : [args];
	}

	function bufElemOf(bNode: Node, fn: FuncBuilder): Type {
		const bt = inferType(bNode, fn);
		return bt.kind === 'type' && bt.family === 'data' && bt.elem
			? bt.elem
			: BaseTypes.Unknown;
	}

	// `local.get baseLocal; i32.load off` — read a header word (len@0/cap@4).
	function emitHeaderRead(baseLocal: number, off: number, fn: FuncBuilder) {
		fn.body.push(OP_LOCAL_GET);
		uleb128(baseLocal, fn.body);
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(off, fn.body);
	}

	// Address of slot `idx` in buffer `base`: base + 8 + idx*stride.
	function emitSlotAddr(
		base: number,
		idx: number,
		stride: number,
		fn: FuncBuilder,
	) {
		fn.body.push(OP_LOCAL_GET);
		uleb128(base, fn.body);
		fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
		fn.body.push(OP_LOCAL_GET);
		uleb128(idx, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(stride, fn.body);
		fn.body.push(OP_I32_MUL);
		fn.body.push(OP_I32_ADD);
	}

	// Trap when the i32 already on the stack is non-zero (a failed bound).
	function emitTrapIf(fn: FuncBuilder) {
		fn.body.push(OP_IF, 0x40);
		fn.body.push(0x00);
		fn.body.push(OP_END);
	}

	// Free one heap element living at `addr` (a String pointer, a nested buffer
	// pointer, or an inline record's heap members). Scalars own nothing.
	function freeElemAt(addr: () => void, elem: Type, fn: FuncBuilder) {
		if (!typeOwnsHeap(elem) || elem.kind !== 'type') return;
		if (elem.family === 'string') {
			addr();
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			emitFixedCall(fn, freeBuilderIdx);
			return;
		}
		if (elem.family === 'data' && elem.elem) {
			const eptr = allocLocal(fn, I32);
			addr();
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(0, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(eptr, fn.body);
			const loadEptr = () => {
				fn.body.push(OP_LOCAL_GET);
				uleb128(eptr, fn.body);
			};
			emitCollectionElemFrees(loadEptr, elem.elem, fn);
			loadEptr();
			emitFixedCall(fn, freeBuilderIdx);
			return;
		}
		emitDataMemberFrees(addr, elem, fn);
	}

	// `get(b, i): T` — bounds-checked (`i < len`) typed read. Scalar/String
	// elements load by value; record elements yield an interior pointer.
	function compileBufferGet(args: Node | undefined, fn: FuncBuilder): Type {
		const [bNode, iNode] = bufArgList(args);
		if (!bNode || !iNode)
			throw new Error('get(buffer, i) requires two arguments');
		const elem = bufElemOf(bNode, fn);
		const stride = fieldBytes(elem);
		const byValue = !(
			elem.kind === 'type' &&
			elem.family === 'data' &&
			Object.keys(elem.members).length > 0
		);
		const base = allocLocal(fn, I32);
		const idx = allocLocal(fn, I32);
		compileExpr(bNode, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(base, fn.body);
		compileExpr(iNode, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(idx, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(idx, fn.body);
		emitHeaderRead(base, 0, fn);
		fn.body.push(OP_I32_GE_U);
		emitTrapIf(fn);
		emitSlotAddr(base, idx, stride, fn);
		if (byValue) emitFieldLoad(elem, 0, fn);
		return elem;
	}

	// `set(b, i, x): Buffer<T>` — bounds-checked (`i <= len`, `i < cap`) typed
	// write; appending at `i == len` bumps `len`, overwriting frees the old
	// element first. Returns the (same) buffer.
	function compileBufferSet(args: Node | undefined, fn: FuncBuilder): Type {
		const [bNode, iNode, xNode] = bufArgList(args);
		if (!bNode || !iNode || !xNode)
			throw new Error('set(buffer, i, x) requires three arguments');
		const bt = inferType(bNode, fn);
		const elem =
			bt.kind === 'type' && bt.family === 'data' && bt.elem
				? bt.elem
				: BaseTypes.Unknown;
		const stride = fieldBytes(elem);
		const base = allocLocal(fn, I32);
		const idx = allocLocal(fn, I32);
		const addrL = allocLocal(fn, I32);
		compileExpr(bNode, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(base, fn.body);
		compileExpr(iNode, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(idx, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(idx, fn.body);
		emitHeaderRead(base, 0, fn);
		fn.body.push(OP_I32_GT_U);
		emitTrapIf(fn);
		fn.body.push(OP_LOCAL_GET);
		uleb128(idx, fn.body);
		emitHeaderRead(base, 4, fn);
		fn.body.push(OP_I32_GE_U);
		emitTrapIf(fn);
		emitSlotAddr(base, idx, stride, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(addrL, fn.body);
		if (typeOwnsHeap(elem)) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(idx, fn.body);
			emitHeaderRead(base, 0, fn);
			fn.body.push(OP_I32_LT_U);
			fn.body.push(OP_IF, 0x40);
			freeElemAt(
				() => {
					fn.body.push(OP_LOCAL_GET);
					uleb128(addrL, fn.body);
				},
				elem,
				fn,
			);
			fn.body.push(OP_END);
		}
		storeMember(xNode, elem, 0, addrL, fn);
		// Embedding a heap element moves it into the buffer (which now owns it),
		// so release an owned-ident value arg from this frame — the buffer's
		// drop-glue frees it. A fresh temp or scalar arg is a no-op here.
		releaseOwned(fn, xNode);
		fn.body.push(OP_LOCAL_GET);
		uleb128(idx, fn.body);
		emitHeaderRead(base, 0, fn);
		fn.body.push(OP_I32_EQ);
		fn.body.push(OP_IF, 0x40);
		fn.body.push(OP_LOCAL_GET);
		uleb128(base, fn.body);
		emitHeaderRead(base, 0, fn);
		fn.body.push(OP_I32_CONST, 1, OP_I32_ADD);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_END);
		fn.body.push(OP_LOCAL_GET);
		uleb128(base, fn.body);
		return bt;
	}

	// `capacity(b): Int32` — the cap header word (frees a fresh-temp arg).
	function compileBufferCap(args: Node | undefined, fn: FuncBuilder): Type {
		const [bNode] = bufArgList(args);
		if (!bNode) throw new Error('capacity(buffer) requires an argument');
		compileExpr(bNode, fn);
		if (ownableExpr(bNode, fn)) {
			const scratch = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(scratch, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(4, fn.body);
			emitLoadLocal(scratch, fn);
			emitFixedCall(fn, freeBuilderIdx);
			return BaseTypes.Int32;
		}
		fn.body.push(OP_I32_LOAD);
		uleb128(2, fn.body);
		uleb128(4, fn.body);
		return BaseTypes.Int32;
	}

	function compileBufferTransfer(args: Node | undefined, fn: FuncBuilder): Type {
		const [sourceNode, destinationNode] = bufArgList(args);
		if (!sourceNode || !destinationNode)
			throw new Error('transfer requires source and destination buffers');
		const bt = inferType(destinationNode, fn);
		const elem =
			bt.kind === 'type' && bt.family === 'data' && bt.elem
				? bt.elem
				: BaseTypes.Unknown;
		const stride = fieldBytes(elem);
		const source = allocLocal(fn, I32);
		const destination = allocLocal(fn, I32);
		const len = allocLocal(fn, I32);
		compileExpr(sourceNode, fn);
		emitStoreLocal(source, fn);
		compileExpr(destinationNode, fn);
		emitStoreLocal(destination, fn);
		emitLoadLocal(source, fn);
		emitLoadLocal(destination, fn);
		fn.body.push(OP_I32_EQ);
		emitTrapIf(fn);
		emitHeaderRead(destination, 0, fn);
		emitTrapIf(fn);
		emitHeaderRead(source, 0, fn);
		emitStoreLocal(len, fn);
		emitLoadLocal(len, fn);
		emitHeaderRead(destination, 4, fn);
		fn.body.push(OP_I32_GT_U);
		emitTrapIf(fn);
		emitLoadLocal(destination, fn);
		emitLoadLocal(len, fn);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		emitLoadLocal(destination, fn);
		fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
		emitLoadLocal(source, fn);
		fn.body.push(OP_I32_CONST, 8, OP_I32_ADD);
		emitLoadLocal(len, fn);
		fn.body.push(OP_I32_CONST);
		sleb128(stride, fn.body);
		fn.body.push(OP_I32_MUL);
		fn.body.push(0xfc, 0x0a, 0x00, 0x00);
		const sourceOwned =
			sourceNode.kind === 'ident'
				? !!fn.owned?.some(o => o.sym === sourceNode.symbol)
				: ownableExpr(sourceNode, fn);
		if (sourceOwned) {
			emitLoadLocal(source, fn);
			emitFixedCall(fn, freeBuilderIdx);
			releaseOwned(fn, sourceNode);
		}
		releaseOwned(fn, destinationNode);
		emitLoadLocal(destination, fn);
		return bt;
	}

	function compileErrorCtor(
		target: Extract<SymbolMap['type'], { family: 'data' }>,
		fn: FuncBuilder,
		node: NodeMap['call'],
	): Type {
		const layout = fieldLayout(target.members);
		fn.body.push(OP_I32_CONST);
		sleb128(layout.total, fn.body);
		emitFixedCall(fn, allocBuilderIdx);
		const bufLocal = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_TEE);
		uleb128(bufLocal, fn.body);
		relocTaint(fn);
		fn.body.push(OP_I32_CONST);
		sleb128(
			staticFramePtr(
				target.name,
				node.originFn ?? fn.name ?? 'main',
				node.line + 1,
				sourceFileOf(node),
			),
			fn.body,
		);
		if (debugBuild) emitFixedCall(fn, captureBuilderIdx);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(0, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(bufLocal, fn.body);
		return target;
	}

	function compileStringCtor(args: Node | undefined, fn: FuncBuilder): Type {
		if (!args) throw new Error('String() requires an argument');
		const user = tryUserCtorArm('String', args, fn);
		if (user) return user;
		const t = inferType(args, fn);
		if (t.kind === 'type' && t.family === 'char') {
			compileExpr(args, fn);
			return emitCharToString(fn);
		}
		if (
			t.kind === 'type' &&
			(t.family === 'string' ||
				(t.family === 'literal' && typeof t.value === 'string'))
		) {
			compileExpr(args, fn);
			return BaseTypes.String;
		}
		if (t.kind === 'type' && t.family === 'float') {
			compileExpr(args, fn);
			if (t.size === 4) fn.body.push(OP_F64_PROMOTE_F32);
			return emitFloatToString(fn);
		}
		throw new Error(`String(...) cannot convert ${t.name}`);
	}

	function emitFixedCall(fn: FuncBuilder, builderIdx: number, tail = false) {
		const traced = debugBuild && builderIdx > captureBuilderIdx;
		if (traced) {
			const site = builderFramePtr(builderIdx);
			if (tail) emitShadowReplaceTop(fn, site);
			else emitShadowPush(fn, site);
		}
		fn.body.push(tail ? OP_RETURN_CALL : OP_CALL);
		const fixupOffset = fn.body.length;
		for (let i = 0; i < 5; i++) fn.body.push(0);
		fn.callFixups.push({ offset: fixupOffset, builderIdx, size: 5 });
		if (traced && !tail) emitShadowPop(fn);
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

	// An inline fn literal passed as a higher-order argument (`reduce(t, 0, (a,
	// b){ a + b })`) is lifted to a real top-level function — declared and
	// compiled on first use — so it gets a `builderIdx` and binds to the param
	// like a named fn. Untyped params fall back to the Int32 default.
	function liftFnArg(node: Node): SymbolMap['function'] | undefined {
		if (node.kind !== 'fn') return undefined;
		const sym = node.symbol;
		if (!fnDefBuilderIdx.has(sym)) {
			const declared = declareFn(sym, node);
			if (!declared) return undefined;
			compileFnBody(declared.builder, declared.fnNode);
		}
		return sym;
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
			const fa = a ? (resolveFnArg(a) ?? liftFnArg(a)) : undefined;
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

	function resolveStaticMemberFn(callee: Node): SymbolMap['function'] | undefined {
		if (callee.kind !== '.') return undefined;
		const recv = callee.children[0];
		const field = callee.children[1];
		if (recv.kind !== 'ident' || field.kind !== 'ident') return undefined;
		const rt = recv.symbol.type;
		if (!rt || rt.kind !== 'type' || rt.family !== 'data') return undefined;
		const m = rt.members[field.symbol.name ?? ''];
		const mt = m?.type;
		if (mt && mt.kind === 'function') return mt;
		return undefined;
	}

	function compileCall(node: NodeMap['call'], fn: FuncBuilder): Type {
		return compileCallInner(node, fn);
	}

	function compileCallInner(node: NodeMap['call'], fn: FuncBuilder): Type {
		const callee = node.children[0];
		const args = node.children[1];
		if (callee.kind === 'typeident') {
			const target = SCALAR_CTORS[callee.symbol.name ?? ''];
			if (target) return compileScalarCtor(target, args, fn);
			if (callee.symbol.kind === 'type' && callee.symbol.flags & Flags.Collection)
				return compileBufferCtor(callee.symbol, args, fn);
			if (callee.symbol.kind === 'type' && callee.symbol.family === 'string')
				return compileStringCtor(args, fn);
			if (callee.symbol.kind === 'type' && callee.symbol.family === 'char')
				return compileCharCtor(args, fn);
			if (callee.symbol.kind === 'type' && isNumericType(callee.symbol))
				return compileScalarCtor(callee.symbol, args, fn);
			if (
				callee.symbol.kind === 'type' &&
				callee.symbol.family === 'data'
			)
				return compileDataCtor(callee.symbol, args, fn, node);
		}
		if (callee.kind === 'call') {
			const innerFn = returnedFnLiteral(callee);
			if (!innerFn) throw new Error('Indirect call not yet supported');
			const argTypes = collectArgTypes(args, fn);
			const idx = getOrCreateSpec(innerFn, argTypes);
			compileCallArgs(args, innerFn.symbol, fn);
			emitFixedCall(fn, idx);
			return specReturn.get(idx) ?? innerFn.symbol.returnType ?? BaseTypes.Void;
		}
		if (callee.kind === '.') return compileMemberCall(callee, args, fn);
		if (callee.kind !== 'ident')
			throw new Error('Indirect call not yet supported');
		return compileIdentCall(callee.symbol, args, fn);
	}

	function compileMemberCall(
		callee: NodeMap['.'],
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const sfn = resolveStaticMemberFn(callee);
		if (sfn && sfn.flags & Flags.External) {
			if (args) compileCallArgs(args, sfn, fn);
			const sig = fnSignature(sfn);
			const idx = importHost(sfn.name ?? '', sig.params, sig.results);
			fn.body.push(OP_CALL);
			uleb128(idx, fn.body);
			return sfn.returnType ?? BaseTypes.Void;
		}
		if (sfn && sfn.flags & Flags.Intrinsic)
			return compileIntrinsic(sfn.name ?? '', args, fn);
		if (sfn) return compileDirectCall(sfn, args, fn);
		throw new Error('Indirect call not yet supported');
	}

	function compileIdentCall(
		calleeSym: GbcSymbol,
		args: Node | undefined,
		fn: FuncBuilder,
	): Type {
		const bound = fnArgBindings.get(calleeSym);
		if (bound) return compileDirectCall(bound, args, fn);
		if (calleeSym.kind === 'function' && calleeSym.flags & Flags.Intrinsic)
			return compileIntrinsic(calleeSym.name ?? '', args, fn);
		const templateNode = fnTemplates.get(calleeSym);
		if (templateNode) return compileTemplateCall(templateNode, args, fn);
		const disp = tryCompileDispatch(calleeSym, args, fn);
		if (disp) return disp;
		if (calleeSym.kind === 'function' && !!(calleeSym.flags & Flags.External)) {
			if (args) compileCallArgs(args, calleeSym, fn);
			const sig = fnSignature(calleeSym);
			const idx = importHost(calleeSym.name ?? '', sig.params, sig.results);
			fn.body.push(OP_CALL);
			uleb128(idx, fn.body);
			return calleeSym.returnType ?? BaseTypes.Void;
		}
		return compileDirectCall(calleeSym, args, fn);
	}

	function isCatchAllArm(o: SymbolMap['function']): boolean {
		if (o.parameters?.length !== 1) return false;
		// A catch-all template's param symbol type gets mutated by monomorphization,
		// so read the stable node annotation: no `:T` on the sole param.
		const node = fnTemplates.get(o);
		if (node) return !node.parameters?.[0]?.type;
		const p = o.parameters[0]?.type;
		return !p || (p.kind === 'type' && p.family === 'unknown');
	}

	function dispatchArgType(t: Type): Type {
		if (t.kind === 'type' && t.family === 'union') {
			const m = t.members.find(
				x => !(x.kind === 'type' && namedData(x)),
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
		const armMatches = (o: SymbolMap['function'], widen: boolean) => {
			if (isCatchAllArm(o)) return false;
			const ps = o.parameters;
			if (!ps || ps.length !== ats.length) return false;
			return ps.every((p, i) => {
				const pt = p.type;
				const at = ats[i];
				if (
					pt?.kind !== 'type' ||
					pt.family === 'unknown' ||
					at?.kind !== 'type'
				)
					return false;
				if (pt.family === at.family && pt.name === at.name) return true;
				if (composes(at, pt)) return true;
				return (
					widen && isIntType(pt) && isIntType(at) && pt.size >= at.size
				);
			});
		};
		return (
			overloads.find(o => armMatches(o, false)) ??
			overloads.find(o => armMatches(o, true)) ??
			overloads.find(isCatchAllArm)
		);
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

	function slotSizeOf(nominal: Type | undefined, itemTypes: Type[]): number {
		if (nominal || itemTypes.length === 0) return 4;
		if (itemTypes.every(isFloatType)) return 8;
		if (
			itemTypes.every(
				t => t.kind === 'type' && t.family === 'uint' && t.size === 1,
			)
		)
			return 1;
		return 4;
	}

	function stampNominalTrace(
		node: NodeMap['data'],
		nominal: Type,
		nomLayout: ReturnType<typeof fieldLayout>,
		bufLocal: number,
		fn: FuncBuilder,
	) {
		relocTaint(fn);
		const traceIdx = nomLayout.keys.indexOf('__trace');
		fn.body.push(OP_LOCAL_GET);
		uleb128(bufLocal, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(
			staticFramePtr(
				nominal.name ?? '',
				node.originFn ?? fn.name ?? 'main',
				node.line + 1,
				sourceFileOf(node),
			),
			fn.body,
		);
		if (debugBuild) emitFixedCall(fn, captureBuilderIdx);
		fn.body.push(OP_I32_STORE);
		uleb128(2, fn.body);
		uleb128(traceIdx >= 0 ? (nomLayout.offs[traceIdx] ?? 0) : 0, fn.body);
	}

	function storeMember(
		itemNode: Node,
		ft: Type,
		off: number,
		bufLocal: number,
		fn: FuncBuilder,
	) {
		if (isUnionType(ft)) {
			const payWasm = unionPayloadWasm(ft);
			const payBytes = payWasm === I64 ? 8 : 4;
			compileExpr(itemNode, fn);
			const tagTmp = allocLocal(fn, I32);
			const payTmp = allocLocal(fn, payWasm);
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagTmp, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(payTmp, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(bufLocal, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(payTmp, fn.body);
			fn.body.push(payWasm === I64 ? OP_I64_STORE : OP_I32_STORE);
			uleb128(payWasm === I64 ? 3 : 2, fn.body);
			uleb128(off, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(bufLocal, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(tagTmp, fn.body);
			fn.body.push(OP_I32_STORE);
			uleb128(2, fn.body);
			uleb128(off + payBytes, fn.body);
			return;
		}
		if (isInlineData(ft)) {
			// A record member embeds by value — the source block is dead
			// after the copy. Free it (shallow) when this literal owns it:
			// its heap members now live in the inline copy.
			const srcDead =
				ownableExpr(itemNode, fn) ||
				(itemNode.kind === 'ident' &&
					!!fn.owned?.some(o => o.sym === itemNode.symbol));
			compileExpr(itemNode, fn);
			const srcLocal = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_SET);
			uleb128(srcLocal, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(bufLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(off, fn.body);
			fn.body.push(OP_I32_ADD);
			fn.body.push(OP_LOCAL_GET);
			uleb128(srcLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(fieldBytes(ft), fn.body);
			fn.body.push(0xfc, 0x0a, 0x00, 0x00);
			if (srcDead) {
				fn.body.push(OP_LOCAL_GET);
				uleb128(srcLocal, fn.body);
				emitFixedCall(fn, freeBuilderIdx);
			}
			return;
		}
		fn.body.push(OP_LOCAL_GET);
		uleb128(bufLocal, fn.body);
		const t = compileExpr(itemNode, fn);
		if (isFloatType(ft) && !isFloatType(t)) coerceToFloat(t, fn);
		emitFieldStore(ft, off, fn);
	}

	function compileData(node: NodeMap['data'], fn: FuncBuilder): Type {
		const items = dataItems(node).flatMap(flattenDataItem);
		const nominal = isTraceComposed(node.nominal)
			? node.nominal
			: undefined;
		if (items.length === 0) {
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return BaseTypes.Unknown;
		}
		const hasLabels = items.some(
			it => it.kind === 'propdef' && it.label,
		);
		const first = items[0];
		if (items.length === 1 && !hasLabels && first && !nominal) {
			return compileExpr(itemValue(first), fn);
		}
		const itemTypes: Type[] = items.map(it => inferType(itemValue(it), fn));
		const slotSize = slotSizeOf(nominal, itemTypes);
		const nomLayout = nominal
			? fieldLayout(nominal.members)
			: undefined;
		const layout = nomLayout ?? layoutTypes(itemTypes);
		const nomOff = (item: Node, i: number): number => {
			if (!nomLayout) return layout.offs[i] ?? 0;
			const label =
				item.kind === 'propdef' ? item.symbol.name : undefined;
			const idx = label ? nomLayout.keys.indexOf(label) : i + 1;
			return nomLayout.offs[idx >= 0 ? idx : i + 1] ?? 0;
		};
		const totalSize = layout.total;
		fn.body.push(OP_I32_CONST);
		sleb128(totalSize, fn.body);
		emitFixedCall(fn, allocBuilderIdx);
		const bufLocal = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(bufLocal, fn.body);
		if (nominal && nomLayout)
			stampNominalTrace(node, nominal, nomLayout, bufLocal, fn);
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) continue;
			const off = nominal ? nomOff(item, i) : (layout.offs[i] ?? 0);
			storeMember(
				itemValue(item),
				itemTypes[i] ?? BaseTypes.Int32,
				off,
				bufLocal,
				fn,
			);
		}
		// Embedding moves ownership into the record — drop glue frees members
		// with it, so the source's own entry must not free them again.
		for (const item of items) releaseOwned(fn, itemValue(item));
		fn.body.push(OP_LOCAL_GET);
		uleb128(bufLocal, fn.body);
		return nominal ?? makeDataType(slotSize, items);
	}

	function flattenDataItem(item: Node): Node[] {
		// A block's items are its elements — nothing splices. Labeled or
		// not, a nested block is one element (an inline unit); collections
		// of records are just blocks whose elements are records.
		return [item];
	}

	function makeDataType(slotSize: number, items: Node[]): Type {
		const members: Record<string, GbcSymbol> = {};
		let idx = 0;
		items.forEach(it => {
			const t = inferType(itemValue(it));
			// A labeled field is a named unit; an unlabeled element is a
			// positional unit — record elements included (no splicing).
			if (it.kind === 'propdef' && it.label) {
				const key = text(it.label);
				members[key] = { kind: 'variable', name: key, flags: 0, type: t };
				return;
			}
			const key = String(idx++);
			members[key] = { kind: 'variable', name: key, flags: 0, type: t };
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
		if (field.kind === 'number') idx = Number(field.value);
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

	function emitElemLoad(size: number, off: number, fn: FuncBuilder) {
		fn.body.push(size === 8 ? OP_F64_LOAD : size === 1 ? 0x2d : OP_I32_LOAD);
		uleb128(size === 8 ? 3 : size === 1 ? 0 : 2, fn.body);
		uleb128(off, fn.body);
	}

	function emitFieldStore(ft: Type, off: number, fn: FuncBuilder) {
		const b = fieldBytes(ft);
		const op = isFloatType(ft)
			? b === 8
				? OP_F64_STORE
				: OP_F32_STORE
			: b === 8
				? OP_I64_STORE
				: b === 1
					? OP_I32_STORE8
					: b === 2
						? OP_I32_STORE16
						: OP_I32_STORE;
		const align = b === 8 ? 3 : b === 4 ? 2 : b === 2 ? 1 : 0;
		fn.body.push(op);
		uleb128(align, fn.body);
		uleb128(off, fn.body);
	}

	function emitFieldLoad(ft: Type, off: number, fn: FuncBuilder) {
		const b = fieldBytes(ft);
		const op = isFloatType(ft)
			? b === 8
				? OP_F64_LOAD
				: OP_F32_LOAD
			: b === 8
				? OP_I64_LOAD
				: b === 1
					? OP_I32_LOAD8_U
					: b === 2
						? OP_I32_LOAD16_U
						: OP_I32_LOAD;
		const align = b === 8 ? 3 : b === 4 ? 2 : b === 2 ? 1 : 0;
		fn.body.push(op);
		uleb128(align, fn.body);
		uleb128(off, fn.body);
	}

	function compileMemberDollar(field: Node, fn: FuncBuilder): Type {
		const dt = fn.dollarType;
		if (
			fn.dollarLocal !== undefined &&
			dt?.kind === 'type' &&
			dt.family === 'data'
		) {
			const layout = fieldLayout(dt.members);
			let idx = 0;
			if (field.kind === 'number') idx = Number(field.value);
			else if (field.kind === 'ident') {
				const i = layout.keys.indexOf(field.symbol.name ?? '');
				if (i >= 0) idx = i;
			}
			const ft = dt.members[layout.keys[idx] ?? '']?.type ?? BaseTypes.Int32;
			const off = layout.offs[idx] ?? 0;
			return emitFieldRead(fn.dollarLocal, ft, off, fn);
		}
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	function emitFieldRead(
		baseLocal: number,
		ft: Type,
		off: number,
		fn: FuncBuilder,
	): Type {
		if (isInlineData(ft)) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(baseLocal, fn.body);
			if (off !== 0) {
				fn.body.push(OP_I32_CONST);
				sleb128(off, fn.body);
				fn.body.push(OP_I32_ADD);
			}
			return ft;
		}
		if (isUnionType(ft)) {
			const payWasm = unionPayloadWasm(ft);
			const payBytes = payWasm === I64 ? 8 : 4;
			fn.body.push(OP_LOCAL_GET);
			uleb128(baseLocal, fn.body);
			fn.body.push(payWasm === I64 ? OP_I64_LOAD : OP_I32_LOAD);
			uleb128(payWasm === I64 ? 3 : 2, fn.body);
			uleb128(off, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(baseLocal, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(off + payBytes, fn.body);
			return ft;
		}
		fn.body.push(OP_LOCAL_GET);
		uleb128(baseLocal, fn.body);
		emitFieldLoad(ft, off, fn);
		return ft;
	}

	function compileMember(node: NodeMap['.'], fn: FuncBuilder): Type {
		const recv = node.children[0];
		const field = node.children[1];
		if (recv.kind === 'data') return compileMemberData(recv, field, fn);
		if (recv.kind === '$') return compileMemberDollar(field, fn);
		const recvType = inferType(recv, fn);
		if (recvType.kind === 'type' && recvType.family === 'data')
			return compileMemberLoad(recv, recvType, field, fn);
		fn.body.push(OP_I32_CONST);
		sleb128(0, fn.body);
		return BaseTypes.Int32;
	}

	function compileMemberLoad(
		recv: Node,
		recvType: Type,
		field: Node,
		fn: FuncBuilder,
	): Type {
		if (recvType.kind !== 'type' || recvType.family !== 'data')
			throw new Error('compileMemberLoad: not a data type');
		const layout = fieldLayout(recvType.members);
		let idx: number | undefined;
		if (field.kind === 'number') idx = Number(field.value);
		else if (field.kind === 'ident') {
			const i = layout.keys.indexOf(field.symbol.name ?? '');
			if (i >= 0) idx = i;
		}
		if (idx === undefined || idx < 0 || idx >= layout.keys.length)
			throw new Error('Member access target not found');
		const ft =
			recvType.members[layout.keys[idx] ?? '']?.type ?? BaseTypes.Int32;
		const off = layout.offs[idx] ?? 0;
		const baseLocal = allocLocal(fn, I32);
		compileExpr(recv, fn);
		fn.body.push(OP_LOCAL_SET);
		uleb128(baseLocal, fn.body);
		return emitFieldRead(baseLocal, ft, off, fn);
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
		const declared = node.type ? resolveTypeFromNode(node.type) : undefined;
		stampErrorData(node.value, declared);
		const savedBinding = fn.bindingSym;
		fn.bindingSym = sym;
		let rt = compileExpr(node.value, fn);
		fn.bindingSym = savedBinding;
		if (
			declared?.kind === 'type' &&
			declared !== rt &&
			isIntType(declared) &&
			isIntType(rt)
		) {
			coerceIntWidth(rt, declared, fn);
			if (isInt64Type(declared) || !isInt64Type(rt)) rt = declared;
		}
		if (isUnionType(rt)) {
			const tagIdx = allocLocal(fn, I32);
			const payIdx = allocLocal(fn, unionPayloadWasm(rt));
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagIdx, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(payIdx, fn.body);
			fn.paramMap.set(sym, payIdx);
			(fn.tagMap ??= new Map()).set(sym, tagIdx);
			sym.type = rt;
			if (ownableExpr(node.value, fn))
				(fn.owned ??= []).push({
					sym,
					localIdx: payIdx,
					tagIdx,
					type: rt,
				});
			return BaseTypes.Void;
		}
		const wasmType = hasRuntimeValue(rt)
			? gbcToWasm(rt)
			: I32;
		const localIdx = allocLocal(fn, wasmType);
		fn.body.push(OP_LOCAL_SET);
		uleb128(localIdx, fn.body);
		fn.paramMap.set(sym, localIdx);
		sym.type = rt;
		if (
			ownableExpr(node.value, fn) &&
			rt.kind === 'type' &&
			(rt.family === 'string' || rt.family === 'data')
		)
			(fn.owned ??= []).push({ sym, localIdx, type: rt });
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

		return drivePipeValue(source, stages, originalUnion, fn);
	}

	function drivePipeValue(
		source: Node,
		stages: Node[],
		originalUnion: SymbolMap['type'] | undefined,
		fn: FuncBuilder,
	): Type {
		let sourceType = compileExpr(source, fn);
		if (
			originalUnion &&
			isUnionType(originalUnion) &&
			!isUnionType(sourceType) &&
			hasRuntimeValue(sourceType)
		) {
			coerceToUnion(sourceType, originalUnion, fn);
			sourceType = originalUnion;
		}
		if (
			source.kind === 'call' &&
			sourceType.kind === 'type' &&
			sourceType.family === 'unknown'
		) {
			const inferred = inferType(source, fn);
			if (inferred.kind === 'type' && inferred.family !== 'unknown')
				sourceType = inferred;
		}
		const passType = originalUnion ?? sourceType;
		// A fresh heap source fully consumed by the chain (scalar/void
		// result — no stage forwarded the pointer) dies with the drive.
		let srcTmp: number | undefined;
		if (
			passType.kind === 'type' &&
			(passType.family === 'string' || passType.family === 'data') &&
			ownableExpr(source, fn)
		) {
			srcTmp = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(srcTmp, fn.body);
		}
		const result = driveStages(stages, passType, fn);
		if (srcTmp !== undefined && scalarOrVoidReturn(result)) {
			const idx = srcTmp;
			const loadTmp = () => {
				fn.body.push(OP_LOCAL_GET);
				uleb128(idx, fn.body);
			};
			emitDataMemberFrees(loadTmp, passType, fn);
			loadTmp();
			emitFixedCall(fn, freeBuilderIdx);
		}
		return result;
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
		originFn?: string,
	) {
		const stmts = source.statements ?? [];
		for (const s of stmts)
			stampErrorData(s, source.symbol.returnType, originFn);
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
					if (savedFusion) return savedFusion.emit(t);
					if (hasRuntimeValue(t)) fn.body.push(OP_DROP);
					return BaseTypes.Void;
				}
				return driveStages(stages, broadenForDispatch(t), fn);
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
			emitToFusion(expr, t, fn);
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
		if (inliningStages.has(fnNode.symbol)) return false;
		const bodyStmts = fnNode.statements ?? [];
		const only = bodyStmts.length === 1 ? bodyStmts[0] : undefined;
		if (only && only.kind === 'call') {
			const rt = inferType(only, fn);
			if (
				rt.kind === 'type' &&
				rt.family !== 'void' &&
				rt.family !== 'unknown'
			)
				return false;
		}

		const args = callNode.children[1];
		const params = fnNode.parameters ?? [];

		inliningStages.add(fnNode.symbol);
		try {
			if (params.length > 0) {
				const argList = argListFromCall(args);
				if (
					!bindInlineParams(
						params,
						argList,
						fn,
						fnNodeCannotRetain(fnNode),
						ownedInParams.get(fnNode.symbol),
					)
				)
					return false;
				compileFnSource(fnNode, stages, fn, sym.name);
				return true;
			}

			const dataType = buildCallDataBlock(args, fn);
			const dollarLocal = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_SET);
			uleb128(dollarLocal, fn.body);

			const savedDollarLocal = fn.dollarLocal;
			const savedDollarTagLocal = fn.dollarTagLocal;
			const savedDollarType = fn.dollarType;
			fn.dollarLocal = dollarLocal;
			fn.dollarTagLocal = undefined;
			fn.dollarType = dataType;
			compileFnSource(fnNode, stages, fn, sym.name);
			fn.dollarLocal = savedDollarLocal;
			fn.dollarTagLocal = savedDollarTagLocal;
			fn.dollarType = savedDollarType;
			return true;
		} finally {
			inliningStages.delete(fnNode.symbol);
		}
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
		ownArgs?: boolean,
		ownedIn?: boolean[],
	): boolean {
		const resolved = resolveArgNodes(
			params.map(p => p.symbol),
			argList,
		);
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (!p) return false;
			const argNode = resolved[i];
			if (!argNode) return false;
			bindOneParam(p, argNode, ownArgs, ownedIn?.[i], fn);
		}
		return true;
	}

	function bindOneParam(
		p: NodeMap['parameter'],
		argNode: Node,
		ownArgs: boolean | undefined,
		ownedInFlag: boolean | undefined,
		fn: FuncBuilder,
	): void {
		const pSym = p.symbol;
		if (pSym.type?.kind === 'function') {
			// A function-valued argument binds by symbol (like the
			// monomorphization path) rather than compiling as a value.
			const fa = resolveFnArg(argNode);
			if (fa) {
				fnArgBindings.set(pSym, fa);
				return;
			}
		}
		stampErrorData(argNode, pSym.type);
		const argType = compileExpr(argNode, fn);
		coerceIntWidth(argType, pSym.type, fn);
		maybeUpcastAdjust(argType, pSym.type, fn);
		if (
			!pSym.type ||
			(pSym.type.kind === 'type' && pSym.type.family === 'unknown')
		)
			pSym.type = argType;
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
		trackInlineOwned(p, argNode, argType, localIdx, ownArgs, ownedInFlag, fn);
	}

	// A fresh arg bound for an inlined body that cannot retain it is this
	// frame's to free — the param local doubles as the temp. An owned-in slot
	// keeps its real name so the inlined body's moves and re-passes release it.
	function trackInlineOwned(
		p: NodeMap['parameter'],
		argNode: Node,
		argType: Type,
		localIdx: number,
		ownArgs: boolean | undefined,
		ownedInFlag: boolean | undefined,
		fn: FuncBuilder,
	): void {
		if (
			argType.kind !== 'type' ||
			(argType.family !== 'string' && argType.family !== 'data')
		)
			return;
		if (ownedInFlag) {
			(fn.owned ??= []).push({
				sym: p.symbol,
				localIdx,
				type: argType,
				paramOwned: true,
			});
			return;
		}
		const pType = p.symbol.type;
		if (
			ownArgs &&
			pType?.kind === 'type' &&
			pType.family !== 'union' &&
			ownableExpr(argNode, fn)
		)
			(fn.owned ??= []).push({
				sym: { kind: 'variable', name: '', flags: 0 },
				localIdx,
				type: argType,
				temp: true,
			});
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

	function callEmitsSequence(callNode: NodeMap['call']): boolean {
		const fnNode = getCallableFn(callNode);
		if (!fnNode || fnNode.symbol.flags & Flags.Sequence) return false;
		const stmts = fnNode.statements ?? [];
		const onlyStmt = stmts.length === 1 ? stmts[0] : undefined;
		const isDirectTier =
			onlyStmt?.kind === 'next' && onlyStmt.children?.[0]?.kind !== ',';
		if (isDirectTier) return false;
		return stmts.some(s => s.kind === 'next' || s.kind === 'done');
	}

	function argListFromCall(args: Node | undefined): Node[] {
		if (!args) return [];
		return args.kind === ',' ? args.children : [args];
	}

	function makeFusion(stages: Node[], savedFusion: Fusion | undefined, fn: FuncBuilder): Fusion {
		return {
			emit: (t: Type) => {
				if (stages.length === 0) {
					if (savedFusion) return savedFusion.emit(t);
					if (!hasRuntimeValue(t)) return BaseTypes.Void;
					if (!hasRuntimeValue(fn.returnType)) {
						fn.body.push(OP_DROP);
						return BaseTypes.Void;
					}
					return undefined;
				}
				const cur = fn.fusion;
				fn.fusion = savedFusion;
				const rt = driveStages(stages, t, fn);
				fn.fusion = cur;
				return rt;
			},
			targetDepth: savedFusion?.targetDepth ?? fn.blockDepth,
		};
	}

	function tryInlineEmittingCall(
		callNode: NodeMap['call'],
		stages: Node[],
		fn: FuncBuilder,
	): boolean {
		if (!callEmitsSequence(callNode)) return false;
		const fnNode = getCallableFn(callNode);
		if (!fnNode) return false;
		const stmts = fnNode.statements ?? [];

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
		const inlineCallee = callNode.children[0];
		const inlineName =
			inlineCallee.kind === 'ident'
				? inlineCallee.symbol.name
				: undefined;
		try {
			for (const stmt of stmts) {
				stampErrorData(stmt, fnNode.symbol.returnType, inlineName);
				compileExpr(stmt, fn);
			}
		} finally {
			fn.fusion = savedFusion;
			fn.doneDepth = savedDoneDepth;
			for (let i = 0; i < params.length; i++) {
				const p = params[i];
				const saved = savedParamTypes[i];
				if (p && saved) p.symbol.type = saved;
			}
		}
		fn.body.push(OP_END);
		fn.blockDepth--;
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
		if (!bindInlineParams(params, argList, fn)) return;
		for (let i = 0; i < stmts.length - 1; i++) {
			const s = stmts[i];
			if (s) compileExpr(s, fn);
		}
		stampErrorData(body, fnNode.symbol.returnType, callee.symbol.name);
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
				if (savedFusion) return savedFusion.emit(t);
				if (hasRuntimeValue(t)) fn.body.push(OP_DROP);
				return BaseTypes.Void;
			},
			targetDepth,
		};

		fn.body.push(OP_LOCAL_GET);
		uleb128(counter, fn.body);
		// Values owned by one iteration (stage-body locals, arg temps) die
		// with it — free them per iteration, not at frame exit, so loops
		// run flat. A `break` skips at most the breaking iteration's frees.
		const ownedBase = fn.owned?.length ?? 0;
		driveStages(stages, BaseTypes.Int32, fn);
		if (fn.owned && fn.owned.length > ownedBase) {
			emitOwnedFrees(fn, ownedBase);
			fn.owned.length = ownedBase;
		}

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
		if (hasRuntimeValue(inputType) && fn.fusion && !fn.pipeValue) {
			fn.fusion.emit(inputType);
			return BaseTypes.Void;
		}
		return inputType;
	}

	// Re-derive an unannotated multi-data slot's type from the concrete
	// input every call (recursion needs the shrinking per-level type); annotated
	// slots keep their declared type.
	function rederiveSlotType(
		p: NodeMap['parameter'],
		idx: number,
		inputType: Type,
		headCount: number,
		allKeys: string[],
	): void {
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
		const singleRest =
			restKeys.length === 1
				? inputType.members[restKeys[0] ?? '']?.type
				: undefined;
		if (restKeys.length === 0) p.symbol.type = BaseTypes.Void;
		else if (
			restKeys.length === 1 &&
			!(singleRest?.kind === 'type' && singleRest.family === 'data')
		)
			// A single scalar rest collapses to the value. A record
			// element stays wrapped — collapsing it would be
			// indistinguishable from a block of its fields.
			p.symbol.type = singleRest ?? BaseTypes.Int32;
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
				size: inputType.size,
				members,
			};
		}
	}

	// Scalar input lifts to [scalar] — head slot = the value (on stack),
	// remaining slots = Void. Used by recursive generic stages when the data has
	// collapsed to a scalar.
	function bindScalarLift(
		params: NodeMap['parameter'][],
		inputType: Type,
		fn: FuncBuilder,
	): (Type | undefined)[] {
		const savedSlotTypes = params.map(p => p.symbol.type);
		params.forEach((p, idx) => {
			if (!p.type) p.symbol.type = idx === 0 ? inputType : BaseTypes.Void;
			// The head slot holds the scalar (already on the stack) and must match
			// its wasm type (e.g. f64); rest slots are the Void i32 sentinel.
			const slotType = p.symbol.type;
			const localIdx = allocLocal(
				fn,
				idx === 0 && slotType && hasRuntimeValue(slotType)
					? gbcToWasm(slotType)
					: I32,
			);
			if (idx !== 0) {
				fn.body.push(OP_I32_CONST);
				sleb128(0, fn.body);
			}
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(p.symbol, localIdx);
		});
		return savedSlotTypes;
	}

	function bindSingleParam(
		params: NodeMap['parameter'][],
		inputType: Type,
		fn: FuncBuilder,
	): void {
		const p = params[0];
		if (!p) {
			const localIdx = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.dollarLocal = localIdx;
			fn.dollarTagLocal = undefined;
			fn.dollarType = inputType;
			return;
		}
		const pSym = p.symbol;
		if (!pSym.type) {
			if (p.type?.kind === 'typeident' && p.type.symbol.kind === 'type')
				pSym.type = p.type.symbol;
			else pSym.type = inputType;
		}
		if (isUnionType(pSym.type)) {
			const tagIdx = allocLocal(fn, I32);
			const payIdx = allocLocal(fn, unionPayloadWasm(pSym.type));
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagIdx, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(payIdx, fn.body);
			fn.paramMap.set(pSym, payIdx);
			(fn.tagMap ??= new Map()).set(pSym, tagIdx);
			if (!p.label) {
				fn.dollarLocal = payIdx;
				fn.dollarTagLocal = tagIdx;
				fn.dollarType = pSym.type;
			}
			return;
		}
		const localIdx = allocLocal(fn, gbcToWasm(pSym.type));
		fn.body.push(OP_LOCAL_SET);
		uleb128(localIdx, fn.body);
		fn.paramMap.set(pSym, localIdx);
		if (!p.label) {
			fn.dollarLocal = localIdx;
			fn.dollarTagLocal = undefined;
			fn.dollarType = pSym.type ?? inputType;
		}
	}

	function bindMultiData(
		params: NodeMap['parameter'][],
		inputType: Type,
		fn: FuncBuilder,
	): (Type | undefined)[] {
		const dataLocal = allocLocal(fn, I32);
		fn.body.push(OP_LOCAL_SET);
		uleb128(dataLocal, fn.body);
		const inputData =
			inputType.kind === 'type' && inputType.family === 'data'
				? inputType
				: undefined;
		const inputLayout = inputData ? fieldLayout(inputData.members) : undefined;
		const itemSize =
			inputType.kind === 'type' && inputType.size > 0 ? inputType.size : 4;
		const inputMembers =
			inputType.kind === 'type' &&
			inputType.family === 'data' &&
			Object.keys(inputType.members).length > 0
				? Object.keys(inputType.members)
				: undefined;
		const headCount = params.length - 1;
		const savedSlotTypes = params.map(p => p.symbol.type);
		const allKeys = inputMembers ?? [];
		if (inTemplateInline > 0)
			params.forEach((p, idx) =>
				rederiveSlotType(p, idx, inputType, headCount, allKeys),
			);

		const bindUnionSlot = (pSym: GbcSymbol, sft: Type, sOff: number) => {
			const payWasm = unionPayloadWasm(sft);
			const payBytes = payWasm === I64 ? 8 : 4;
			const payLoc = allocLocal(fn, payWasm);
			const tagLoc = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_GET);
			uleb128(dataLocal, fn.body);
			fn.body.push(payWasm === I64 ? OP_I64_LOAD : OP_I32_LOAD);
			uleb128(payWasm === I64 ? 3 : 2, fn.body);
			uleb128(sOff, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(payLoc, fn.body);
			fn.body.push(OP_LOCAL_GET);
			uleb128(dataLocal, fn.body);
			fn.body.push(OP_I32_LOAD);
			uleb128(2, fn.body);
			uleb128(sOff + payBytes, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagLoc, fn.body);
			fn.paramMap.set(pSym, payLoc);
			(fn.tagMap ??= new Map()).set(pSym, tagLoc);
		};

		const bindRestSubBlock = (
			pSym: GbcSymbol,
			ptype: Type,
			localIdx: number,
		) => {
			if (ptype.kind !== 'type' || ptype.family !== 'data') return;
			const restLayout = fieldLayout(ptype.members);
			fn.body.push(OP_I32_CONST);
			sleb128(restLayout.total || 4, fn.body);
			emitFixedCall(fn, allocBuilderIdx);
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			// The rest block is this frame's scratch — free it (block only:
			// no type on the entry, so no member walk — its pointers are
			// borrows of the original collection).
			(fn.owned ??= []).push({
				sym: { kind: 'variable', name: '', flags: 0 },
				localIdx,
				temp: true,
			});
			for (let i = 0; i < restLayout.keys.length; i++) {
				const rft =
					ptype.members[restLayout.keys[i] ?? '']?.type ?? BaseTypes.Int32;
				const srcOff = inputLayout
					? (inputLayout.offs[headCount + i] ?? 0)
					: (headCount + i) * itemSize;
				const dstOff = restLayout.offs[i] ?? 0;
				// A record element copies whole (its bytes, not a slot load).
				if (isInlineData(rft)) {
					fn.body.push(OP_LOCAL_GET);
					uleb128(localIdx, fn.body);
					fn.body.push(OP_I32_CONST);
					sleb128(dstOff, fn.body);
					fn.body.push(OP_I32_ADD);
					fn.body.push(OP_LOCAL_GET);
					uleb128(dataLocal, fn.body);
					fn.body.push(OP_I32_CONST);
					sleb128(srcOff, fn.body);
					fn.body.push(OP_I32_ADD);
					fn.body.push(OP_I32_CONST);
					sleb128(fieldBytes(rft), fn.body);
					fn.body.push(0xfc, 0x0a, 0x00, 0x00);
					continue;
				}
				fn.body.push(OP_LOCAL_GET);
				uleb128(localIdx, fn.body);
				fn.body.push(OP_LOCAL_GET);
				uleb128(dataLocal, fn.body);
				emitFieldLoad(rft, srcOff, fn);
				emitFieldStore(rft, dstOff, fn);
			}
			fn.paramMap.set(pSym, localIdx);
		};

		params.forEach((p, idx) => {
			const pSym = p.symbol;
			if (!pSym.type) pSym.type = BaseTypes.Int32;
			const ptype = pSym.type;
			const isLast = idx === headCount;
			// Empty rest binds Void.
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
			// Multi-element rest materializes a sub-data-block; a
			// single-element rest falls through to slot read.
			if (isLast && isInlineData(ptype)) {
				bindRestSubBlock(pSym, ptype, localIdx);
				return;
			}
			const labelIdx =
				inputMembers && pSym.name ? inputMembers.indexOf(pSym.name) : -1;
			const slotIdx = labelIdx >= 0 ? labelIdx : idx;
			const sft =
				inputData && inputLayout
					? (inputData.members[inputLayout.keys[slotIdx] ?? '']?.type ??
						pSym.type)
					: pSym.type;
			const sOff = inputLayout
				? (inputLayout.offs[slotIdx] ?? 0)
				: slotIdx * itemSize;
			if (isUnionType(sft)) {
				bindUnionSlot(pSym, sft, sOff);
				return;
			}
			// A record element binds as an interior pointer into the block —
			// a borrow of the collection, never a value load.
			if (isInlineData(sft)) {
				fn.body.push(OP_LOCAL_GET);
				uleb128(dataLocal, fn.body);
				if (sOff !== 0) {
					fn.body.push(OP_I32_CONST);
					sleb128(sOff, fn.body);
					fn.body.push(OP_I32_ADD);
				}
				fn.body.push(OP_LOCAL_SET);
				uleb128(localIdx, fn.body);
				fn.paramMap.set(pSym, localIdx);
				return;
			}
			fn.body.push(OP_LOCAL_GET);
			uleb128(dataLocal, fn.body);
			emitFieldLoad(sft, sOff, fn);
			fn.body.push(OP_LOCAL_SET);
			uleb128(localIdx, fn.body);
			fn.paramMap.set(pSym, localIdx);
		});
		return savedSlotTypes;
	}

	function driveFnStage(
		stage: NodeMap['fn'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const params = stage.parameters ?? [];
		const savedDollarLocal = fn.dollarLocal;
		const savedDollarTagLocal = fn.dollarTagLocal;
		const savedDollarType = fn.dollarType;
		let savedSlotTypes: (Type | undefined)[] | undefined;
		const savedSlotLocals = params.map(p => fn.paramMap.get(p.symbol));
		const scalarLift =
			inTemplateInline > 0 &&
			params.length > 1 &&
			!(inputType.kind === 'type' && inputType.family === 'data');
		const isMultiData = params.length > 1 && !scalarLift;
		if (scalarLift) savedSlotTypes = bindScalarLift(params, inputType, fn);
		else if (isMultiData) savedSlotTypes = bindMultiData(params, inputType, fn);
		else bindSingleParam(params, inputType, fn);

		const savedFusion = fn.fusion;
		fn.fusion = makeFusion(rest, savedFusion, fn);
		const isSequence = !!(stage.symbol.flags & Flags.Sequence);
		// Stage params may be SHARED symbols (stdlib templates like `each`
		// are parsed once per process) — the restore must survive a thrown
		// compile error, or every later compile sees poisoned types.
		try {
			for (const stmt of stage.statements ?? []) {
				if (!isSequence) compileExpr(stmt, fn);
				else if (stmt.kind === ',')
					for (const c of stmt.children) emitOne(c, fn);
				else emitOne(stmt, fn);
			}
		} finally {
			fn.fusion = savedFusion;
			fn.dollarLocal = savedDollarLocal;
			fn.dollarTagLocal = savedDollarTagLocal;
			fn.dollarType = savedDollarType;
			if (savedSlotTypes)
				params.forEach((p, i) => {
					p.symbol.type = savedSlotTypes[i];
				});
			params.forEach((p, i) => {
				const sl = savedSlotLocals[i];
				if (sl === undefined) fn.paramMap.delete(p.symbol);
				else fn.paramMap.set(p.symbol, sl);
			});
		}
		return BaseTypes.Void;
	}

	// Drive a generic Sequence template as a pipe stage. The piped value
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

	// Spread a data-block input (already on the stack) into positional call args
	// for a multi-param fn stage, matching block members to params by label and
	// otherwise by position — the pipe-stage form of `resolveArgNodes`.
	function pipeArgFields(
		inputType: Type,
		paramSyms: GbcSymbol[],
	): { type: Type; offset: number }[] {
		const data =
			inputType.kind === 'type' && inputType.family === 'data'
				? inputType
				: undefined;
		if (!data || data.elem)
			throw new Error('A multi-parameter pipe stage requires a data block');
		const layout = fieldLayout(data.members);
		const keys = layout.keys;
		return paramSyms.map((_, i) => {
			const pname = paramSyms[i]?.name;
			const named = pname ? keys.indexOf(pname) : -1;
			const idx = named >= 0 ? named : i;
			const ft = data.members[keys[idx] ?? '']?.type ?? BaseTypes.Int32;
			const off = layout.offs[idx] ?? 0;
			return { type: ft, offset: off };
		});
	}

	function spreadDataToStack(
		inputType: Type,
		paramSyms: GbcSymbol[],
		fn: FuncBuilder,
	): { type: Type; offset: number }[] {
		const ptr = allocLocal(fn, I32);
		emitStoreLocal(ptr, fn);
		const fields = pipeArgFields(inputType, paramSyms);
		for (const field of fields) {
			emitFieldRead(ptr, field.type, field.offset, fn);
		}
		return fields;
	}

	function driveDirectCallStage(
		sym: GbcSymbol,
		builderIdx: number,
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const fnSym =
			sym.kind === 'function'
				? sym
				: sym.type?.kind === 'function'
					? sym.type
					: undefined;
		const callParams = fnSym?.parameters ?? [];
		if (
			callParams.length > 1 &&
			inputType.kind === 'type' &&
			inputType.family === 'data'
		)
			spreadDataToStack(inputType, callParams, fn);
		emitFixedCall(fn, builderIdx);
		const retType = fnSym?.returnType ?? BaseTypes.Unknown;
		return driveStages(rest, retType, fn);
	}

	function driveSequenceTemplate(
		template: NodeMap['fn'],
		_sym: GbcSymbol,
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		return driveTemplateStage(template, inputType, rest, fn);
	}

	function driveExternalStage(
		sym: SymbolMap['function'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const params = sym.parameters ?? [];
		if (
			params.length > 1 &&
			inputType.kind === 'type' &&
			inputType.family === 'data'
		)
			spreadDataToStack(inputType, params, fn);
		const sig = fnSignature(sym);
		const idx = importHost(sym.name ?? '', sig.params, sig.results);
		fn.body.push(OP_CALL);
		uleb128(idx, fn.body);
		return driveStages(rest, sym.returnType ?? BaseTypes.Void, fn);
	}

	function driveIntrinsicStage(
		position: NodeMap['ident'],
		intrinsic: SymbolMap['function'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const params = intrinsic.parameters ?? [];
		if (params.length === 0) {
			if (hasRuntimeValue(inputType)) fn.body.push(OP_DROP);
			const result = compileIntrinsic(intrinsic.name ?? '', undefined, fn);
			return driveStages(rest, result, fn);
		}
		const argTypes =
			params.length === 1
				? [inputType]
				: spreadDataToStack(inputType, params, fn).map(
						field => field.type,
					);
		const locals = argTypes.map(type => allocLocal(fn, gbcToWasm(type)));
		for (let i = locals.length - 1; i >= 0; i--) {
			const local = locals[i];
			if (local !== undefined) emitStoreLocal(local, fn);
		}
		const args = argTypes.map((type, i): NodeMap['ident'] => {
			const local = locals[i];
			if (local === undefined)
				throw new Error('Intrinsic stage argument has no local');
			const argSym: GbcSymbol = {
				kind: 'variable',
				name: params[i]?.name ?? '',
				flags: 0,
				type,
			};
			fn.paramMap.set(argSym, local);
			return { ...position, symbol: argSym };
		});
		const spreadArgs: NodeMap[','] = {
			...position,
			kind: ',',
			children: args,
		};
		const argNode: Node | undefined =
			args.length === 0
				? undefined
				: args.length === 1
					? args[0]
					: spreadArgs;
		try {
			const result = compileIntrinsic(intrinsic.name ?? '', argNode, fn);
			return driveStages(rest, result, fn);
		} finally {
			for (const arg of args) fn.paramMap.delete(arg.symbol);
		}
	}

	function driveIdentStage(
		stage: NodeMap['ident'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const sym = stage.symbol;
		if (sym.kind === 'function' && sym.flags & Flags.Intrinsic)
			return driveIntrinsicStage(stage, sym, inputType, rest, fn);
		const template = fnTemplates.get(sym);
		if (template && template.symbol.flags & Flags.Sequence)
			return driveSequenceTemplate(template, sym, inputType, rest, fn);
		const def = sym.definition;
		const fnValue =
			def?.kind === 'def' && def.value.kind === 'fn'
				? def.value
				: undefined;
		if (
			fnValue &&
			fnValue.symbol.flags & Flags.Sequence &&
			!inliningStages.has(fnValue.symbol)
		) {
			inliningStages.add(fnValue.symbol);
			try {
				const params = fnValue.parameters ?? [];
				return params.length > 0
					? driveFnStage(fnValue, inputType, rest, fn)
					: driveNoParamSequenceStage(fnValue, inputType, rest, fn);
			} finally {
				inliningStages.delete(fnValue.symbol);
			}
		}
		const builderIdx = fnDefBuilderIdx.get(sym);
		if (builderIdx !== undefined)
			return driveDirectCallStage(sym, builderIdx, inputType, rest, fn);
		if (fnValue) return inlineDirectFnStage(fnValue, inputType, rest, fn);
		const dispatched = driveOverloadDispatch(sym, inputType, rest, fn);
		if (dispatched) return dispatched;
		if (sym.kind === 'function' && sym.flags & Flags.External)
			return driveExternalStage(sym, inputType, rest, fn);
		throw new Error(`Unknown pipe-stage ident: "${sym.name ?? '?'}"`);
	}

	function driveNoParamSequenceStage(
		fnValue: NodeMap['fn'],
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type {
		const dollarLocal = allocLocal(fn, gbcToWasm(inputType));
		fn.body.push(OP_LOCAL_SET);
		uleb128(dollarLocal, fn.body);
		const savedDollarLocal = fn.dollarLocal;
		const savedDollarTagLocal = fn.dollarTagLocal;
		const savedDollarType = fn.dollarType;
		fn.dollarLocal = dollarLocal;
		fn.dollarTagLocal = undefined;
		fn.dollarType = inputType;
		compileFnSource(fnValue, rest, fn);
		fn.dollarLocal = savedDollarLocal;
		fn.dollarTagLocal = savedDollarTagLocal;
		fn.dollarType = savedDollarType;
		return BaseTypes.Void;
	}

	/** An arm's Unknown return compiles to a resultless builder — at the
	 * call boundary it behaves as Void, and reading it that way keeps a
	 * recompile of an already-stamped AST identical to the first pass. */
	function armReturnOrVoid(rt: Type | undefined): Type {
		if (!rt || (rt.kind === 'type' && rt.family === 'unknown'))
			return BaseTypes.Void;
		return rt;
	}

	function driveOverloadDispatch(
		sym: GbcSymbol,
		inputType: Type,
		rest: Node[],
		fn: FuncBuilder,
	): Type | undefined {
		const dt = sym.kind === 'function' ? sym : sym.type;
		if (!dt || dt.kind !== 'function' || !dt.overloads) return undefined;
		if (inputType.kind === 'type' && inputType.family === 'void')
			return driveStages(rest, BaseTypes.Void, fn);
		const arm = findDispatchArm(dt.overloads, [inputType]);
		if (!arm) return undefined;
		const tmpl = fnTemplates.get(arm);
		if (tmpl) {
			const idx = getOrCreateSpec(tmpl, [inputType]);
			emitFixedCall(fn, idx);
			const r = specReturn.get(idx) ?? armReturnOrVoid(arm.returnType);
			return driveStages(rest, r, fn);
		}
		emitArmCall(arm, sym.name, fn);
		return driveStages(rest, armReturnOrVoid(arm.returnType), fn);
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
			namedData(t) ||
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
		if (namedData(t)) return true;
		return false;
	}

	function autoDispatchUnion(
		stages: Node[],
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		const members =
			inputType.kind === 'type' && inputType.family === 'union'
				? inputType.members
				: [];
		const tagLocal = allocLocal(fn, I32);
		const payloadLocal = allocLocal(fn, unionPayloadWasm(inputType));
		fn.body.push(OP_LOCAL_SET);
		uleb128(tagLocal, fn.body);
		fn.body.push(OP_LOCAL_SET);
		uleb128(payloadLocal, fn.body);
		for (const m of members) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(tagLocal, fn.body);
			emitTagConst(memberTag(m), memberKey(m), fn);
			fn.body.push(0x46);
			fn.body.push(OP_IF);
			fn.body.push(0x40);
			fn.blockDepth++;
			fn.body.push(OP_LOCAL_GET);
			uleb128(payloadLocal, fn.body);
			if (hasRuntimeValue(m))
				bitcast(unionPayloadWasm(inputType), gbcToWasm(m), fn);
			driveStages(stages, m, fn);
			fn.body.push(OP_END);
			fn.blockDepth--;
		}
		return BaseTypes.Void;
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
			const intrinsic = resolveStaticMemberFn(stage);
			const field = stage.children[1];
			if (
				intrinsic &&
				intrinsic.flags & Flags.Intrinsic &&
				field.kind === 'ident'
			)
				return driveIntrinsicStage(
					field,
					intrinsic,
					inputType,
					rest,
					fn,
				);
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

		if (stage.kind === '|') {
			const arms: Node[] = [];
			const collect = (n: Node): void => {
				if (n.kind === '|') {
					collect(n.children[0]);
					collect(n.children[1]);
				} else arms.push(n);
			};
			collect(stage);
			return driveDispatch(arms, rest, inputType, fn);
		}

		if (isUnionType(inputType))
			return autoDispatchUnion(stages, inputType, fn);
		if (stage.kind === 'ident') return driveIdentStage(stage, inputType, rest, fn);

		throw new Error(`Unsupported pipe stage: ${stage.kind}`);
	}

	function driveDispatch(
		dispatchStages: Node[],
		afterStages: Node[],
		inputType: Type,
		fn: FuncBuilder,
	): Type {
		const isUnion = isUnionType(inputType);
		const valueLocal = allocLocal(
			fn,
			isUnion ? unionPayloadWasm(inputType) : gbcToWasm(inputType),
		);
		let tagLocal = -1;
		if (isUnion) {
			tagLocal = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagLocal, fn.body);
		}
		fn.body.push(OP_LOCAL_SET);
		uleb128(valueLocal, fn.body);
		const valueReturn =
			afterStages.length === 0 &&
			hasRuntimeValue(fn.returnType) &&
			!isUnionType(fn.returnType);
		const savedDispatchFusion = fn.fusion;
		let resultLocal = -1;
		if (valueReturn) {
			resultLocal = allocLocal(fn, gbcToWasm(fn.returnType));
			fn.fusion = {
				// The emitted value becomes the frame result — it escapes,
				// so report no drive type and nothing gets freed.
				emit: () => {
					fn.body.push(OP_LOCAL_SET);
					uleb128(resultLocal, fn.body);
					return undefined;
				},
				targetDepth: fn.blockDepth,
			};
		}
		for (const ds of dispatchStages) {
			if (ds.kind !== 'fn') continue;
			const dispatchType = stageDispatchType(ds);
			if (!dispatchType) continue;
			const armMember = isUnion ? dispatchType : inputType;
			emitDispatchMatch(
				dispatchType,
				inputType,
				isUnion,
				valueLocal,
				tagLocal,
				fn,
			);
			fn.body.push(OP_IF);
			fn.body.push(0x40);
			fn.blockDepth++;
			fn.body.push(OP_LOCAL_GET);
			uleb128(valueLocal, fn.body);
			if (isUnion && hasRuntimeValue(armMember))
				bitcast(
					unionPayloadWasm(inputType),
					gbcToWasm(armMember),
					fn,
				);
			driveFnStage(ds, armMember, afterStages, fn);
			fn.body.push(OP_END);
			fn.blockDepth--;
		}
		if (valueReturn) {
			fn.fusion = savedDispatchFusion;
			fn.body.push(OP_LOCAL_GET);
			uleb128(resultLocal, fn.body);
			return fn.returnType;
		}
		return BaseTypes.Void;
	}

	// Emit `tag == ids[0] || tag == ids[1] || ...` as an i32 boolean.
	function emitTagAnyMatch(ids: number[], tagLocal: number, fn: FuncBuilder): void {
		fn.body.push(OP_LOCAL_GET);
		uleb128(tagLocal, fn.body);
		fn.body.push(OP_I32_CONST);
		sleb128(ids[0] ?? 0, fn.body);
		fn.body.push(0x46); // i32.eq
		for (let k = 1; k < ids.length; k++) {
			fn.body.push(OP_LOCAL_GET);
			uleb128(tagLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			sleb128(ids[k] ?? 0, fn.body);
			fn.body.push(0x46);
			fn.body.push(0x72); // i32.or
		}
	}

	// Push an i32 boolean: does the dispatched value match this arm's type?
	function emitDispatchMatch(
		dispatchType: SymbolMap['type'],
		inputType: Type,
		isUnion: boolean,
		valueLocal: number,
		tagLocal: number,
		fn: FuncBuilder,
	): void {
		if (dispatchType.family === 'literal') {
			fn.body.push(OP_LOCAL_GET);
			uleb128(valueLocal, fn.body);
			fn.body.push(OP_I32_CONST);
			if (typeof dispatchType.value === 'boolean')
				sleb128(dispatchType.value ? 1 : 0, fn.body);
			else if (typeof dispatchType.value === 'number')
				sleb128(dispatchType.value | 0, fn.body);
			else if (typeof dispatchType.value === 'string')
				dataImm(dispatchType.value, fn);
			else sleb128(0, fn.body);
			fn.body.push(0x46); // i32.eq
			return;
		}
		if (!isUnion) {
			const matches =
				composes(inputType, dispatchType) ||
				(inputType.kind === 'type' &&
					inputType.family === dispatchType.family &&
					inputType.name === dispatchType.name);
			fn.body.push(OP_I32_CONST);
			sleb128(matches ? 1 : 0, fn.body);
			return;
		}
		const ids = matchingTags(inputType, dispatchType);
		if (namedData(dispatchType) && ids.length === 0) {
			fn.body.push(OP_I32_CONST);
			sleb128(0, fn.body);
			return;
		}
		emitTagAnyMatch(ids, tagLocal, fn);
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

	function maybeUpcastAdjust(s: Type, t: Type | undefined, fn: FuncBuilder) {
		if (!t || s.kind !== 'type' || t.kind !== 'type') return;
		if (s.family !== 'data' || t.family !== 'data' || s === t) return;
		if (!composes(s, t)) return;
		const f0 = Object.keys(t.members)[0];
		if (!f0) return;
		const sl = fieldLayout(s.members);
		const tl = fieldLayout(t.members);
		const si = sl.keys.indexOf(f0);
		const ti = tl.keys.indexOf(f0);
		if (si < 0 || ti < 0) return;
		const adjust = (sl.offs[si] ?? 0) - (tl.offs[ti] ?? 0);
		if (adjust !== 0) {
			fn.body.push(OP_I32_CONST);
			sleb128(adjust, fn.body);
			fn.body.push(OP_I32_ADD);
		}
	}

	function paramDefault(sym: GbcSymbol | undefined): Node | undefined {
		const def = sym?.definition;
		return def?.kind === 'parameter' ? def.value : undefined;
	}

	// The single argument-resolution rule shared by every call path (real call,
	// inline, stream, pipe-stage). Given a fn's params and the raw argument list,
	// returns the arg node to bind for each param, in param order — applying:
	// data-block spread (a lone `[…]` into a multi-param fn), named reorder,
	// `void`→default, and positional order. Throws on mixed positional+named.
	function resolveArgNodes(
		paramSyms: GbcSymbol[],
		argList: Node[],
	): (Node | undefined)[] {
		let list = argList;
		if (
			list.length === 1 &&
			list[0]?.kind === 'data' &&
			paramSyms.length !== 1
		)
			list = dataItems(list[0]).flatMap(flattenDataItem);
		const hasNamed = list.some(a => a.kind === 'propdef' && !!a.label);
		const hasPositional = list.some(a => a.kind !== 'propdef');
		if (hasNamed && hasPositional)
			throw new Error('cannot mix positional and named arguments');
		if (hasNamed) {
			const byName = new Map<string, Node>();
			for (const a of list)
				if (
					a.kind === 'propdef' &&
					a.label &&
					a.value &&
					!isVoidLiteralNode(a.value)
				)
					byName.set(a.symbol.name, a.value);
			return paramSyms.map(
				s => byName.get(s.name ?? '') ?? paramDefault(s),
			);
		}
		return paramSyms.map((s, i) => {
			const a = list[i];
			if (isVoidLiteralNode(a)) return paramDefault(s);
			return a ?? paramDefault(s);
		});
	}

	/** The callee's output cannot alias an argument — a scalar/void return
	 * carries no pointer, and an owned return is fresh on every path. Fresh
	 * argument temporaries passed to such a callee die with the call, so
	 * the caller can own and free them. */
	function scalarOrVoidReturn(ret: Type | undefined): boolean {
		return (
			!ret ||
			(ret.kind === 'type' &&
				(ret.family === 'int' ||
					ret.family === 'uint' ||
					ret.family === 'float' ||
					ret.family === 'bool' ||
					ret.family === 'char' ||
					ret.family === 'void'))
		);
	}

	function noValueReturn(ret: Type | undefined): boolean {
		return (
			scalarOrVoidReturn(ret) ||
			(ret?.kind === 'type' && ret.family === 'unknown')
		);
	}

	function calleeCannotRetain(calleeSym: SymbolMap['function']): boolean {
		if (noValueReturn(calleeSym.returnType)) return true;
		const node = fnTemplates.get(calleeSym) ?? fnNodeBySym.get(calleeSym);
		return node ? fnReturnsOwned(node) : false;
	}

	function fnNodeCannotRetain(fnNode: NodeMap['fn']): boolean {
		if (noValueReturn(fnNode.symbol.returnType)) return true;
		return fnReturnsOwned(fnNode);
	}

	function compileCallArgs(
		args: Node | undefined,
		calleeSym: SymbolMap['function'],
		fn: FuncBuilder,
		bindings?: Map<GbcSymbol, SymbolMap['function']>,
		noArgFrees?: boolean,
	) {
		const params = calleeSym.parameters ?? [];
		const resolved = resolveArgNodes(params, argListFromCall(args));
		const ownArgs = !noArgFrees && calleeCannotRetain(calleeSym);
		const ownedIn = ownedInParams.get(calleeSym);
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (!p || bindings?.has(p)) continue;
			const a = resolved[i];
			if (!a)
				throw new Error(
					`no match: missing argument for parameter "${p.name ?? '?'}"`,
				);
			stampErrorData(a, p.type);
			const at = compileExpr(a, fn);
			trackCallArgOwned(a, at, ownedIn?.[i], ownArgs, noArgFrees, fn);
			coerceIntWidth(at, p.type, fn);
			maybeUpcastAdjust(at, p.type, fn);
		}
	}

	function trackCallArgOwned(
		a: Node,
		at: Type,
		ownedInSlot: boolean | undefined,
		ownArgs: boolean,
		noArgFrees: boolean | undefined,
		fn: FuncBuilder,
	): void {
		if (ownedInSlot) {
			// Ownership moves into the callee — a bare re-pass releases
			// this frame's entry; fresh values need no caller temp.
			if (a.kind === 'ident') releaseOwned(fn, a);
			return;
		}
		const heap =
			at.kind === 'type' &&
			(at.family === 'string' || at.family === 'data') &&
			ownableExpr(a, fn);
		if (ownArgs && heap) {
			const tmp = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(tmp, fn.body);
			(fn.owned ??= []).push({
				sym: { kind: 'variable', name: '', flags: 0 },
				localIdx: tmp,
				type: at,
				temp: true,
			});
			return;
		}
		if (!noArgFrees && !ownArgs && fn.bindingSym && heap) {
			// Borrow-returning callee, bound result: the binder adopts
			// the fresh arg — the result may alias it, so it lives as
			// long as the binder's name and leaves with it.
			const tmp = allocLocal(fn, I32);
			fn.body.push(OP_LOCAL_TEE);
			uleb128(tmp, fn.body);
			(fn.owned ??= []).push({
				sym: fn.bindingSym,
				localIdx: tmp,
				type: at,
			});
		}
	}

	/**
	 * Allocate a fresh `FuncBuilder` for `fnNode` and append it to
	 * `funcBuilders`. Used by both `declareFn` (eager, per source-level fn)
	 * and `getOrCreateSpec` (per-call-site specialization).
	 */
	function buildParamTypes(paramSyms: NodeMap['parameter'][]): {
		paramTypes: number[];
		paramMap: Map<GbcSymbol, number>;
		tagMap: Map<GbcSymbol, number>;
	} {
		const paramTypes: number[] = [];
		const paramMap = new Map<GbcSymbol, number>();
		const tagMap = new Map<GbcSymbol, number>();
		let local = 0;
		for (let i = 0; i < paramSyms.length; i++) {
			const p = paramSyms[i];
			if (!p) continue;
			const sym = p.symbol;
			if (fnArgBindings.has(sym)) continue;
			if (!sym.type) sym.type = BaseTypes.Int32;
			const wts = wasmTypesOf(sym.type);
			paramMap.set(sym, local);
			if (isUnionType(sym.type) && wts.length === 2)
				tagMap.set(sym, local + 1);
			for (const wt of wts) {
				paramTypes.push(wt);
				local++;
			}
		}
		return { paramTypes, paramMap, tagMap };
	}

	function resolveFnReturnType(
		fnNode: NodeMap['fn'],
		typeArgs?: Map<string, Type>,
	): Type {
		let returnType: Type = fnNode.returnType
			? resolveTypeFromNode(fnNode.returnType)
			: BaseTypes.Unknown;
		if (
			fnNode.returnType &&
			fnNode.symbol.returnType?.kind === 'type' &&
			fnNode.symbol.returnType.family !== 'unknown'
		)
			returnType = fnNode.symbol.returnType;
		returnType = substituteTypeArg(returnType, typeArgs);
		// A parameterized collection return (`Buffer<U>`) resolves its element by
		// NAME — needed when `U` binds only through a higher-order arg, whose
		// placeholder the return annotation may not share. Only the element is
		// reduced, so record returns keep their exact (uncollapsed) shape.
		if (
			typeArgs &&
			returnType.kind === 'type' &&
			returnType.family === 'data' &&
			returnType.elem
		) {
			const e = reduceType(returnType.elem, typeArgs);
			if (e !== returnType.elem) returnType = bufferTypeOf(e);
		}
		returnType = reduceAppliedReturn(returnType);
		return inferReturnFromBody(returnType, fnNode);
	}

	function substituteTypeArg(returnType: Type, typeArgs?: Map<string, Type>): Type {
		if (
			returnType.kind === 'type' &&
			returnType.family === 'unknown' &&
			returnType.name
		) {
			const concrete = typeArgs?.get(returnType.name);
			if (concrete && concrete.kind === 'type' && concrete.family !== 'unknown')
				return concrete;
		}
		return returnType;
	}

	// Reduce an applied type-level chain return (e.g. `First<T>`) using the
	// now-concrete type-param placeholders (getOrCreateSpec mutated them first).
	function reduceAppliedReturn(returnType: Type): Type {
		if (
			returnType.kind === 'type' &&
			(returnType.application || returnType.family === 'unknown')
		) {
			const reduced = reduceType(returnType, new Map());
			if (reduced.kind === 'type' && reduced.family !== 'unknown')
				return reduced;
		}
		return returnType;
	}

	// Last resort for a still-unknown return: a single-statement body's value type.
	// Return types are inferred — an annotation is never required. The tail
	// statement decides: `next X` or a bare value types the return; a
	// consumer call, assignment, def, `done`, or `break` tail is Void. A
	// `next` before the tail marks a multi-emit body (left as-is).
	function tailReturnValue(tail: Node): Node | undefined {
		if (tail.kind === 'next') return tail.children?.[0];
		if (
			tail.kind === 'def' ||
			tail.kind === '=' ||
			tail.kind === 'break' ||
			tail.kind === 'done'
		)
			return undefined;
		return tail;
	}

	function inferReturnFromBody(returnType: Type, fnNode: NodeMap['fn']): Type {
		const stmts = fnNode.statements ?? [];
		if (
			stmts.length === 0 ||
			returnType.kind !== 'type' ||
			returnType.family !== 'unknown'
		)
			return returnType;
		for (let i = 0; i < stmts.length - 1; i++)
			if (stmts[i]?.kind === 'next') return returnType;
		const tail = stmts[stmts.length - 1];
		if (!tail) return returnType;
		if (tail.kind === 'next') {
			const v = tail.children?.[0];
			if (!v) return BaseTypes.Void;
			if (v.kind === 'call' && callEmitsSequence(v)) return BaseTypes.Void;
		}
		const fromChecker = fnNode.symbol.returnType;
		if (fromChecker && hasRuntimeValue(fromChecker)) return fromChecker;
		const val = tailReturnValue(tail);
		if (!val || val.kind === '>>') return returnType;
		const inferred = inferType(val);
		if (inferred.kind === 'type' && inferred.family !== 'unknown')
			return inferred;
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
		const { paramTypes, paramMap, tagMap } = buildParamTypes(paramSyms);
		const returnType = resolveFnReturnType(fnNode, typeArgs);
		const resultTypes: number[] = hasRuntimeValue(returnType)
			? wasmTypesOf(returnType)
			: [];
		const builder: FuncBuilder = {
			typeIdx: typeIdx(paramTypes, resultTypes),
			body: [],
			locals: [],
			paramCount: paramTypes.length,
			paramMap,
			tagMap: tagMap.size ? tagMap : undefined,
			returnType,
			callFixups: [],
			blockDepth: 0,
			name: fnNode.symbol.name,
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
		builder.name = defSym.name;
		builder.originLine = fnNode.line + 1;
		if (recordObjects) builder.relocs = [];
		const obj = splice?.objects.get(defSym);
		if (obj) spliceByBuilder.set(builder, obj);
		fnSym.returnType = returnType;
		fnDefBuilderIdx.set(defSym, builderIdx);
		fnDefBuilderIdx.set(fnSym, builderIdx);
		builderSym.set(builderIdx, defSym);
		fnNodeBySym.set(defSym, fnNode);
		fnNodeBySym.set(fnSym, fnNode);
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
	 * Structurally unify a value-param's declared type against the call's
	 * concrete arg type, binding type-param placeholders (by name) to concrete
	 * types. Handles direct params (`x: T`) and nested data (`p: [T, U]`).
	 */

	// Bind type-param placeholders to the call's concrete arg types,
	// mutating each placeholder in place (value params and the return type all
	// reference it); returns the saved originals to restore after body compile.
	function bindTypeParamPlaceholders(
		template: NodeMap['fn'],
		params: NodeMap['parameter'][],
		argTypes: Type[],
		subst: Map<string, Type>,
		bindings: Map<GbcSymbol, SymbolMap['function']>,
	): { ph: object; saved: object }[] {
		const tparams = template.typeParameters ?? [];
		const restorePh: { ph: object; saved: object }[] = [];
		if (!tparams.length) return restorePh;
		const names = new Set(
			tparams.map(tp => tp.symbol.name).filter((n): n is string => !!n),
		);
		params.forEach((p, i) => {
			// A higher-order arg is bound (not passed by value), so its inferred
			// `argType` need not carry the concrete signature. Unify the param's
			// function type against the BOUND fn's parameters/return so a type
			// var appearing only there (e.g. `map`'s `U` in `f: (T): U`) binds.
			const bound = bindings.get(p.symbol);
			const pt = p.symbol.type;
			if (bound && pt?.kind === 'function') {
				const pp = pt.parameters ?? [];
				const bp = bound.parameters ?? [];
				for (let j = 0; j < pp.length; j++)
					unifyTypeParam(pp[j]?.type, bp[j]?.type, names, subst);
				unifyTypeParam(pt.returnType, bound.returnType, names, subst);
				return;
			}
			unifyTypeParam(pt, argTypes[i], names, subst);
		});
		for (const tp of tparams) {
			const ph = tp.symbol.type;
			const concrete = tp.symbol.name
				? subst.get(tp.symbol.name)
				: undefined;
			if (ph?.kind === 'type' && concrete?.kind === 'type') {
				restorePh.push({ ph, saved: { ...ph } });
				setTypeInPlace(ph, concrete);
			}
		}
		return restorePh;
	}

	// A monomorphized return type may reference a type-param placeholder that
	// `getOrCreateSpec` restores to `unknown` after the body compiles. Detach
	// it into a placeholder-free copy so `specReturn` — read by callers later —
	// keeps the concrete element type (e.g. `Buffer<Int32>` for a caller's
	// binding drop-glue), not `Buffer<unknown>`.
	function detachType(t: Type, depth = 0): Type {
		if (t.kind !== 'type' || depth > 8) return t;
		if (t.family === 'data' && t.elem)
			return bufferTypeOf(detachType(t.elem, depth + 1));
		if (t.family === 'unknown') return t;
		return { ...t };
	}

	function getOrCreateSpec(
		template: NodeMap['fn'],
		argTypes: Type[],
		bindings: Map<GbcSymbol, SymbolMap['function']> = new Map(),
	): number {
		const key = specKey(template, argTypes, bindings);
		const cached = specCache.get(key);
		if (cached !== undefined) return cached;
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
		const subst = new Map<string, Type>();
		const restorePh = bindTypeParamPlaceholders(
			template,
			params,
			argTypes,
			subst,
			bindings,
		);
		// Bind each value param to its concrete arg type BEFORE building the
		// function signature, so the param's wasm type uses the actual element
		// type (e.g. f64). A recursive generic mutates the shared type-param
		// placeholder in place and does not restore it before a nested spec is
		// created during body compilation, so the placeholder is unreliable
		// here — the call's argTypes are authoritative. The body also wants the
		// shrunk per-level type; restored from `saved` after the body compiles.
		params.forEach((p, i) => {
			const at = argTypes[i];
			if (at && at.kind === 'type' && p.symbol.type?.kind !== 'function')
				p.symbol.type = at;
		});
		const { builder, builderIdx, returnType } = allocFuncBuilder(
			template,
			subst,
		);
		specReturn.set(builderIdx, detachType(returnType));
		// Register BEFORE compiling the body so recursive calls inside the
		// body resolve to this in-progress spec via the cache.
		specCache.set(key, builderIdx);
		const tplStmts = template.statements ?? [];
		const only = tplStmts.length === 1 ? tplStmts[0] : undefined;
		const valueCallBody =
			only?.kind === 'call' &&
			returnType.kind === 'type' &&
			returnType.family !== 'void' &&
			returnType.family !== 'unknown';
		const seqTemplate =
			!!(template.symbol.flags & Flags.Sequence) && !valueCallBody;
		if (seqTemplate) inTemplateInline++;
		compileFnBody(builder, template);
		if (seqTemplate) inTemplateInline--;
		params.forEach((p, i) => {
			const t = saved[i];
			if (t) p.symbol.type = t;
		});
		for (const { ph, saved: f } of restorePh) setTypeInPlace(ph, f);
		for (const [psym, prev] of prevBindings) {
			if (prev === undefined) fnArgBindings.delete(psym);
			else fnArgBindings.set(psym, prev);
		}
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

	// A direct call whose result types match this fn's is emitted as a
	// WASM tail call (`return_call`), so tail recursion doesn't grow the stack.
	// A body with owned locals to free cannot `return_call` (the callee may
	// borrow them), so it falls back to a plain call + frees + return.
	function tailCallOwnedOk(fn: FuncBuilder): boolean {
		return !(
			fn.owned?.length && !fn.owned.every(o => o.temp || o.paramOwned)
		);
	}

	function tailFnTarget(
		sym: GbcSymbol,
	): { builderIdx: number; fnSym: SymbolMap['function'] } | undefined {
		if (fnArgBindings.has(sym) || fnTemplates.has(sym)) return undefined;
		if (
			sym.kind === 'function' &&
			!!(sym.flags & (Flags.Intrinsic | Flags.External))
		)
			return undefined;
		const builderIdx = fnDefBuilderIdx.get(sym);
		if (builderIdx === undefined) return undefined;
		const fnSym =
			sym.kind === 'function'
				? sym
				: sym.type?.kind === 'function'
					? sym.type
					: undefined;
		if (!fnSym) return undefined;
		return { builderIdx, fnSym };
	}

	function sameWasmShape(a: Type, b: Type): boolean {
		if (isUnknownType(a) || isUnknownType(b)) return false;
		const wa = wasmTypesOf(a);
		const wb = wasmTypesOf(b);
		return wa.length === wb.length && wa.every((x, i) => x === wb[i]);
	}

	function tryTailCall(node: NodeMap['call'], fn: FuncBuilder): boolean {
		if (!tailCallOwnedOk(fn)) return false;
		const callee = node.children[0];
		if (callee.kind !== 'ident') return false;
		const target = tailFnTarget(callee.symbol);
		if (!target) return false;
		const { builderIdx, fnSym } = target;
		if (!sameWasmShape(fnSym.returnType ?? BaseTypes.Void, fn.returnType))
			return false;
		// A fresh heap arg would be orphaned by `return_call` (no frame left
		// to free it). Only self-recursion is worth that trade — a non-self
		// tail call saves one frame, so demote it to a plain call + frees.
		if (
			funcBuilders[builderIdx] !== fn &&
			argListFromCall(node.children[1]).some(x => {
				const xt = inferType(x, fn);
				return (
					xt.kind === 'type' &&
					(xt.family === 'string' || xt.family === 'data') &&
					ownableExpr(x, fn)
				);
			})
		)
			return false;
		// Anonymous arg temps can't be read by the tail call — free them on
		// this path (it exits via return_call, skipping body-end frees).
		// After arg compilation, so temps born in nested calls inside the
		// args are included; the pending args sit beneath on the stack.
		compileCallArgs(node.children[1], fnSym, fn, undefined, true);
		if (fn.owned?.length) emitOwnedFrees(fn);
		emitFixedCall(fn, builderIdx, true);
		return true;
	}

	// A pipe whose final stage is a direct single-param fn call, in tail
	// position (`(n - 1) >> f`). Compiles the input to the last stage as a value,
	// then `return_call`s the stage fn — so recursion through a pipe stays flat.
	function tryTailPipe(node: NodeMap['>>'], fn: FuncBuilder): boolean {
		if (!tailCallOwnedOk(fn)) return false;
		const flat = flattenPipe(node.children);
		if (flat.length !== 2) return false;
		const source = flat[0];
		const last = flat[1];
		if (!source || !last || last.kind !== 'ident') return false;
		const target = tailFnTarget(last.symbol);
		if (!target) return false;
		const { builderIdx, fnSym } = target;
		const params = fnSym.parameters ?? [];
		if (params.length !== 1) return false;
		if (!sameWasmShape(fnSym.returnType ?? BaseTypes.Void, fn.returnType))
			return false;
		const st = inferType(source, fn);
		if (
			funcBuilders[builderIdx] !== fn &&
			st.kind === 'type' &&
			(st.family === 'string' || st.family === 'data') &&
			ownableExpr(source, fn)
		)
			return false;
		const at = compileExpr(source, fn);
		if (fn.owned?.length) emitOwnedFrees(fn);
		maybeUpcastAdjust(at, params[0]?.type, fn);
		emitFixedCall(fn, builderIdx, true);
		return true;
	}

	// Compile `node` as the function's tail/return: emits `return_call` for a
	// tail call, recurses into `next` and ternary branches, otherwise
	// leaves the return value on the stack. Returns true when the compiled
	// path exits via `return_call` (it never falls through) — ownership
	// bookkeeping only merges the states of branches that can fall through.
	// The fall-through owned state after a tail ternary: a branch that exits
	// via `return_call` imposes no constraint, so the survivors are what the
	// falling-through branches agree on (their intersection).
	function mergeOwnedTail(
		b1: { exits: boolean; after: FuncBuilder['owned'] },
		b2: { exits: boolean; after: FuncBuilder['owned'] },
	): FuncBuilder['owned'] {
		if (b1.exits) return b2.after;
		if (b2.exits) return b1.after;
		const a1 = b1.after;
		const a2 = b2.after;
		return a1 && a2 ? a1.filter(o => a2.includes(o)) : undefined;
	}

	function scalarTernaryTail(
		cond: Node,
		thenB: Node,
		elseB: Node,
		rt: Type,
		fn: FuncBuilder,
	): boolean {
		compileExpr(cond, fn);
		fn.body.push(OP_IF);
		fn.body.push(gbcToWasm(rt));
		fn.blockDepth++;
		// Ownership releases are per-path: each branch compiles against
		// its own view of the owned list. The shared fallthrough keeps
		// what the falling-through branches agree on (a `return_call`
		// branch never reaches it, so its releases don't count).
		const snap = fn.owned ? [...fn.owned] : undefined;
		const exits1 = compileTail(thenB, fn);
		const after1 = fn.owned;
		fn.owned = snap ? [...snap] : undefined;
		fn.body.push(OP_ELSE);
		const exits2 = compileTail(elseB, fn);
		fn.owned = mergeOwnedTail({ exits: exits1, after: after1 }, { exits: exits2, after: fn.owned });
		fn.body.push(OP_END);
		fn.blockDepth--;
		return exits1 && exits2;
	}

	// Union-return ternary in tail position. WASM `if` can't yield the
	// union's two-value `[payload][tag]` shape via a single block type, so we
	// route each branch through scratch locals (mirrors the value-context
	// path in `compileTernary`). Recursing per branch lets a branch that ends
	// in a tail call emit `return_call` instead of stacking; a non-tail branch
	// stores its (coerced) union value into the locals, which are reloaded
	// after the block to become the function's return.
	function unionTernaryTail(
		cond: Node,
		thenB: Node,
		elseB: Node,
		rt: Type,
		fn: FuncBuilder,
	): boolean {
		const payloadLocal = allocLocal(fn, unionPayloadWasm(rt));
		const tagLocal = allocLocal(fn, I32);
		const emitBranch = (branch: Node): boolean => {
			if (branch.kind === 'call' && tryTailCall(branch, fn)) return true;
			if (branch.kind === '>>' && tryTailPipe(branch, fn)) return true;
			const t = compileExpr(branch, fn);
			if (!hasRuntimeValue(t)) return false;
			if (!isUnionType(t)) coerceToUnion(t, rt, fn);
			fn.body.push(OP_LOCAL_SET);
			uleb128(tagLocal, fn.body);
			fn.body.push(OP_LOCAL_SET);
			uleb128(payloadLocal, fn.body);
			return false;
		};
		compileExpr(cond, fn);
		fn.body.push(OP_IF);
		fn.body.push(0x40);
		fn.blockDepth++;
		const snap = fn.owned ? [...fn.owned] : undefined;
		const exits1 = emitBranch(thenB);
		const after1 = fn.owned;
		fn.owned = snap ? [...snap] : undefined;
		fn.body.push(OP_ELSE);
		const exits2 = emitBranch(elseB);
		fn.owned = mergeOwnedTail({ exits: exits1, after: after1 }, { exits: exits2, after: fn.owned });
		fn.body.push(OP_END);
		fn.blockDepth--;
		fn.body.push(OP_LOCAL_GET);
		uleb128(payloadLocal, fn.body);
		fn.body.push(OP_LOCAL_GET);
		uleb128(tagLocal, fn.body);
		return exits1 && exits2;
	}

	function compileTail(node: Node, fn: FuncBuilder): boolean {
		stampErrorData(node, fn.returnType);
		if (node.kind === 'next') {
			const v = node.children?.[0];
			if (v) return compileTail(v, fn);
			return false;
		}
		const rt = fn.returnType;
		const alt = node.kind === '?' ? node.children[2] : undefined;
		if (node.kind === '?' && alt && hasRuntimeValue(rt) && !isUnionType(rt))
			return scalarTernaryTail(node.children[0], node.children[1], alt, rt, fn);
		if (node.kind === '?' && alt && isUnionType(rt))
			return unionTernaryTail(node.children[0], node.children[1], alt, rt, fn);
		if (node.kind === 'call' && tryTailCall(node, fn)) return true;
		if (node.kind === '>>' && tryTailPipe(node, fn)) return true;
		releaseTailOwned(fn, node);
		const t = compileExpr(node, fn);
		if (!hasRuntimeValue(rt)) {
			if (hasRuntimeValue(t)) {
				fn.body.push(OP_DROP);
				if (isUnionType(t)) fn.body.push(OP_DROP);
			}
		} else if (isUnionType(rt) && !isUnionType(t) && hasRuntimeValue(t)) {
			coerceToUnion(t, rt, fn);
		} else coerceIntWidth(t, rt, fn);
		return false;
	}

	function compileFnBody(builder: FuncBuilder, fnNode: NodeMap['fn']) {
		inliningStages.add(fnNode.symbol);
		try {
			const ownedIn = ownedInParams.get(fnNode.symbol);
			if (ownedIn) {
				const params = fnNode.parameters ?? [];
				for (let i = 0; i < params.length; i++) {
					const p = params[i];
					if (!p || !ownedIn[i]) continue;
					// Only heap params carry drop-glue. A type-param value slot
					// (e.g. `push`'s embedded `x: T`) is owned-in on the template
					// but monomorphizes to a scalar in some specs — freeing that
					// would treat a number as a pointer, so gate on the concrete
					// element type here.
					const pt = p.symbol.type;
					if (
						pt?.kind !== 'type' ||
						(pt.family !== 'string' && pt.family !== 'data')
					)
						continue;
					const localIdx = builder.paramMap.get(p.symbol);
					if (localIdx === undefined) continue;
					(builder.owned ??= []).push({
						sym: p.symbol,
						localIdx,
						type: p.symbol.type,
						paramOwned: true,
					});
				}
			}
			const stmts = fnNode.statements ?? [];
			if (stmts.length === 1 && stmts[0]?.kind === 'next') {
				compileTail(stmts[0], builder);
				emitOwnedFrees(builder);
				return;
			}
			for (let i = 0; i < stmts.length; i++) {
				const stmt = stmts[i];
				if (!stmt) continue;
				if (i === stmts.length - 1) {
					compileTail(stmt, builder);
					continue;
				}
				const t = compileExpr(stmt, builder);
				if (hasRuntimeValue(t)) {
					builder.body.push(OP_DROP);
					if (isUnionType(t)) builder.body.push(OP_DROP);
				}
			}
			emitOwnedFrees(builder);
		} finally {
			inliningStages.delete(fnNode.symbol);
		}
	}

	function initNumberGlobal(
		value: NodeMap['number'],
		declaredType: Type | undefined,
	): { initBuf: number[]; wasmType: number; valueType: Type } {
		const initBuf: number[] = [];
		let valueType: Type = value.float ? BaseTypes.Float64 : BaseTypes.Int32;
		if (declaredType && isFloatType(declaredType)) {
			valueType = declaredType;
			initBuf.push(OP_F64_CONST);
			f64le(Number(value.value), initBuf);
			return { initBuf, wasmType: F64, valueType };
		}
		if (isFloatType(valueType)) {
			initBuf.push(OP_F64_CONST);
			f64le(Number(value.value), initBuf);
			return { initBuf, wasmType: F64, valueType };
		}
		const raw = value.value;
		const fitsI32 =
			typeof raw === 'number' && raw >= -0x80000000 && raw <= 0x7fffffff;
		if (!fitsI32 || isInt64Type(declaredType)) {
			valueType = isInt64Type(declaredType)
				? (declaredType ?? BaseTypes.Int64)
				: numberLiteralType(raw);
			initBuf.push(OP_I64_CONST);
			const v = BigInt(raw);
			sleb128big(v >= 1n << 63n ? v - (1n << 64n) : v, initBuf);
			return { initBuf, wasmType: I64, valueType };
		}
		if (declaredType?.kind === 'type' && isIntType(declaredType))
			valueType = declaredType;
		initBuf.push(OP_I32_CONST);
		sleb128(raw | 0, initBuf);
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
					f64le(Number(idSym.value), initBuf);
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
		if (isInt64Type(inferred)) {
			initBuf.push(OP_I64_CONST);
			sleb128(0, initBuf);
			return { initBuf, wasmType: I64, valueType: inferred };
		}
		initBuf.push(OP_I32_CONST);
		sleb128(0, initBuf);
		return { initBuf, wasmType: I32, valueType: inferred };
	}

	function compileTopLevelDef(node: NodeMap['def']) {
		const sym = node.symbol;
		const value = node.value;
		if (value.kind === 'fn') return;
		// A static namespace (fn-member record, incl. module binds) has no
		// runtime value — member calls compile direct.
		if (value.kind === 'data' || value.kind === 'ident') {
			const st = sym.type;
			if (st?.kind === 'type' && st.family === 'data') {
				const ms = Object.values(st.members);
				if (ms.length > 0 && ms.every(m => m.type?.kind === 'function')) return;
			}
		}
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
		computeOwnedInParams(root);
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

	function runtimeBuilderName(idx: number): string | undefined {
		if (idx === allocBuilderIdx) return '__alloc';
		if (idx === streqBuilderIdx) return '__streq';
		if (idx === freeBuilderIdx) return '__free';
		if (debugBuild && idx === captureBuilderIdx) return '__capture';
		return undefined;
	}
	function runtimeBuilderIdx(rt: string): number | undefined {
		if (rt === '__alloc') return allocBuilderIdx;
		if (rt === '__streq') return streqBuilderIdx;
		if (rt === '__free') return freeBuilderIdx;
		if (rt === '__capture' && debugBuild) return captureBuilderIdx;
		return undefined;
	}

	function spliceObject(builder: FuncBuilder, obj: SerialObject) {
		builder.body = [...obj.code];
		builder.locals = [...obj.locals];
		builder.callFixups = [];
		for (const r of obj.relocs) {
			if (r.kind === 'data')
				patchFixed5(builder.body, r.offset, intern(r.str));
			else if (r.kind === 'tag')
				patchFixed5(builder.body, r.offset, memberTagByKey(r.key));
			else if (r.kind === 'global') {
				const sym = splice?.resolveRef(r.ref);
				const g = sym && globalIdx.get(sym);
				if (g === undefined)
					throw new Error(
						`splice: unresolved global "${r.ref.name}"`,
					);
				patchFixed5(builder.body, r.offset, g);
			} else if (r.kind === 'call') {
				const sym = splice?.resolveRef(r.ref);
				const bi = sym !== undefined ? fnDefBuilderIdx.get(sym) : undefined;
				if (bi === undefined)
					throw new Error(`splice: unresolved call "${r.ref.name}"`);
				builder.callFixups.push({
					offset: r.offset,
					builderIdx: bi,
					size: 5,
				});
			} else {
				const bi = runtimeBuilderIdx(r.rt);
				if (bi === undefined)
					throw new Error(`splice: unknown runtime "${r.rt}"`);
				builder.callFixups.push({
					offset: r.offset,
					builderIdx: bi,
					size: 5,
				});
			}
		}
	}

	function collectLibraryObjects(sink: LibraryObject[]) {
		for (const [builderIdx, sym] of builderSym) {
			const b = funcBuilders[builderIdx];
			if (!b?.relocs || b.relocTainted) continue;
			// An owned-in param's contract is whole-program: this build marked it
			// owned (its wasm frees the param) because every call site here feeds
			// it fresh, but a consumer could add a call site that doesn't — its
			// re-derived owned-in would then disagree with the baked free. Leave
			// such fns as IR so the consumer derives the contract consistently.
			if (ownedInParams.get(sym)?.some(Boolean)) continue;
			const relocs: ObjReloc[] = [...b.relocs];
			let ok = true;
			for (const fix of b.callFixups) {
				const rt = runtimeBuilderName(fix.builderIdx);
				if (rt) {
					relocs.push({ kind: 'callrt', offset: fix.offset, rt });
					continue;
				}
				const callee = builderSym.get(fix.builderIdx);
				if (!callee) {
					ok = false;
					break;
				}
				relocs.push({ kind: 'call', offset: fix.offset, sym: callee });
			}
			const t = types[b.typeIdx];
			if (!ok || !t) continue;
			relocs.sort((x, y) => x.offset - y.offset);
			sink.push({
				sym,
				params: [...t.params],
				results: [...t.results],
				locals: [...b.locals],
				code: [...b.body],
				relocs,
			});
		}
	}

	function compileBodies(
		fns: { builder: FuncBuilder; fnNode: NodeMap['fn'] }[],
	) {
		for (const { builder, fnNode } of fns) {
			const obj = spliceByBuilder.get(builder);
			if (obj) {
				spliceObject(builder, obj);
				continue;
			}
			const before = internCalls;
			compileFnBody(builder, fnNode);
			if (builder.relocs && !builder.relocTainted) {
				const dataRelocs = builder.relocs.filter(
					r => r.kind === 'data',
				).length;
				if (internCalls - before > dataRelocs) builder.relocTainted = true;
			}
		}
		if (objectSink) collectLibraryObjects(objectSink);
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
			else coerceIntWidth(t, init.expectedType, mainBuilder);
			mainBuilder.body.push(OP_GLOBAL_SET);
			uleb128(init.gIdx, mainBuilder.body);
		}
	}

	function compileTopLevelStatements(mainBuilder: FuncBuilder) {
		if (root.kind !== 'root') return;
		if (testMode) {
			for (const child of root.children) {
				if (child.kind !== 'test') continue;
				for (const stmt of child.statements)
					compileMainStatement(stmt, mainBuilder);
			}
			return;
		}
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

	compileBodies(declareTopLevel());

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
		name: 'main',
	};
	const mainBuilderIdx = funcBuilders.length;
	funcBuilders.push(mainBuilder);

	compileRuntimeInits(mainBuilder);
	compileTopLevelStatements(mainBuilder);

	if (debugBuild) {
		// __capture(origin): count = entries/4 + 1; block = [count][origin][
		// shadow entries base..sp]. Reads only globals, so it can be written
		// before the static layout is final.
		const C = captureBuilder.body;
		C.push(OP_GLOBAL_GET);
		uleb128(shadowSpIdx, C);
		C.push(OP_GLOBAL_GET);
		uleb128(shadowBaseIdx, C);
		C.push(OP_I32_SUB);
		C.push(OP_LOCAL_SET, 1);
		C.push(OP_LOCAL_GET, 1, OP_I32_CONST, 8, OP_I32_ADD);
		emitFixedCall(captureBuilder, allocBuilderIdx);
		C.push(OP_LOCAL_SET, 2);
		C.push(OP_LOCAL_GET, 2);
		C.push(OP_LOCAL_GET, 1, OP_I32_CONST, 2, 0x76); // entries/4
		C.push(OP_I32_CONST, 1, OP_I32_ADD);
		C.push(OP_I32_STORE);
		uleb128(2, C);
		uleb128(0, C);
		C.push(OP_LOCAL_GET, 2);
		C.push(OP_LOCAL_GET, 0);
		C.push(OP_I32_STORE);
		uleb128(2, C);
		uleb128(4, C);
		C.push(OP_LOCAL_GET, 2, OP_I32_CONST, 8, OP_I32_ADD);
		C.push(OP_GLOBAL_GET);
		uleb128(shadowBaseIdx, C);
		C.push(OP_LOCAL_GET, 1);
		C.push(0xfc, 0x0a, 0x00, 0x00); // memory.copy
		C.push(OP_LOCAL_GET, 2);
	}

	// Phase 5: resolve funcidx fixups
	const baseFuncIdx = imports.length;
	resolveCallFixups(baseFuncIdx);
	const mainFuncIdx = baseFuncIdx + mainBuilderIdx;

		const shadowBase = (heap + 7) & ~7;
		const heapStart = debugBuild ? shadowBase + SHADOW_BYTES : shadowBase;
		if (debugBuild) {
			const patch = (idx: number, v: number) => {
				const g = globals[idx];
				if (!g) return;
				const init: number[] = [OP_I32_CONST];
				sleb128(v, init);
				g.init = init;
			};
			patch(shadowSpIdx, shadowBase);
			patch(shadowBaseIdx, shadowBase);
			patch(shadowLimitIdx, shadowBase + SHADOW_BYTES);
		}
		const heapGlobalIdx = globals.length;
		const heapInit: number[] = [OP_I32_CONST];
		sleb128(heapStart, heapInit);
		globals.push({ type: I32, mutable: true, init: heapInit });
		const freeHeadIdx = globals.length;
		globals.push({ type: I32, mutable: true, init: [OP_I32_CONST, 0] });
		// __alloc(n): each block carries a hidden capacity word at ptr-4,
		// written once — it survives reuse cycles. The ask is aligned to 4
		// with a minimum of 8 up front (a freed block stores its free-list
		// link at ptr+4). First-fit walk of the free list; a hit whose
		// capacity leaves room for a standalone remainder (header + 8) is
		// SPLIT — the tail re-enters the list in place, so coalesced runs
		// serve many asks instead of vanishing into the first. On a miss,
		// bump (+4 for the capacity word), growing memory on demand; OOM
		// traps.
		// locals: 1=cur 2=prev 3=cap 4=rem
		allocBuilder.locals.push(I32, I32, I32, I32);
		const A = allocBuilder.body;
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_CONST, 3, OP_I32_ADD);
		A.push(OP_I32_CONST, 0x7c, OP_I32_AND);
		A.push(OP_LOCAL_SET, 0);
		A.push(OP_I32_CONST, 8);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_CONST, 8);
		A.push(0x48); // i32.lt_s
		A.push(0x1b); // select
		A.push(OP_LOCAL_SET, 0);
		A.push(OP_GLOBAL_GET);
		uleb128(freeHeadIdx, A);
		A.push(OP_LOCAL_SET, 1); // cur
		A.push(OP_I32_CONST, 0);
		A.push(OP_LOCAL_SET, 2); // prev
		A.push(OP_BLOCK, 0x40);
		A.push(OP_LOOP, 0x40);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_EQZ);
		A.push(OP_BR_IF, 1); // list exhausted
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_CONST, 4, OP_I32_SUB);
		A.push(OP_I32_LOAD);
		uleb128(2, A);
		uleb128(0, A);
		A.push(OP_LOCAL_SET, 3); // cap
		A.push(OP_LOCAL_GET, 3);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_GE_S);
		A.push(OP_IF, 0x40);
		A.push(OP_LOCAL_GET, 3);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_CONST, 12, OP_I32_ADD);
		A.push(OP_I32_GE_S);
		A.push(OP_IF, 0x40);
		// split: front keeps the ask, the remainder re-enters in place
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_CONST, 4, OP_I32_SUB);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(0, A);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_ADD);
		A.push(OP_I32_CONST, 4, OP_I32_ADD);
		A.push(OP_LOCAL_SET, 4); // rem
		A.push(OP_LOCAL_GET, 4);
		A.push(OP_I32_CONST, 4, OP_I32_SUB);
		A.push(OP_LOCAL_GET, 3);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_SUB);
		A.push(OP_I32_CONST, 4, OP_I32_SUB);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(0, A);
		A.push(OP_LOCAL_GET, 4);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_LOAD);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_LOCAL_GET, 2);
		A.push(OP_IF, 0x40);
		A.push(OP_LOCAL_GET, 2);
		A.push(OP_LOCAL_GET, 4);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_ELSE);
		A.push(OP_LOCAL_GET, 4);
		A.push(OP_GLOBAL_SET);
		uleb128(freeHeadIdx, A);
		A.push(OP_END);
		A.push(OP_ELSE);
		// whole-block unlink
		A.push(OP_LOCAL_GET, 2);
		A.push(OP_IF, 0x40);
		A.push(OP_LOCAL_GET, 2);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_LOAD);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_ELSE);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_LOAD);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_GLOBAL_SET);
		uleb128(freeHeadIdx, A);
		A.push(OP_END);
		A.push(OP_END);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_RETURN);
		A.push(OP_END);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_LOCAL_SET, 2);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_I32_LOAD);
		uleb128(2, A);
		uleb128(4, A);
		A.push(OP_LOCAL_SET, 1);
		A.push(OP_BR, 0); // continue walk
		A.push(OP_END);
		A.push(OP_END);
		A.push(OP_GLOBAL_GET);
		uleb128(heapGlobalIdx, A);
		A.push(OP_I32_CONST, 4, OP_I32_ADD);
		A.push(OP_LOCAL_SET, 1);
		A.push(OP_LOCAL_GET, 1);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_ADD);
		A.push(OP_LOCAL_SET, 2);
		A.push(OP_LOCAL_GET, 2);
		A.push(0x3f, 0x00); // memory.size
		A.push(OP_I32_CONST, 16, OP_I32_SHL);
		A.push(0x4b); // i32.gt_u
		A.push(OP_IF, 0x40);
		A.push(OP_LOCAL_GET, 2);
		A.push(0x3f, 0x00);
		A.push(OP_I32_CONST, 16, OP_I32_SHL);
		A.push(OP_I32_SUB);
		A.push(OP_I32_CONST);
		sleb128(65535, A);
		A.push(OP_I32_ADD);
		A.push(OP_I32_CONST, 16, 0x76); // i32.shr_u
		A.push(0x40, 0x00); // memory.grow
		A.push(OP_I32_CONST, 0x7f); // -1
		A.push(OP_I32_EQ);
		A.push(OP_IF, 0x40);
		A.push(0x00); // unreachable
		A.push(OP_END);
		A.push(OP_END);
		// Grow settled — only now is the capacity-word store in bounds.
		A.push(OP_GLOBAL_GET);
		uleb128(heapGlobalIdx, A);
		A.push(OP_LOCAL_GET, 0);
		A.push(OP_I32_STORE);
		uleb128(2, A);
		uleb128(0, A);
		A.push(OP_LOCAL_GET, 2);
		A.push(OP_GLOBAL_SET);
		uleb128(heapGlobalIdx, A);
		A.push(OP_LOCAL_GET, 1);
		// __free(ptr): address-ordered insert with coalescing (next link at
		// ptr+4; the capacity word at ptr-4 stays intact). A block spans
		// [p-4, p+cap), so the block q just above is adjacent iff
		// q == p + cap + 4 — merging absorbs its header too (+4). Merging
		// both ways keeps the list short and lets monotonically growing
		// requests reuse the coalesced run instead of bumping forever.
		// Static pointers (interned literals live below heapStart) are a
		// no-op, so freeing a fresh-or-static value is always safe.
		// locals: 1=cap 2=prev 3=cur
		freeBuilder.locals.push(I32, I32);
		const F = freeBuilder.body;
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_I32_CONST);
		sleb128(heapStart, F);
		F.push(0x49); // i32.lt_u
		F.push(OP_IF, 0x40, OP_RETURN, OP_END);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_LOCAL_SET, 1); // cap
		F.push(OP_I32_CONST, 0);
		F.push(OP_LOCAL_SET, 2); // prev
		F.push(OP_GLOBAL_GET);
		uleb128(freeHeadIdx, F);
		F.push(OP_LOCAL_SET, 3); // cur
		// walk to the insertion point: first node at or above p
		F.push(OP_BLOCK, 0x40);
		F.push(OP_LOOP, 0x40);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_EQZ);
		F.push(OP_BR_IF, 1);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_LOCAL_GET, 0);
		F.push(0x4f); // i32.ge_u
		F.push(OP_BR_IF, 1);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_LOCAL_SET, 2);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(4, F);
		F.push(OP_LOCAL_SET, 3);
		F.push(OP_BR, 0);
		F.push(OP_END);
		F.push(OP_END);
		// absorb the successor when adjacent
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_IF, 0x40);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_LOCAL_GET, 1);
		F.push(OP_I32_ADD);
		F.push(OP_I32_CONST, 4, OP_I32_ADD);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_EQ);
		F.push(OP_IF, 0x40);
		F.push(OP_LOCAL_GET, 1);
		F.push(OP_I32_CONST, 4, OP_I32_ADD);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_I32_ADD);
		F.push(OP_LOCAL_SET, 1);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_LOCAL_GET, 1);
		F.push(OP_I32_STORE);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(4, F);
		F.push(OP_LOCAL_SET, 3);
		F.push(OP_END);
		F.push(OP_END);
		// p.next = cur (the possibly-absorbed successor's next)
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_STORE);
		uleb128(2, F);
		uleb128(4, F);
		// absorb into the predecessor when adjacent, else link after it
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_IF, 0x40);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_I32_ADD);
		F.push(OP_I32_CONST, 4, OP_I32_ADD);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_I32_EQ);
		F.push(OP_IF, 0x40);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_I32_CONST, 4, OP_I32_SUB);
		F.push(OP_I32_LOAD);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_I32_CONST, 4, OP_I32_ADD);
		F.push(OP_LOCAL_GET, 1);
		F.push(OP_I32_ADD);
		F.push(OP_I32_STORE);
		uleb128(2, F);
		uleb128(0, F);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_LOCAL_GET, 3);
		F.push(OP_I32_STORE);
		uleb128(2, F);
		uleb128(4, F);
		F.push(OP_RETURN);
		F.push(OP_END);
		F.push(OP_LOCAL_GET, 2);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_I32_STORE);
		uleb128(2, F);
		uleb128(4, F);
		F.push(OP_RETURN);
		F.push(OP_END);
		F.push(OP_LOCAL_GET, 0);
		F.push(OP_GLOBAL_SET);
		uleb128(freeHeadIdx, F);
		const allocFuncIdx = baseFuncIdx + allocBuilderIdx;

		const sq = streqBuilder.body;
		sq.push(OP_LOCAL_GET, 0, OP_LOCAL_GET, 1, OP_I32_EQ);
		sq.push(OP_IF, 0x40, OP_I32_CONST, 1, OP_RETURN, OP_END);
		sq.push(OP_LOCAL_GET, 0, OP_I32_LOAD, 2, 0, OP_LOCAL_SET, 2);
		sq.push(OP_LOCAL_GET, 1, OP_I32_LOAD, 2, 0, OP_LOCAL_GET, 2, OP_I32_NE);
		sq.push(OP_IF, 0x40, OP_I32_CONST, 0, OP_RETURN, OP_END);
		sq.push(OP_I32_CONST, 0, OP_LOCAL_SET, 3);
		sq.push(OP_LOOP, 0x40);
		sq.push(OP_LOCAL_GET, 3, OP_LOCAL_GET, 2, OP_I32_GE_S);
		sq.push(OP_IF, 0x40, OP_I32_CONST, 1, OP_RETURN, OP_END);
		sq.push(OP_LOCAL_GET, 0, OP_LOCAL_GET, 3, OP_I32_ADD, 0x2d, 0, 8);
		sq.push(OP_LOCAL_GET, 1, OP_LOCAL_GET, 3, OP_I32_ADD, 0x2d, 0, 8);
		sq.push(OP_I32_NE);
		sq.push(OP_IF, 0x40, OP_I32_CONST, 0, OP_RETURN, OP_END);
		sq.push(OP_LOCAL_GET, 3, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 3);
		sq.push(OP_BR, 0, OP_END, 0x00);

	// Main-less builds export the entry's exported fns and run the
	// top-level inits from the wasm start section instead.
	const exportEntries: Module['exports'] = [
		{ name: 'memory', kind: EXTERNAL_MEMORY, idx: 0 },
		{ name: '__alloc', kind: EXTERNAL_FUNC, idx: allocFuncIdx },
	];
	let startIdx: number | undefined;
	if (hostExports) {
		mainBuilder.name = '__start';
		startIdx = mainFuncIdx;
		for (const def of hostExports) {
			const name = def.symbol.name;
			if (!name) continue;
			const builderIdx =
				fnDefBuilderIdx.get(def.symbol) ??
				(def.value.kind === 'fn'
					? fnDefBuilderIdx.get(def.value.symbol)
					: undefined);
			if (builderIdx === undefined)
				throw new Error(
					`"${name}" cannot be exported to the host — generic and dispatch functions have no single wasm signature`,
				);
			exportEntries.push({
				name,
				kind: EXTERNAL_FUNC,
				idx: baseFuncIdx + builderIdx,
			});
		}
	} else {
		exportEntries.unshift({
			name: 'main',
			kind: EXTERNAL_FUNC,
			idx: mainFuncIdx,
		});
	}

	const m: Module = {
		types,
		imports,
		functions: funcBuilders.map(b => ({
			typeIdx: b.typeIdx,
			body: b.body,
			locals: b.locals,
			name: b.name,
		})),
		globals,
		memoryPages: 1,
		exports: exportEntries,
		start: startIdx,
		datas,
	};

	return emitModule(m);
}

function isHexDigit(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	return (
		(ch >= '0' && ch <= '9') ||
		(ch >= 'a' && ch <= 'f') ||
		(ch >= 'A' && ch <= 'F')
	);
}

// Decode the WASM string-escape set: `\t \n \r \" \' \\`, `\u{N}` (codepoint),
// and `\HH` (exactly two hex digits = one byte). Any other escape is an error.
function decodeEscapes(s: string): string {
	// Line breaks normalize to `\n` before escapes decode (LF, CRLF, and lone
	// CR alike), so string content is independent of the source file's
	// line-ending style; an explicit `\r` escape survives.
	s = s.replace(/\r\n?/g, '\n');
	let out = '';
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (ch !== '\\') {
			out += ch;
			i++;
			continue;
		}
		const next = s[i + 1];
		const simple: Record<string, string> = {
			n: '\n',
			r: '\r',
			t: '\t',
			'\\': '\\',
			"'": "'",
			'"': '"',
			$: '$',
		};
		if (next !== undefined && next in simple) {
			out += simple[next];
			i += 2;
		} else if (next === 'u' && s[i + 2] === '{') {
			const end = s.indexOf('}', i + 3);
			if (end < 0) throw new Error('Invalid `\\u{...}` escape');
			out += String.fromCodePoint(parseInt(s.slice(i + 3, end), 16));
			i = end + 1;
		} else if (isHexDigit(next) && isHexDigit(s[i + 2])) {
			out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
			i += 3;
		} else throw new Error(`Invalid string escape "\\${next ?? ''}"`);
	}
	return out;
}
