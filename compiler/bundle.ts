import type { Node, NodeMap } from './node.js';
import type { ResolvedType, Symbol, SymbolMap, Type } from './symbol-table.js';
import type { LibraryObject } from './target-wasm.js';

declare class TextEncoder {
	constructor();
	encode(data: string): Uint8Array;
}
declare class TextDecoder {
	constructor(label?: string);
	decode(input: Uint8Array): string;
}

const MAGIC = 0x4742_4d01;

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
	TypeExt = 11,
	TypeMod = 12,
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

function isResolvedType(v: object): v is ResolvedType {
	return 'kind' in v && v.kind === 'type' && 'family' in v;
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
	| { t: Tag.Str | Tag.Big | Tag.Ext | Tag.TypeExt; s: string }
	| { t: Tag.Ref; r: number }
	| { t: Tag.Mod | Tag.TypeMod; h: string; s: string }
	| { t: Tag.Arr; a: Tagged[] };

const enum Wire {
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

interface ModuleGraph {
	path: string;
	hash: string;
	root: number;
	objs: Tagged[][];
	shapes: Shape[];
	shapeIds: number[];
}

interface ShapeTrie {
	children: Map<string, ShapeTrie>;
	id?: number;
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
				if (DECLARING.has(v.kind) && 'symbol' in v) {
					owner.set(v.symbol, m.hash);
					const symbol: unknown = v.symbol;
					if (
						typeof symbol === 'object' &&
						symbol !== null &&
						'kind' in symbol &&
						symbol.kind === 'type' &&
						'type' in symbol &&
						typeof symbol.type === 'object' &&
						symbol.type !== null
					)
						owner.set(symbol.type, m.hash);
				}
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

function hasNonScalarEmission(symbol: SymbolMap['function']): boolean {
	const emission = symbol.emissionType;
	return emission?.kind === 'type' && emission.family === 'emission'
		? emission.rest !== undefined || emission.elements.length > 1
		: symbol.returnVariants
			? symbol.returnVariants.length !== 1 ||
				symbol.returnVariants.some(variant => variant.length !== 1)
			: (symbol.returnTypes?.length ?? 0) > 1;
}

function streamInlineCandidate(fn: NodeMap['fn']): boolean {
	const statements = fn.statements ?? [];
	const tail = statements[statements.length - 1];
	if (tail?.kind !== 'next' || !tail.children?.[0]) return false;
	for (let i = 0; i < statements.length - 1; i++) {
		const statement = statements[i];
		if (statement?.kind !== 'def' && statement?.kind !== '=') return false;
	}
	return true;
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
	const objs: Tagged[][] = [];
	const shapes: Shape[] = [];
	const shapeIds: number[] = [];
	const shapeRoot: ShapeTrie = { children: new Map() };
	const index = new Map<object, number>();
	const bodylessFns = new Set<NodeMap['fn']>();
	if (m.root.kind === 'root')
		for (const child of m.root.children)
			if (
				child.kind === 'def' &&
				child.value.kind === 'fn' &&
				objectSymbols.has(child.symbol) &&
				!functionBodyRequired(child.value)
			)
				bodylessFns.add(child.value);
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
	const tagObject = (o: object): Tagged => {
		const h = owner.get(o);
		if (h !== undefined && h !== m.hash) {
			const name = isSymbolLike(o) ? o.name : undefined;
			if (typeof name === 'string')
				return { t: isResolvedType(o) ? Tag.TypeMod : Tag.Mod, h, s: name };
		}
		if (
			h === undefined &&
			isSymbolLike(o) &&
			typeof o.name === 'string' &&
			(!isResolvedType(o) || o.family !== 'buffer') &&
			isExternalName(o.name)
		)
			return {
				t: isResolvedType(o) ? Tag.TypeExt : Tag.Ext,
				s: o.name,
			};
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
		objs.push([]);
		shapeIds.push(0);
		const nodeValue = isNode(o) ? o : undefined;
		const node = nodeValue !== undefined;
		const bodyless = nodeValue?.kind === 'fn' && bodylessFns.has(nodeValue);
		const kindValue: unknown = Reflect.get(o, 'kind');
		const kind = typeof kindValue === 'string' ? kindValue : undefined;
		const keys = Object.keys(o).filter(
			k =>
				k !== 'scope' &&
				k !== 'references' &&
				!(kind !== undefined && k === 'kind') &&
				!(isSymbolLike(o) && k === 'definition') &&
				!(bodyless && k === 'statements') &&
				!(
					node &&
					(k === 'source' ||
						k === 'start' ||
						k === 'end' ||
						k === 'line' ||
						k === 'owner' ||
						k === 'implicit')
				),
		);
		if (nodeValue?.kind === 'string') keys.push('value');
		if (bodyless) keys.push('objectBacked');
		const vals: unknown[] = keys.map((k): unknown =>
			nodeValue?.kind === 'string' && k === 'value'
				? nodeValue.source.slice(nodeValue.start, nodeValue.end)
				: bodyless && k === 'children'
				? []
				: bodyless && k === 'objectBacked'
					? true
					: Reflect.get(o, k),
		);
		const tags = toTagged(vals);
		const fields = keys.map((key, field) => ({
			key,
			wire: wireOf(tags[field] ?? { t: Tag.Null }),
		}));
		shapeIds[i] = shapeOf(node, kind, fields);
		objs[i] = tags;
		return i;
	};
	return {
		path: m.path,
		hash: m.hash,
		root: intern(m.root),
		objs,
		shapes,
		shapeIds,
	};
}

export function encodeBundle(
	entry: string,
	modules: { path: string; hash: string; root: Node }[],
	isExternalName: (name: string) => boolean,
	objects: LibraryObject[] = [],
): Uint8Array {
	const owner = ownersOf(modules);
	const storable = storableObjects(
		objects,
		owner,
		isExternalName,
		topLevelObjectSymbols(modules),
	);
	const objectSymbols = new Set(storable.map(object => object.sym));
	const w = new Writer();
	w.str(entry);
	w.varint(modules.length);
	for (const m of modules) {
		const g = graphOfModule(m, owner, isExternalName, objectSymbols);
		w.str(g.path);
		w.str(g.hash);
		w.varint(g.root);
		w.varint(g.objs.length);
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
		for (let i = 0; i < g.objs.length; i++) {
			w.varint(g.shapeIds[i] ?? 0);
			const shape = g.shapes[g.shapeIds[i] ?? 0];
			if (!shape) throw new Error('gbm: missing object shape');
			const values = g.objs[i] ?? [];
			for (let field = 0; field < shape.fields.length; field++)
				writeTypedVal(
					w,
					values[field] ?? { t: Tag.Null },
					shape.fields[field]?.wire ?? Wire.Null,
					i,
				);
		}
	}
	writeObjects(w, storable, owner, isExternalName);
	return w.finish();
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
	w.varint(objects.length);
	for (const o of objects) {
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

function writeSigned(w: Writer, n: number): void {
	w.varint(n < 0 ? -n * 2 - 1 : n * 2);
}

function wireOf(e: Tagged): Wire {
	switch (e.t) {
		case Tag.Null:
			return Wire.Null;
		case Tag.Int:
			return Number.isInteger(e.n) ? Wire.Int : Wire.Float;
		case Tag.Str:
			return Wire.Str;
		case Tag.True:
			return Wire.True;
		case Tag.False:
			return Wire.False;
		case Tag.Big:
			return Wire.Big;
		case Tag.Ref:
			return Wire.Ref;
		case Tag.Ext:
			return Wire.Ext;
		case Tag.Arr:
			return e.a.every(value => value.t === Tag.Ref) ? Wire.RefArr : Wire.Arr;
		case Tag.Mod:
			return Wire.Mod;
		case Tag.TypeExt:
			return Wire.TypeExt;
		case Tag.TypeMod:
			return Wire.TypeMod;
	}
}

function writeVal(w: Writer, e: Tagged, base: number): void {
	w.u8(e.t);
	switch (e.t) {
		case Tag.Int: {
			const n = e.n;
			if (Number.isInteger(n)) {
				w.u8(0);
				writeSigned(w, n);
			} else {
				w.u8(1);
				w.f64(n);
			}
			return;
		}
		case Tag.Str:
		case Tag.Big:
		case Tag.Ext:
		case Tag.TypeExt:
			w.str(e.s);
			return;
		case Tag.Mod:
		case Tag.TypeMod:
			w.str(e.h);
			w.str(e.s);
			return;
		case Tag.Ref:
			writeSigned(w, e.r - base);
			return;
		case Tag.Arr:
			w.varint(e.a.length);
			for (const x of e.a) writeVal(w, x, base);
			return;
		default:
			return;
	}
}

function writeTypedVal(w: Writer, e: Tagged, wire: Wire, base: number): void {
	switch (wire) {
		case Wire.Null:
		case Wire.True:
		case Wire.False:
			return;
		case Wire.Int:
			if (e.t === Tag.Int) writeSigned(w, e.n);
			return;
		case Wire.Float:
			if (e.t === Tag.Int) w.f64(e.n);
			return;
		case Wire.Str:
		case Wire.Big:
		case Wire.Ext:
		case Wire.TypeExt:
			if (
				e.t === Tag.Str ||
				e.t === Tag.Big ||
				e.t === Tag.Ext ||
				e.t === Tag.TypeExt
			)
				w.str(e.s);
			return;
		case Wire.Ref:
			if (e.t === Tag.Ref) writeSigned(w, e.r - base);
			return;
		case Wire.Mod:
		case Wire.TypeMod:
			if (e.t === Tag.Mod || e.t === Tag.TypeMod) {
				w.str(e.h);
				w.str(e.s);
			}
			return;
		case Wire.RefArr:
			if (e.t === Tag.Arr) {
				w.varint(e.a.length);
				for (const value of e.a)
					if (value.t === Tag.Ref) writeSigned(w, value.r - base);
			}
			return;
		case Wire.Arr:
			if (e.t === Tag.Arr) {
				w.varint(e.a.length);
				for (const value of e.a) writeVal(w, value, base);
			}
	}
}

type DecVal =
	| { t: Tag.Null | Tag.True | Tag.False }
	| { t: Tag.Int; n: number }
	| { t: Tag.Int; big: false; f: number }
	| { t: Tag.Str | Tag.Big | Tag.Ext | Tag.TypeExt; s: string }
	| { t: Tag.Ref; r: number }
	| { t: Tag.Mod | Tag.TypeMod; h: string; s: string }
	| { t: Tag.Arr; a: DecVal[] };

function readSigned(r: Reader): number {
	const zig = r.varint();
	return zig % 2 === 0 ? zig / 2 : -(zig + 1) / 2;
}

function readVal(r: Reader, base: number): DecVal {
	const t: Tag = r.u8();
	switch (t) {
		case Tag.Int: {
			if (r.u8() === 0) return { t: Tag.Int, n: readSigned(r) };
			return { t: Tag.Int, big: false, f: r.f64() };
		}
		case Tag.Str:
		case Tag.Big:
		case Tag.Ext:
		case Tag.TypeExt:
			return { t, s: r.str() };
		case Tag.Mod:
		case Tag.TypeMod:
			return { t, h: r.str(), s: r.str() };
		case Tag.Ref:
			return { t: Tag.Ref, r: base + readSigned(r) };
		case Tag.Arr: {
			const n = r.varint();
			const a: DecVal[] = [];
			for (let i = 0; i < n; i++) a.push(readVal(r, base));
			return { t: Tag.Arr, a };
		}
		default:
			return { t: Tag.Null };
	}
}

function readTypedVal(r: Reader, wire: Wire, base: number): DecVal {
	switch (wire) {
		case Wire.Null:
			return { t: Tag.Null };
		case Wire.True:
			return { t: Tag.True };
		case Wire.False:
			return { t: Tag.False };
		case Wire.Int:
			return { t: Tag.Int, n: readSigned(r) };
		case Wire.Float:
			return { t: Tag.Int, big: false, f: r.f64() };
		case Wire.Str:
		case Wire.Big:
		case Wire.Ext:
		case Wire.TypeExt:
			return {
				t:
					wire === Wire.Str
						? Tag.Str
						: wire === Wire.Big
							? Tag.Big
							: wire === Wire.Ext
								? Tag.Ext
								: Tag.TypeExt,
				s: r.str(),
			};
		case Wire.Ref:
			return { t: Tag.Ref, r: base + readSigned(r) };
		case Wire.Mod:
		case Wire.TypeMod:
			return {
				t: wire === Wire.Mod ? Tag.Mod : Tag.TypeMod,
				h: r.str(),
				s: r.str(),
			};
		case Wire.RefArr: {
			const a: DecVal[] = [];
			for (let n = r.varint(); n > 0; n--)
				a.push({ t: Tag.Ref, r: base + readSigned(r) });
			return { t: Tag.Arr, a };
		}
		case Wire.Arr: {
			const a: DecVal[] = [];
			for (let n = r.varint(); n > 0; n--) a.push(readVal(r, base));
			return { t: Tag.Arr, a };
		}
	}
}

export interface DecodedModule {
	hash: string;
	root: number;
	objs: [string, DecVal][][];
	nodes: boolean[];
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
		const shapes: Shape[] = [];
		for (let s = r.varint(); s > 0; s--) {
			const flags = r.u8();
			const kind = flags & 2 ? r.str() : undefined;
			const fields: Shape['fields'] = [];
			for (let f = r.varint(); f > 0; f--)
				fields.push({ key: r.str(), wire: r.u8() });
			shapes.push({ node: !!(flags & 1), kind, fields });
		}
		const objs: [string, DecVal][][] = [];
		const nodes: boolean[] = [];
		for (let o = 0; o < objCount; o++) {
			const shapeId = r.varint();
			const shape = shapes[shapeId];
			if (!shape)
				throw new Error(
					`gbm: bad object shape ${shapeId}/${shapes.length} at ${o}`,
				);
			const rec: [string, DecVal][] = [];
			if (shape.kind !== undefined)
				rec.push(['kind', { t: Tag.Str, s: shape.kind }]);
			for (const field of shape.fields)
				rec.push([field.key, readTypedVal(r, field.wire, o)]);
			objs.push(rec);
			nodes.push(shape.node);
		}
		modules.set(path, { hash, root, objs, nodes });
	}
	const objects = readObjects(r);
	return { entry, modules, objects };
}

export function materializeModule(
	m: DecodedModule,
	source: string,
	resolveExternalSymbol: (name: string) => Symbol,
	resolveExternalType: (name: string) => Type,
	resolveModSymbol: (hash: string, name: string) => Symbol,
	resolveModType: (hash: string, name: string) => Type,
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
				return resolveExternalSymbol(e.s);
			case Tag.TypeExt:
				return resolveExternalType(e.s);
			case Tag.Mod:
				return resolveModSymbol(e.h, e.s);
			case Tag.TypeMod:
				return resolveModType(e.h, e.s);
			case Tag.Arr:
				return e.a.map(dec);
		}
	};
	m.objs.forEach((rec, i) => {
		const o = objs[i];
		if (!o) return;
		for (const [k, v] of rec) o[k] = dec(v);
		if (m.nodes[i]) {
			o.source = source;
			o.start = 0;
			o.end = 0;
			o.line = 0;
		}
	});
	for (let i = 0; i < objs.length; i++) {
		if (!m.nodes[i]) continue;
		const node = objs[i];
		if (!node || !DECLARING.has(String(node.kind))) continue;
		const symbol = node.symbol;
		if (symbol && typeof symbol === 'object')
			Reflect.set(symbol, 'definition', node);
	}
	const root = objs[m.root];
	if (!root || !isNode(root)) throw new Error('bundle root is not a node');
	return root;
}
