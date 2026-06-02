export const STDLIB_SOURCE = `external out_str: (s: String): Void;
external out_i32: (n: Int32): Void;
external out_i64: (n: Int64): Void;
external out_f32: (n: Float32): Void;
external out_f64: (n: Float64): Void;
external out_bool: (b: Bool): Void;
external out_data: (p: Int32): Void;

type Each<T> = T >> [H, R] { H | Each<R> };
each = <T>(t: T): Each<T> { t >> (h, r) { h, each(r) } };
fold = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : fold(r, f(acc, h), f) } };
out = out_str | out_i32 | out_i64 | out_f32 | out_f64 | out_bool | (d) { d >> each >> out };
`;
