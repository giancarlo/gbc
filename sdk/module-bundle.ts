import { astChildNodes } from './ast.js';
import type { AstContext, AstNode, AstNodeMap } from './ast.js';

declare class TextEncoder {
	constructor();
	encode(data: string): Uint8Array;
}
declare class TextDecoder {
	constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
	decode(input: Uint8Array): string;
}

const MAGIC = 0x4742_4d01;

export enum ModuleTag {
	Null = 0,
	Int = 1,
	Float = 2,
	Str = 3,
	True = 4,
	False = 5,
	Big = 6,
	Ref = 7,
	Ext = 8,
	Arr = 9,
	Mod = 10,
	TypeExt = 11,
	TypeMod = 12,
}

class Writer {
	private buf = new Uint8Array(1024);
	private len = 0;
	private pool = new Map<string, number>();
	private strings: string[] = [];
	private enc = new TextEncoder();

	u8(n: number) {
		this.ensure(1);
		this.buf[this.len++] = n & 0xff;
	}
	varint(n: number) {
		if (!Number.isInteger(n) || n < 0) throw new Error('gbm: invalid unsigned integer');
		while (n >= 128) {
			this.u8((n & 0x7f) | 0x80);
			n = Math.floor(n / 128);
		}
		this.u8(n);
	}
	f64(n: number) {
		this.ensure(8);
		new DataView(this.buf.buffer).setFloat64(this.len, n, true);
		this.len += 8;
	}
	str(s: string) {
		let idx = this.pool.get(s);
		if (idx === undefined) {
			idx = this.strings.length;
			this.pool.set(s, idx);
			this.strings.push(s);
		}
		this.varint(idx);
	}
	finish(): Uint8Array {
		const head = new Writer();
		head.varint(MAGIC);
		head.varint(this.strings.length);
		for (const s of this.strings) {
			const bytes = head.enc.encode(s);
			head.varint(bytes.length);
			head.rawBytes(bytes);
		}
		const out = new Uint8Array(head.len + this.len);
		out.set(head.buf.subarray(0, head.len));
		out.set(this.buf.subarray(0, this.len), head.len);
		return out;
	}

	private ensure(n: number) {
		if (this.len + n <= this.buf.length) return;
		let cap = this.buf.length * 2;
		while (cap < this.len + n) cap *= 2;
		const next = new Uint8Array(cap);
		next.set(this.buf);
		this.buf = next;
	}
	private rawBytes(b: Uint8Array) {
		this.ensure(b.length);
		this.buf.set(b, this.len);
		this.len += b.length;
	}
}

class Reader {
	private pos = 0;
	private strings: string[];
	private dec = new TextDecoder(undefined, { fatal: true, ignoreBOM: true });
	constructor(private buf: Uint8Array) {
		if (this.varint() !== MAGIC) throw new Error('not a .gbm bundle');
		const n = this.varint();
		this.strings = [];
		for (let i = 0; i < n; i++) {
			const len = this.varint();
			if (len > this.buf.length - this.pos) throw new Error('gbm: truncated string');
			this.strings.push(this.dec.decode(this.buf.subarray(this.pos, this.pos + len)));
			this.pos += len;
		}
	}
	u8(): number {
		const b = this.buf[this.pos++];
		if (b === undefined) throw new Error('gbm: unexpected end of input');
		return b;
	}
	varint(): number {
		const first = this.u8();
		if (first < 0x80) return first;
		let value = first & 0x7f;
		let multiplier = 128;
		let byte = this.u8();
		while (byte >= 0x80) {
			value += (byte & 0x7f) * multiplier;
			multiplier *= 128;
			byte = this.u8();
		}
		value += byte * multiplier;
		if (byte === 0 || !Number.isFinite(value)) throw new Error('gbm: invalid integer');
		return value;
	}
	f64(): number {
		const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength).getFloat64(
			this.pos,
			true,
		);
		this.pos += 8;
		return v;
	}
	finish() {
		if (this.pos !== this.buf.length) throw new Error('gbm: trailing bytes');
	}
	str(): string {
		const s = this.strings[this.varint()];
		if (s === undefined) throw new Error('gbm: bad string index');
		return s;
	}
}

