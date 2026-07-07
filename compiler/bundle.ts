import type { Node } from './node.js';
import type { Symbol, Type } from './symbol-table.js';
import type { LibraryObject } from './target-wasm.js';

declare class TextEncoder {
	constructor();
	encode(data: string): Uint8Array;
}
declare class TextDecoder {
	constructor(label?: string);
	decode(input: Uint8Array): string;
}

const MAGIC = 0x4742_4d02;

const enum Tag {
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
}

const DECLARING = new Set([
	'def',
	'external',
	'fn',
	'parameter',
	'propdef',
	'type',
]);

function isNode(v: object): v is Node {
	return 'kind' in v && 'start' in v && 'end' in v;
}

function isSymbolLike(v: object): v is Symbol {
	return 'kind' in v && 'flags' in v && !('start' in v);
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
		let x = n;
		for (;;) {
			const b = x % 128;
			x = Math.floor(x / 128);
			if (x === 0) {
				this.u8(b);
				return;
			}
			this.u8(b | 0x80);
		}
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
	private dec = new TextDecoder();
	constructor(private buf: Uint8Array) {
		if (this.varint() !== MAGIC) throw new Error('not a .gbm bundle');
		const n = this.varint();
		this.strings = [];
		for (let i = 0; i < n; i++) {
			const len = this.varint();
			this.strings.push(
				this.dec.decode(this.buf.subarray(this.pos, this.pos + len)),
			);
			this.pos += len;
		}
	}
	u8(): number {
		const b = this.buf[this.pos++];
		if (b === undefined) throw new Error('gbm: unexpected end of input');
		return b;
	}
	varint(): number {
		let x = 0;
		let shift = 1;
		for (;;) {
			const b = this.u8();
			x += (b & 0x7f) * shift;
			if ((b & 0x80) === 0) return x;
			shift *= 128;
		}
	}
	f64(): number {
		const v = new DataView(this.buf.buffer, this.buf.byteOffset).getFloat64(
			this.pos,
			true,
		);
		this.pos += 8;
		return v;
	}
	str(): string {
		const s = this.strings[this.varint()];
		if (s === undefined) throw new Error('gbm: bad string index');
		return s;
	}
}

type Tagged =
	| { t: Tag.Null | Tag.True | Tag.False }
	| { t: Tag.Int; n: number }
	| { t: Tag.Str | Tag.Big | Tag.Ext; s: string }
	| { t: Tag.Ref; r: number }
	| { t: Tag.Mod; h: string; s: string }
	| { t: Tag.Arr; a: Tagged[] };

interface ModuleGraph {
	path: string;
	hash: string;
	root: number;
	objs: [string, Tagged][][];
}

function ownersOf(
	modules: { hash: string; root: Node }[],
): Map<object, string> {
	const owner = new Map<object, string>();
	for (const m of modules) {
		const seen = new Set<object>();
		const walk = (vals: unknown[]): void => {
			for (const v of vals) {
				if (!v || typeof v !== 'object') continue;
				if (Array.isArray(v)) {
					const arr: unknown[] = v;
					walk(arr);
					continue;
				}
				if (!isNode(v) || seen.has(v)) continue;
				seen.add(v);
				if (DECLARING.has(v.kind) && 'symbol' in v)
					owner.set(v.symbol, m.hash);
				const kids: unknown[] = Object.keys(v)
					.filter(k => k !== 'symbol')
					.map((k): unknown => Reflect.get(v, k));
				walk(kids);
			}
		};
		walk([m.root]);
	}
	return owner;
}

function graphOfModule(
	m: { path: string; hash: string; root: Node },
	owner: Map<object, string>,
	isExternalName: (name: string) => boolean,
): ModuleGraph {
	const objs: [string, Tagged][][] = [];
	const index = new Map<object, number>();
	const tagObject = (o: object): Tagged => {
		const h = owner.get(o);
		if (h !== undefined && h !== m.hash) {
			const name = isSymbolLike(o) ? o.name : undefined;
			if (typeof name === 'string') return { t: Tag.Mod, h, s: name };
		}
		if (
			h === undefined &&
			isSymbolLike(o) &&
			typeof o.name === 'string' &&
			isExternalName(o.name)
		)
			return { t: Tag.Ext, s: o.name };
		return { t: Tag.Ref, r: intern(o) };
	};
	const toTagged = (vals: unknown[]): Tagged[] =>
		vals.map(v => {
			if (v === null || v === undefined) return { t: Tag.Null };
			if (typeof v === 'bigint') return { t: Tag.Big, s: v.toString() };
			if (typeof v === 'number') return { t: Tag.Int, n: v };
			if (typeof v === 'string') return { t: Tag.Str, s: v };
			if (typeof v === 'boolean') return { t: v ? Tag.True : Tag.False };
			if (Array.isArray(v)) {
				const arr: unknown[] = v;
				return { t: Tag.Arr, a: toTagged(arr) };
			}
			return tagObject(v);
		});
	const intern = (o: object): number => {
		const hit = index.get(o);
		if (hit !== undefined) return hit;
		const i = objs.length;
		index.set(o, i);
		const rec: [string, Tagged][] = [];
		objs.push(rec);
		const keys = Object.keys(o).filter(
			k => k !== 'scope' && k !== 'references',
		);
		const vals: unknown[] = keys.map((k): unknown => Reflect.get(o, k));
		const tags = toTagged(vals);
		keys.forEach((k, j) => rec.push([k, tags[j] ?? { t: Tag.Null }]));
		return i;
	};
	return { path: m.path, hash: m.hash, root: intern(m.root), objs };
}

