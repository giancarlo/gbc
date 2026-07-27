// The gb standard library, as source — loaded as the global prelude by
// `program.ts`. Its `export`s become bare names in every program; its
// `#`-directives and non-exported defs are internal. Note: this is a JS
// template literal, so gb string interpolation is written `\${…}` (only the
// formatting helpers need it).
export const STDLIB_SOURCE = `
external exitHost: (code: Int32);

type Frame = [ name: String, fn: String, file: String, line: Int32 ];
type Error = Trace;
type DivByZero = Error;

type Each<T> = T >> [H, R] { H | Each<R> };
each = <T>(t: T): Each<T> { t >> (h, r) { h, each(r) } };

export fold = <T, A>(t: T, acc: A, f: (A, A): A): A {
	t >> (h, r) { length(r) == 0 ? f(acc, h) : fold(r, f(acc, h), f) }
};
export take = <T>(t: T, n: Int32) { t >> (h, r) { n > 0 ? h, take(r, n - 1) } };
export drop = <T>(t: T, n: Int32) { t >> (h, r) { n <= 0 ? h, drop(r, n - 1) } };
export reverse = <T>(t: T) { t >> (h, r) { reverse(r), h } };

export realloc = <T>(a: Buffer<T>, capacity: Int32): Buffer<T> {
	transfer(a, Buffer<T>(capacity))
};

export push = <T>(a: Buffer<T>, x: T): Buffer<T> {
	length(a) < capacity(a)
		? set(a, length(a), x)
		: set(realloc(a, capacity(a) * 2), length(a), x)
};

indexAt = <T>(a: Buffer<T>, i: Int32, x: T): Int32 {
	i == length(a) ? 0 - 1 : (get(a, i) == x ? i : indexAt(a, i + 1, x))
};
export indexOf = <T>(a: Buffer<T>, x: T): Int32 { indexAt(a, 0, x) };
export contains = <T>(a: Buffer<T>, x: T): Bool { indexOf(a, x) >= 0 };

mapAt = <T, U>(a: Buffer<T>, i: Int32, dst: Buffer<U>, f: (T): U): Buffer<U> {
	i == length(a) ? dst : mapAt(a, i + 1, push(dst, f(get(a, i))), f)
};
export map = <T, U>(a: Buffer<T>, f: (T): U): Buffer<U> {
	mapAt(a, 0, Buffer<U>(length(a)), f)
};

reduceAt = <T, A>(a: Buffer<T>, i: Int32, acc: A, f: (A, T): A): A {
	i == length(a) ? acc : reduceAt(a, i + 1, f(acc, get(a, i)), f)
};
export reduce = <T, A>(a: Buffer<T>, acc: A, f: (A, T): A): A {
	reduceAt(a, 0, acc, f)
};

negDigits = (n: Int32): String {
	n > -10
		? String(Char(Uint8(48 - n)))
		: '\${negDigits(n / 10)}\${Char(Uint8(48 - (n - n / 10 * 10)))}'
};
negDigits64 = (n: Int64): String {
	n > -10
		? String(Char(Uint8(48 - Int32(n))))
		: '\${negDigits64(n / 10)}\${Char(Uint8(48 - Int32(n - n / 10 * 10)))}'
};
uDigits = (n: Uint32): String {
	n < 10
		? String(Char(Uint8(48 + n)))
		: '\${uDigits(n / 10)}\${Char(Uint8(48 + (n - n / 10 * 10)))}'
};
uDigits64 = (n: Uint64): String {
	n < 10
		? String(Char(Uint8(48 + Uint32(n))))
		: '\${uDigits64(n / 10)}\${Char(Uint8(48 + Uint32(n - n / 10 * 10)))}'
};

extend String (n: Int32): String { n < 0 ? '-\${negDigits(n)}' : negDigits(0 - n) };
extend String (n: Int64): String { n < 0 ? '-\${negDigits64(n)}' : negDigits64(0 - n) };
extend String (n: Uint32): String { uDigits(n) };
extend String (n: Uint64): String { uDigits64(n) };
extend String (b: Bool): String { b ? 'true' : 'false' };

stackText = (e: Error, i: Int32): String {
	i >= frames(e)
		? ''
		: ' <- \${frameAt(e, i).fn}:\${frameAt(e, i).line}\${stackText(e, i + 1)}'
};
extend String (e: Error): String {
	'\${origin(e).name} at \${origin(e).fn}:\${origin(e).line}\${length(origin(e).file) > 0 ? ' (\${origin(e).file})' : ''}\${stackText(e, 1)}'
};

export out =
	  (s: String) { out_buffer(s) }
	| (n: Int32) { out_buffer(String(n)) }
	| (n: Int64) { out_buffer(String(n)) }
	| (n: Uint32) { out_buffer(String(n)) }
	| (n: Uint64) { out_buffer(String(n)) }
	| (f: Float32) { out_buffer(String(f)) }
	| (f: Float64) { out_buffer(String(f)) }
	| (b: Bool) { out_buffer(String(b)) }
	| (c: Char) { out_buffer(String(c)) }
	| (e: Error) { out_buffer(String(e)) }
	| (d) { d >> each >> out };

export runtime = [ exit = exitHost, stack = stack ];
`;

/**
 * The test module: the `ok`/`equal` assertion framework for `#test` blocks.
 * Parsed with the stdlib prelude in scope (it calls `out`); its `export`ed fns
 * are preluded into every `#test` block (resolvable at parse). Its def nodes
 * are prepended to codegen ONLY in test mode, so normal builds never carry
 * them. A passing assertion is silent; a failure emits a line via `out`.
 */
export const TEST_SOURCE = `
export ok = (cond: Bool) { cond >> Bool { !$ ? 'assertion failed' } >> out };
export equal = <T>(actual: T, expected: T) {
	(actual == expected ? '' : '\${actual} != \${expected}') >> String { length($) > 0 ? $ } >> out
};
`;