export type ModuleValue =
	| { t: ModuleTag.Null | ModuleTag.True | ModuleTag.False }
	| { t: ModuleTag.Int; n: number; float?: true }
	| { t: ModuleTag.Str | ModuleTag.Big; s: string }
	| { t: ModuleTag.Ext | ModuleTag.TypeExt; s: string }
	| { t: ModuleTag.Ref; r: number }
	| { t: ModuleTag.Mod | ModuleTag.TypeMod; h: string; s: string }
	| { t: ModuleTag.Arr; a: ModuleValue[] };

enum Wire {
	Null,
	Int,
	Float,
	Str,
	True,
	False,
	Big,
	Ref,
	Ext,
	Arr,
	Mod,
	TypeExt,
	TypeMod,
	RefArr,
}

interface Shape {
	node: boolean;
	kind?: string;
	fields: { key: string; wire: Wire }[];
}

interface ShapeTrie {
	children: Map<string, ShapeTrie>;
	id?: number;
}

export function createModuleGraph(
	m: { path: string; hash: string; root: AstNode },
	options?: {
		reference?(value: object, fields: [string, unknown][]): ModuleReference | undefined;
		fields?(value: object, fields: [string, unknown][], node: boolean): [string, unknown][];
	},
): ModuleGraph {
	const values: ModuleValue[][] = [];
	const shapes: Shape[] = [];
	const shapeIds: number[] = [];
	const shapeRoot: ShapeTrie = { children: new Map() };
	const index = new Map<object, number>();
	const moduleNodes = new Set<object>();
	const collectNode = (node: AstNode | undefined): void => {
		if (!node || moduleNodes.has(node)) return;
		moduleNodes.add(node);
		for (const child of astChildNodes(node)) collectNode(child);
	};
	collectNode(m.root);
	const shapeOf = (
		node: boolean,
		kind: string | undefined,
		fields: { key: string; wire: Wire }[],
	): number => {
		let shape = shapeRoot;
		const descend = (part: string) => {
			let child = shape.children.get(part);
			if (!child) {
				child = { children: new Map() };
				shape.children.set(part, child);
			}
			shape = child;
		};
		descend(node ? 'node' : 'object');
		descend(kind === undefined ? 'kind:' : `kind:${kind}`);
		for (const field of fields) {
			descend(field.key);
			descend(`wire:${field.wire}`);
		}
		if (shape.id === undefined) {
			shape.id = shapes.length;
			shapes.push({ node, kind, fields });
		}
		return shape.id;
	};
	const toModuleValues = (items: unknown[]): ModuleValue[] =>
		items.map(value => {
			if (value === null || value === undefined) return { t: ModuleTag.Null };
			if (typeof value === 'bigint') return { t: ModuleTag.Big, s: value.toString() };
			if (typeof value === 'number') return { t: ModuleTag.Int, n: value };
			if (typeof value === 'string') return { t: ModuleTag.Str, s: value };
			if (typeof value === 'boolean') return { t: value ? ModuleTag.True : ModuleTag.False };
			if (Array.isArray(value)) {
				const items: unknown[] = value;
				return { t: ModuleTag.Arr, a: toModuleValues(items) };
			}
			if (typeof value !== 'object') throw new Error('gbm: unsupported graph value');
			return options?.reference?.(value, Object.entries(value)) ?? { t: ModuleTag.Ref, r: intern(value) };
		});
	const intern = (o: object): number => {
		const hit = index.get(o);
		if (hit !== undefined) return hit;
		const i = values.length;
		index.set(o, i);
		values.push([]);
		shapeIds.push(0);
		const node = moduleNodes.has(o);
		const entries: [string, unknown][] = Object.entries(o);
		const kind = 'kind' in o && typeof o.kind === 'string' ? o.kind : undefined;
		const serializedFields = options?.fields?.(o, entries, node) ?? entries;
		const keys: string[] = [];
		const entriesToEncode: unknown[] = [];
		for (const [key, value] of serializedFields) {
			if (kind !== undefined && key === 'kind') continue;
			keys.push(key);
			entriesToEncode.push(value);
		}
		const tags = toModuleValues(entriesToEncode);
		const fields = keys.map((key, column) => ({
			key,
			wire: wireOf(tags[column] ?? { t: ModuleTag.Null }),
		}));
		shapeIds[i] = shapeOf(node, kind, fields);
		values[i] = tags;
		return i;
	};
	const root = intern(m.root);
	return {
		path: m.path,
		hash: m.hash,
		root,
		values,
		shapes,
		shapeIds,
	};
}

