export const STDLIB_SOURCE = `external out_str: (s: String): Void;
external out_i32: (n: Int32): Void;
external out_i64: (n: Int64): Void;
external out_f32: (n: Float32): Void;
external out_f64: (n: Float64): Void;
external out_bool: (b: Bool): Void;
external traceHost: (): Void;

type Error = [];
type Each<T> = T >> [H, R] { H | Each<R> };
each = <T>(t: T): Each<T> { t >> (h, r) { h, each(r) } };
export fold = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : fold(r, f(acc, h), f) } };
export take = <T>(t: T, n: Int32) { t >> (h, r) { n > 0 ? h, take(r, n - 1) } };
export drop = <T>(t: T, n: Int32) { t >> (h, r) { n <= 0 ? h, drop(r, n - 1) } };
export reverse = <T>(t: T) { t >> (h, r) { reverse(r), h } };
toStringInt = (n: Int32): String { n < 10 ? String(Uint8(48 + n)) : String([toStringInt(n / 10), Uint8(48 + n - n / 10 * 10)]) };
toStringBool = (b: Bool): String { b ? 'true' : 'false' };
export toString = toStringInt | toStringBool | (s: String): String { s };
export out = out_str | out_i32 | out_i64 | out_f32 | out_f64 | out_bool | (d) { d >> each >> out };
export runtime = [ trace = traceHost ];
`;

/**
 * The test module. Parsed with the stdlib prelude in scope (it calls `out`
 * and \`toString\`), its \`export\`ed fns are preluded into every \`#test\`
 * block (resolvable at parse). Its def nodes are prepended to codegen ONLY in
 * test mode, so normal builds never carry them. A passing assertion is silent;
 * a failure emits a line via \`out\` (the chain stops on void otherwise).
 */
export const TEST_SOURCE = `export ok = (cond: Bool) { cond >> Bool { !$ ? 'assertion failed' } >> out };
export equal = <T>(actual: T, expected: T) { (actual == expected ? '' : String([toString(actual), ' != ', toString(expected)])) >> String { length($) > 0 ? $ } >> out };
`;