export function encodeBundle(
	entry: string,
	modules: { path: string; hash: string; root: Node }[],
	isExternalName: (name: string) => boolean,
	objects: LibraryObject[] = [],
): Uint8Array {
	const owner = ownersOf(modules);
	const w = new Writer();
	w.str(entry);
	w.varint(modules.length);
	for (const m of modules) {
		const g = graphOfModule(m, owner, isExternalName);
		w.str(g.path);
		w.str(g.hash);
		w.varint(g.root);
		w.varint(g.objs.length);
		for (const rec of g.objs) {
			w.varint(rec.length);
			for (const [k, v] of rec) {
				w.str(k);
				writeVal(w, v);
			}
		}
	}
	writeObjects(w, objects, owner, isExternalName);
	return w.finish();
}

const RK = { data: 0, tag: 1, global: 2, call: 3, callrt: 4 };

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
	objects: LibraryObject[],
	owner: Map<object, string>,
	isExternalName: (name: string) => boolean,
): void {
	const storable = objects.filter(o => {
		if (owner.get(o.sym) === undefined) return false;
		return o.relocs.every(r =>
			r.kind === 'global' || r.kind === 'call'
				? refOf(r.sym, owner, isExternalName) !== null
				: true,
		);
	});
	w.varint(storable.length);
	for (const o of storable) {
		const hash = owner.get(o.sym);
		if (hash === undefined) continue;
		w.str(hash);
		w.str(typeof o.sym.name === 'string' ? o.sym.name : '');
		w.varint(o.params.length);
		for (const p of o.params) w.u8(p);
		w.varint(o.results.length);
		for (const r of o.results) w.u8(r);
		w.varint(o.locals.length);
		for (const l of o.locals) w.u8(l);
		w.varint(o.code.length);
		for (const b of o.code) w.u8(b);
		w.varint(o.relocs.length);
		for (const r of o.relocs) {
			w.u8(RK[r.kind]);
			w.varint(r.offset);
			if (r.kind === 'data') w.str(r.str);
			else if (r.kind === 'tag') w.str(r.key);
			else if (r.kind === 'callrt') w.str(r.rt);
			else {
				const ref = refOf(r.sym, owner, isExternalName);
				if (ref) writeRef(w, ref);
			}
		}
	}
}

function writeVal(w: Writer, e: Tagged): void {
	w.u8(e.t);
	switch (e.t) {
		case Tag.Int: {
			const n = e.n;
			if (Number.isInteger(n)) {
				w.u8(0);
				const zig = n < 0 ? -n * 2 - 1 : n * 2;
				w.varint(zig);
			} else {
				w.u8(1);
				w.f64(n);
			}
			return;
		}
		case Tag.Str:
		case Tag.Big:
		case Tag.Ext:
			w.str(e.s);
			return;
		case Tag.Mod:
			w.str(e.h);
			w.str(e.s);
			return;
		case Tag.Ref:
			w.varint(e.r);
			return;
		case Tag.Arr:
			w.varint(e.a.length);
			for (const x of e.a) writeVal(w, x);
			return;
		default:
			return;
	}
}

type DecVal =
	| { t: Tag.Null | Tag.True | Tag.False }
	| { t: Tag.Int; n: number }
	| { t: Tag.Int; big: false; f: number }
	| { t: Tag.Str | Tag.Big | Tag.Ext; s: string }
	| { t: Tag.Ref; r: number }
	| { t: Tag.Mod; h: string; s: string }
	| { t: Tag.Arr; a: DecVal[] };