export function encodeModuleBundle(bundle: ModuleBundle): Uint8Array {
	if (!bundle.entry || !bundle.modules.has(bundle.entry) ||
		(bundle.test !== undefined && !bundle.modules.has(bundle.test)))
		throw new Error('gbm: missing entry module');
	const w = new Writer();
	w.str(bundle.test ? `${bundle.entry}\0${bundle.test}` : bundle.entry);
	w.varint(bundle.modules.size);
	for (const [path, g] of bundle.modules) {
		if (path !== g.path || !path || !g.hash)
			throw new Error('gbm: invalid module identity');
		if (!isModuleRoot(g.shapes[g.shapeIds[g.root] ?? -1]))
			throw new Error('gbm: invalid module root');
		writeGraph(w, g);
	}
	writeObjects(w, bundle.objects);
	return w.finish();
}

function writeGraph(w: Writer, g: ModuleGraph) {
	w.str(g.path);
	w.str(g.hash);
	w.varint(g.root);
	w.varint(g.values.length);
	w.varint(g.shapes.length);
	for (const shape of g.shapes) {
		w.u8((shape.node ? 1 : 0) | (shape.kind === undefined ? 0 : 2));
		if (shape.kind !== undefined) w.str(shape.kind);
		w.varint(shape.fields.length);
		for (const field of shape.fields) {
			w.str(field.key);
			w.u8(field.wire);
		}
	}
	for (let i = 0; i < g.values.length; i++) {
		w.varint(g.shapeIds[i] ?? 0);
		const shape = g.shapes[g.shapeIds[i] ?? 0];
		if (!shape) throw new Error('gbm: missing object shape');
		const values = g.values[i];
		if (values?.length !== shape.fields.length) throw new Error('gbm: invalid object record');
		for (const [index, field] of shape.fields.entries()) {
			const value = values[index];
			if (value === undefined) throw new Error('gbm: missing field value');
			writeTypedVal(w, value, field.wire, i, g.values.length);
		}
	}
}

const RK = { data: 0, tag: 1, global: 2, call: 3, callrt: 4 };

function writeRef(w: Writer, ref: { mod?: string; name: string }): void {
	if (ref.mod !== undefined) {
		w.u8(0);
		w.str(ref.mod);
		w.str(ref.name);
	} else {
		w.u8(1);
		w.str(ref.name);
	}
}

function writeObjects(
	w: Writer,
	objects: readonly SerialObject[],
): void {
	w.varint(objects.length);
	for (const o of objects) {
		w.str(o.hash);
		w.str(o.name);
		writeBytes(w, o.params);
		writeBytes(w, o.results);
		writeBytes(w, o.locals);
		writeBytes(w, o.code);
		w.varint(o.relocs.length);
		for (const r of o.relocs) {
			if (r.offset >= o.code.length) throw new Error('gbm: invalid relocation offset');
			w.u8(RK[r.kind]);
			w.varint(r.offset);
			if (r.kind === 'data') w.str(r.str);
			else if (r.kind === 'tag') w.str(r.key);
			else if (r.kind === 'callrt') w.str(r.rt);
			else writeRef(w, r.ref);
		}
	}
}

function writeBytes(w: Writer, bytes: readonly number[]) {
	w.varint(bytes.length);
	for (const byte of bytes) {
		if ((byte & 0xff) !== byte) throw new Error('gbm: invalid object byte');
		w.u8(byte);
	}
}

function writeSigned(w: Writer, n: number): void {
	w.varint(n < 0 ? -n * 2 - 1 : n * 2);
}

function wireOf(e: ModuleValue): Wire {
	switch (e.t) {
		case ModuleTag.Null:
			return Wire.Null;
		case ModuleTag.Int:
			return !e.float && Number.isInteger(e.n) ? Wire.Int : Wire.Float;
		case ModuleTag.Str:
			return Wire.Str;
		case ModuleTag.True:
			return Wire.True;
		case ModuleTag.False:
			return Wire.False;
		case ModuleTag.Big:
			return Wire.Big;
		case ModuleTag.Ref:
			return Wire.Ref;
		case ModuleTag.Ext:
			return Wire.Ext;
		case ModuleTag.Arr:
			return e.a.every(value => value.t === ModuleTag.Ref) ? Wire.RefArr : Wire.Arr;
		case ModuleTag.Mod:
			return Wire.Mod;
		case ModuleTag.TypeExt:
			return Wire.TypeExt;
		case ModuleTag.TypeMod:
			return Wire.TypeMod;
	}
}

function writeVal(w: Writer, e: ModuleValue, base: number, count: number, depth = 0): void {
	if (depth === 256) throw new Error('gbm: too many nested arrays');
	w.u8(e.t);
	switch (e.t) {
		case ModuleTag.Int: {
			const n = e.n;
			if (!e.float && Number.isInteger(n)) {
				w.u8(0);
				writeSigned(w, n);
			} else {
				w.u8(1);
				w.f64(n);
			}
			return;
		}
		case ModuleTag.Big:
			w.str(validBigInt(e.s));
			return;
		case ModuleTag.Str:
		case ModuleTag.Ext:
		case ModuleTag.TypeExt:
			w.str(e.s);
			return;
		case ModuleTag.Mod:
		case ModuleTag.TypeMod:
			w.str(e.h);
			w.str(e.s);
			return;
		case ModuleTag.Ref:
			writeReference(w, e.r, base, count);
			return;
		case ModuleTag.Arr:
			w.varint(e.a.length);
			for (const x of e.a) writeVal(w, x, base, count, depth + 1);
			return;
		default:
			return;
	}
}

function writeTypedVal(w: Writer, e: ModuleValue, wire: Wire, base: number, count: number) {
	switch (e.t) {
		case ModuleTag.Null:
		case ModuleTag.True:
		case ModuleTag.False:
			if (wire === wireOf(e)) return;
			break;
		case ModuleTag.Int:
			if (wire === Wire.Int && !e.float) return writeSigned(w, e.n);
			if (wire === Wire.Float) return w.f64(e.n);
			break;
		case ModuleTag.Str:
		case ModuleTag.Ext:
		case ModuleTag.TypeExt:
		case ModuleTag.Big:
			if (wire !== wireOf(e)) break;
			return w.str(e.t === ModuleTag.Big ? validBigInt(e.s) : e.s);
		case ModuleTag.Ref:
			if (wire === Wire.Ref) return writeReference(w, e.r, base, count);
			break;
		case ModuleTag.Mod:
		case ModuleTag.TypeMod:
			if (wire !== wireOf(e)) break;
			w.str(e.h);
			return w.str(e.s);
		case ModuleTag.Arr:
			if (wire === Wire.Arr || wire === Wire.RefArr)
				return writeArray(w, e.a, wire, base, count);
			break;
	}
	throw new Error('gbm: field does not match its wire type');
}