function readVal(r: Reader): DecVal {
	const t: Tag = r.u8();
	switch (t) {
		case Tag.Int: {
			if (r.u8() === 0) {
				const zig = r.varint();
				const n = zig % 2 === 0 ? zig / 2 : -(zig + 1) / 2;
				return { t: Tag.Int, n };
			}
			return { t: Tag.Int, big: false, f: r.f64() };
		}
		case Tag.Str:
		case Tag.Big:
		case Tag.Ext:
			return { t, s: r.str() };
		case Tag.Mod:
			return { t: Tag.Mod, h: r.str(), s: r.str() };
		case Tag.Ref:
			return { t: Tag.Ref, r: r.varint() };
		case Tag.Arr: {
			const n = r.varint();
			const a: DecVal[] = [];
			for (let i = 0; i < n; i++) a.push(readVal(r));
			return { t: Tag.Arr, a };
		}
		default:
			return { t: Tag.Null };
	}
}

export interface DecodedModule {
	hash: string;
	root: number;
	objs: [string, DecVal][][];
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
export interface DecodedBundle {
	entry: string;
	modules: Map<string, DecodedModule>;
	objects: SerialObject[];
}

function readRef(r: Reader): SerialRef {
	return r.u8() === 0 ? { mod: r.str(), name: r.str() } : { name: r.str() };
}

function readObjects(r: Reader): SerialObject[] {
	const count = r.varint();
	const out: SerialObject[] = [];
	for (let i = 0; i < count; i++) {
		const hash = r.str();
		const name = r.str();
		const params: number[] = [];
		for (let n = r.varint(); n > 0; n--) params.push(r.u8());
		const results: number[] = [];
		for (let n = r.varint(); n > 0; n--) results.push(r.u8());
		const locals: number[] = [];
		for (let n = r.varint(); n > 0; n--) locals.push(r.u8());
		const code: number[] = [];
		for (let n = r.varint(); n > 0; n--) code.push(r.u8());
		const relocs: SerialReloc[] = [];
		for (let n = r.varint(); n > 0; n--) {
			const kind = r.u8();
			const offset = r.varint();
			if (kind === RK.data) relocs.push({ kind: 'data', offset, str: r.str() });
			else if (kind === RK.tag)
				relocs.push({ kind: 'tag', offset, key: r.str() });
			else if (kind === RK.callrt)
				relocs.push({ kind: 'callrt', offset, rt: r.str() });
			else if (kind === RK.global)
				relocs.push({ kind: 'global', offset, ref: readRef(r) });
			else relocs.push({ kind: 'call', offset, ref: readRef(r) });
		}
		out.push({ hash, name, params, results, locals, code, relocs });
	}
	return out;
}

export function decodeBundle(bytes: Uint8Array): DecodedBundle {
	const r = new Reader(bytes);
	const entry = r.str();
	const count = r.varint();
	const modules = new Map<string, DecodedModule>();
	for (let i = 0; i < count; i++) {
		const path = r.str();
		const hash = r.str();
		const root = r.varint();
		const objCount = r.varint();
		const objs: [string, DecVal][][] = [];
		for (let o = 0; o < objCount; o++) {
			const fields = r.varint();
			const rec: [string, DecVal][] = [];
			for (let f = 0; f < fields; f++) rec.push([r.str(), readVal(r)]);
			objs.push(rec);
		}
		modules.set(path, { hash, root, objs });
	}
	const objects = readObjects(r);
	return { entry, modules, objects };
}

export function materializeModule(
	m: DecodedModule,
	resolveExternal: (name: string) => Symbol | Type,
	resolveMod: (hash: string, name: string) => Symbol | Type,
): Node {
	const objs: Record<string, unknown>[] = m.objs.map(() => ({}));
	const dec = (e: DecVal): unknown => {
		switch (e.t) {
			case Tag.Null:
				return undefined;
			case Tag.True:
				return true;
			case Tag.False:
				return false;
			case Tag.Int:
				return 'n' in e ? e.n : e.f;
			case Tag.Str:
				return e.s;
			case Tag.Big:
				return BigInt(e.s);
			case Tag.Ref:
				return objs[e.r];
			case Tag.Ext:
				return resolveExternal(e.s);
			case Tag.Mod:
				return resolveMod(e.h, e.s);
			case Tag.Arr:
				return e.a.map(dec);
		}
	};
	m.objs.forEach((rec, i) => {
		const o = objs[i];
		if (!o) return;
		for (const [k, v] of rec) o[k] = dec(v);
	});
	const root = objs[m.root];
	if (!root || !isNode(root)) throw new Error('bundle root is not a node');
	return root;
}