function writeArray(w: Writer, items: ModuleValue[], wire: Wire.Arr | Wire.RefArr, base: number, count: number) {
	w.varint(items.length);
	for (const item of items) {
		if (wire === Wire.Arr) writeVal(w, item, base, count);
		else if (item.t === ModuleTag.Ref) writeReference(w, item.r, base, count);
		else throw new Error('gbm: invalid reference array');
	}
}

function writeReference(w: Writer, index: number, base: number, count: number) {
	writeSigned(w, validIndex(index, count) - base);
}

function validIndex(index: number, count: number) {
	if (!(index >= 0 && index < count)) throw new Error('gbm: invalid object reference');
	return index;
}

function validBigInt(value: string) {
	if (!/^-?(0|[1-9]\d*)$/.test(value)) throw new Error('gbm: invalid bigint');
	return value;
}

function readSigned(r: Reader): number {
	const zig = r.varint();
	return zig % 2 === 0 ? zig / 2 : -(zig + 1) / 2;
}

function readVal(r: Reader, base: number, count: number, depth = 0): ModuleValue {
	if (depth === 256) throw new Error('gbm: too many nested arrays');
	const t: ModuleTag = r.u8();
	switch (t) {
		case ModuleTag.Null:
		case ModuleTag.True:
		case ModuleTag.False:
			return { t };
		case ModuleTag.Int: {
			const format = r.u8();
			if (format === 0) return { t, n: readSigned(r) };
			if (format === 1) return { t, float: true, n: r.f64() };
			throw new Error('gbm: invalid number format');
		}
		case ModuleTag.Big:
			return { t, s: validBigInt(r.str()) };
		case ModuleTag.Str:
		case ModuleTag.Ext:
		case ModuleTag.TypeExt:
			return { t, s: r.str() };
		case ModuleTag.Mod:
		case ModuleTag.TypeMod:
			return { t, h: r.str(), s: r.str() };
		case ModuleTag.Ref:
			return { t: ModuleTag.Ref, r: validIndex(base + readSigned(r), count) };
		case ModuleTag.Arr: {
			const n = r.varint();
			const a: ModuleValue[] = [];
			for (let i = 0; i < n; i++) a.push(readVal(r, base, count, depth + 1));
			return { t: ModuleTag.Arr, a };
		}
		default:
			throw new Error('gbm: invalid value tag');
	}
}

function readTypedVal(r: Reader, wire: Wire, base: number, count: number): ModuleValue {
	switch (wire) {
		case Wire.Null:
			return { t: ModuleTag.Null };
		case Wire.True:
			return { t: ModuleTag.True };
		case Wire.False:
			return { t: ModuleTag.False };
		case Wire.Int:
			return { t: ModuleTag.Int, n: readSigned(r) };
		case Wire.Float:
			return { t: ModuleTag.Int, float: true, n: r.f64() };
		case Wire.Big:
			return { t: ModuleTag.Big, s: validBigInt(r.str()) };
		case Wire.Str:
		case Wire.Ext:
		case Wire.TypeExt:
			return {
				t: wire === Wire.Str ? ModuleTag.Str : wire === Wire.Ext ? ModuleTag.Ext : ModuleTag.TypeExt,
				s: r.str(),
			};
		case Wire.Ref:
			return { t: ModuleTag.Ref, r: validIndex(base + readSigned(r), count) };
		case Wire.Mod:
		case Wire.TypeMod:
			return {
				t: wire === Wire.Mod ? ModuleTag.Mod : ModuleTag.TypeMod,
				h: r.str(),
				s: r.str(),
			};
		case Wire.RefArr: {
			const a: ModuleValue[] = [];
			for (let n = r.varint(); n > 0; n--)
				a.push({ t: ModuleTag.Ref, r: validIndex(base + readSigned(r), count) });
			return { t: ModuleTag.Arr, a };
		}
		case Wire.Arr: {
			const a: ModuleValue[] = [];
			for (let n = r.varint(); n > 0; n--) a.push(readVal(r, base, count));
			return { t: ModuleTag.Arr, a };
		}
	}
}

export type ModuleReference = Extract<ModuleValue, { t: ModuleTag.Ext | ModuleTag.TypeExt } | { t: ModuleTag.Mod | ModuleTag.TypeMod }>;

export interface ModuleGraph {
	path: string;
	hash: string;
	root: number;
	values: ModuleValue[][];
	shapes: Shape[];
	shapeIds: number[];
}
export type SerialRef = { mod?: string; name: string };
export type SerialReloc =
	| { kind: 'data'; offset: number; str: string }
	| { kind: 'tag'; offset: number; key: string }
	| { kind: 'callrt'; offset: number; rt: string }
	| { kind: 'global'; offset: number; ref: SerialRef }
	| { kind: 'call'; offset: number; ref: SerialRef };
export interface SerialObject {
	hash: string;
	name: string;
	params: number[];
	results: number[];
	locals: number[];
	code: number[];
	relocs: SerialReloc[];
}
export interface ModuleBundle {
	entry: string;
	test?: string;
	modules: Map<string, ModuleGraph>;
	objects: SerialObject[];
}

function readRef(r: Reader): SerialRef {
	const kind = r.u8();
	if (kind === 0) return { mod: r.str(), name: r.str() };
	if (kind === 1) return { name: r.str() };
	throw new Error('gbm: invalid relocation reference');
}

function readBytes(r: Reader): number[] {
	const bytes: number[] = [];
	for (let count = r.varint(); count > 0; count--) bytes.push(r.u8());
	return bytes;
}

function readObjects(r: Reader): SerialObject[] {
	const count = r.varint();
	const out: SerialObject[] = [];
	for (let i = 0; i < count; i++) {
		const hash = r.str();
		const name = r.str();
		const params = readBytes(r);
		const results = readBytes(r);
		const locals = readBytes(r);
		const code = readBytes(r);
		const relocs: SerialReloc[] = [];
		for (let n = r.varint(); n > 0; n--) {
			const kind = r.u8();
			const offset = r.varint();
			if (offset >= code.length) throw new Error('gbm: invalid relocation offset');
			if (kind === RK.data) relocs.push({ kind: 'data', offset, str: r.str() });
			else if (kind === RK.tag)
				relocs.push({ kind: 'tag', offset, key: r.str() });
			else if (kind === RK.callrt)
				relocs.push({ kind: 'callrt', offset, rt: r.str() });
			else if (kind === RK.global)
				relocs.push({ kind: 'global', offset, ref: readRef(r) });
			else if (kind === RK.call)
				relocs.push({ kind: 'call', offset, ref: readRef(r) });
			else throw new Error('gbm: invalid relocation kind');
		}
		out.push({ hash, name, params, results, locals, code, relocs });
	}
	return out;
}

function readShapes(r: Reader): Shape[] {
	const shapes: Shape[] = [];
	for (let s = r.varint(); s > 0; s--) {
		const flags = r.u8();
		if (flags > 3) throw new Error('gbm: invalid object shape flags');
		const kind = flags & 2 ? r.str() : undefined;
		const fields: Shape['fields'] = [];
		for (let f = r.varint(); f > 0; f--) {
			const key = r.str();
			const wire = r.u8();
			if (wire > Wire.RefArr) throw new Error('gbm: invalid field wire');
			fields.push({ key, wire });
		}
		shapes.push({ node: !!(flags & 1), kind, fields });
	}
	return shapes;
}

export function decodeModuleBundle(bytes: Uint8Array): ModuleBundle {
	const r = new Reader(bytes);
	const [entry = '', test, extra] = r.str().split('\0');
	if (!entry || extra !== undefined) throw new Error('gbm: invalid bundle entry');
	const count = r.varint();
	const modules = new Map<string, ModuleGraph>();
	for (let i = 0; i < count; i++) {
		const path = r.str();
		const hash = r.str();
		if (!path || !hash || modules.has(path)) throw new Error('gbm: invalid or duplicate module path');
		const root = r.varint();
		const objCount = r.varint();
		const shapes = readShapes(r);
		const values: ModuleValue[][] = [];
		const shapeIds: number[] = [];
		for (let o = 0; o < objCount; o++) {
			const shapeId = r.varint();
			shapeIds.push(shapeId);
			const shape = shapes[shapeId];
			if (!shape)
				throw new Error(
					`gbm: bad object shape ${shapeId}/${shapes.length} at ${o}`,
				);
			const fields: ModuleValue[] = [];
			for (const field of shape.fields)
				fields.push(readTypedVal(r, field.wire, o, objCount));
			values.push(fields);
		}
		if (!isModuleRoot(shapes[shapeIds[root] ?? -1])) throw new Error('gbm: invalid module root');
		modules.set(path, { path, hash, root, values, shapes, shapeIds });
	}
	const objects = readObjects(r);
	r.finish();
	if (!modules.has(entry) || (test !== undefined && !modules.has(test)))
		throw new Error('gbm: missing entry module');
	return { entry, test, modules, objects };
}

function isModuleRoot(shape: Shape | undefined) {
	return shape?.node === true && shape.kind === 'root';
}

export function materializeModuleGraph<Context extends AstContext = AstContext>(
	m: ModuleGraph,
	source: string,
	resolve?: (reference: ModuleReference) => unknown,
): { root: AstNodeMap<Context>['root']; nodes: readonly AstNode<Context>[] } {
	const nodes: AstNode<Context>[] = [];
	let root: AstNode<Context> | undefined;
	const objs: Record<string, unknown>[] = m.shapeIds.map((id, index) => {
		if (!m.shapes[id]?.node) return {};
		const node: AstNodeMap<Context>['root'] = {
			kind: 'root',
			children: [],
			source,
			start: 0,
			end: 0,
			line: 0,
		};
		nodes.push(node);
		if (index === m.root) root = node;
		return node;
	});
	const dec = (e: ModuleValue): unknown => {
		switch (e.t) {
			case ModuleTag.Null:
				return undefined;
			case ModuleTag.True:
				return true;
			case ModuleTag.False:
				return false;
			case ModuleTag.Int:
				return e.n;
			case ModuleTag.Str:
				return e.s;
			case ModuleTag.Big:
				return BigInt(e.s);
			case ModuleTag.Ref:
				if (objs[e.r] === undefined) throw new Error('gbm: invalid object reference');
				return objs[e.r];
			case ModuleTag.Ext:
			case ModuleTag.TypeExt:
			case ModuleTag.Mod:
			case ModuleTag.TypeMod: {
				const value = resolve?.(e);
				if (value === undefined) throw new Error(`gbm: unresolved graph reference "${e.s}"`);
				return value;
			}
			case ModuleTag.Arr:
				return e.a.map(dec);
		}
	};
	for (const [index, values] of m.values.entries()) {
		const object = objs[index];
		const shape = m.shapes[m.shapeIds[index] ?? -1];
		if (!object || !shape) throw new Error('gbm: missing graph object');
		if (shape.kind !== undefined) object.kind = shape.kind;
		for (const [column, field] of shape.fields.entries()) {
			const value = values[column];
			if (value === undefined) throw new Error('gbm: missing field value');
			const decoded = dec(value);
			if (field.key === '__proto__') {
				Object.defineProperty(object, field.key, {
					value: decoded,
					writable: true,
					enumerable: true,
					configurable: true,
				});
			} else object[field.key] = decoded;
		}
	}
	if (!root || root.kind !== 'root') throw new Error('gbm: invalid module root');
	return { root, nodes };
}
