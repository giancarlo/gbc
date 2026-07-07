import { spec } from './test-api.js';

/*

The GB programming language is a concise, type-safe, and functional programming language that
emphasizes immutability, modularity, and streamlined syntax.

## Design Constitution

Language features must avoid breaking these rules:

1. **One Way:** Restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns via syntax and types. Enforcement is binary — code is valid or it is a compile error; never a warning.
3. **Transparency:** No hidden or implicit behavior.
4. **No Bloat:** Only essential features.
5. **Readable:** Prioritize clarity.

*/
export default spec('Language Reference', ({ h }) => {
	h('Hello World', ({ p }) => {
		p(
			`
		 This is a sample of a simple "Hello World" program. The _main_ block is our entry point.
		 No code is allowed outside of it other than type and function definitions.
		 The standard library is always available through the _@_ operator.
		 The pipe \`>>\` operator will call the \`out\` function passing its left value as an argument.
		`,
			({ rule }) => {
				rule({
					src: `main { 'Hello World' >> out }`,
					ast: `(root (main (>> 'Hello World' :out)))`,
					out: ['Hello World'],
				});
			},
		);
	});

	h('Directives', ({ p }) => {
		p(
			'`#` is the directive sigil, not a comment marker. Free-text comments do not exist: every `#`-form is a registered, parsed directive (`#test`, `#importmap`), so nothing in a source file can silently rot — an example must compile, a map must resolve. Unknown directives and prose after `#` are scan errors.',
			({ compileError }) => {
				compileError({
					src: '# just a note\nmain { }',
					expected: 'free-text comments do not exist',
				});
				compileError({
					src: '#note { }\nmain { }',
					expected: 'known directives',
				});
			},
		);
	});

	h('Identifiers', ({ p }) => {
		p(
			'Identifiers must begin with a letter and can include alphanumeric characters or underscores. Lowercase identifiers (`x`, `count`) name values; uppercase identifiers (`Int`, `Point`) name types.',
			({ match, throws }) => {
				match('ident', { kind: 'ident' });
				match('ident_2', { kind: 'ident' });
				match('ident_', { kind: 'ident' });
				match('Type', { kind: 'ident' });

				throws(() => match('_under'), {
					position: { start: 0, end: 1 },
				});
			},
		);
	});

	h('Operators', ({ h, token, expr, match, rule }) => {
		rule({
			p: '`&&`/`||` short-circuit: the right operand is evaluated only when the left does not decide the result.',
			src: `hit = (): Bool { 'hit' >> out; next true };
main {
	false && hit() >> out;
	true || hit() >> out;
	true && hit() >> out;
}`,
			ast: `(root (def :hit ? (fn typeident (>> 'hit' :out) (next :true))) (main (>> (&& :false (call :hit ?)) :out) (>> (|| :true (call :hit ?)) :out) (>> (&& :true (call :hit ?)) :out)))`,
			out: ['false', 'true', 'hit', 'true'],
		});
		token('!', 'Boolean NOT', '!');
		token('~', 'Bitwise NOT', '~');
		token('&', 'Bitwise AND', '&');
		token('&&', 'Short-circuiting logical AND', '&&');
		token('*', 'Arithmetic multiplication', '*');
		token('+', 'Addition', '+');
		token('-', 'Arithmetic Negation (Unary)', '-');
		token('-', 'Arithmetic Substraction', '-');
		token('.', 'Member access', '.');
		token('/', 'Arithmetic division', '/');
		token('<', 'Less than comparison', '<');
		token('<=', 'Less than or equal comparison', '<=');
		token('=', 'Assignment', '=');
		token('==', 'Equality comparison', '==');
		token('>', 'Greater than comparison', '>');
		token('>=', 'Greater than or equal comparison', '>=');
		token('>>', 'Pipe Operator', '>>');
		token('|', 'Bitwise OR', '|');
		token('||', 'Short-circuiting logical OR', '||');
		token('?', 'Conditional Ternary Operator', '?');
		token(':>', 'Bitwise Shift Right', ':>');
		token('<:', 'Bitwise Shift Left', '<:');

		expr({
			p: 'Binding from tightest: call/member (`f(x)`, `.`), unary (`!` `~` `-`), `*` `/` `%`, `+` `-`, `<:` `:>`, comparisons, `==` `!=`, `&`, `^`, `|`, `&&`, `||`, ternary `?`, then `>>` and `,`. Note `&`/`^`/`|` bind looser than `==` — `1 & 3 == 3` is `1 & (3 == 3)`.',
			src: '1 + 2 * 3',
			ast: '(+ 1 (* 2 3))',
			out: ['7'],
		});
		expr({
			src: '1 + 2 < 4 <: 1',
			ast: '(< (+ 1 2) (<: 4 1))',
			out: ['true'],
		});
		expr({
			src: '1 & 2 ^ 4 | 8',
			ast: '(| (^ (& 1 2) 4) 8)',
			out: ['12'],
		});
		expr({ src: '1 == 2 | 4', ast: '(| (== 1 2) 4)' });
		expr({
			src: 'true || false ? 1 : 2',
			ast: '(? (|| :true :false) 1 2)',
			out: ['1'],
		});
		expr({
			src: '[1, 2].0 + 1',
			ast: '(+ (. (data (, 1 2)) 0) 1)',
			out: ['2'],
		});
		expr({
			src: '!true && false',
			ast: '(&& (! :true) :false)',
			out: ['false'],
		});
		expr({ src: '1 > 0 || 2 > 0', ast: '(|| (> 1 0) (> 2 0))' });
		expr({
			src: 'true || false && false',
			ast: '(|| :true (&& :false :false))',
		});
		expr({
			src: 'false || 3 == 4',
			ast: '(|| :false (== 3 4))',
		});
		expr({
			src: '10 + 5.5 * 20',
			ast: '(+ 10 (* 5.5 20))',
		});

		// Integer arithmetic via WASM
	 expr({ src: '1 + 2', ast: '(+ 1 2)', out: ['3'] });
	 expr({ src: '10 - 3', ast: '(- 10 3)', out: ['7'] });
	 expr({ src: '6 * 7', ast: '(* 6 7)', out: ['42'] });
	 expr({ src: '100 / 4', ast: '(/ 100 4)', out: ['25'] });
	 expr({
			src: '(10 + 5) * 2',
			ast: '(* (+ 10 5) 2)',
			out: ['30'],
		});

		match(
			'-10 -10_000 -10.53_3',
			'-',
			'number',
			'-',
			'number',
			'-',
			'float',
		);
		match('~0b100100, ~0xff', '~', 'number', ',', '~', 'number');
		expr({
			src: '!false, !true, !!!!false',
			ast: '(, (! :false) (! :true) (! (! (! (! :false)))))',
		});

		expr({
			src: '(true || false) && false',
			ast: '(&& (|| :true :false) :false)',
		});
		expr({
			src: '(10 + (10 * 2.4) / (10))',
			ast: '(+ 10 (/ (* 10 2.4) 10))',
		});

		h('Bitwise', ({ expr }) => {
			expr({
				src: `[ ~0, 1 <: (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
				ast: `(data (, -1 (<: 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))`,
				out: ['-1', '-2147483648', '244'],
			});
		});

		h('64-bit arithmetic & bitwise', ({ expr }) => {
			expr({
				src: `(Int64(1) <: 32) + 5`,
				ast: `(+ (<: (call typeident 1) 32) 5)`,
				out: ['4294967301'],
			});
			expr({
				src: `(Int64(1) <: 20) * (Int64(1) <: 20)`,
				ast: `(* (<: (call typeident 1) 20) (<: (call typeident 1) 20))`,
				out: ['1099511627776'],
			});
			expr({
				src: `Int64(1) <: 40`,
				ast: `(<: (call typeident 1) 40)`,
				out: ['1099511627776'],
			});
			expr({
				src: `(Int64(1) <: 40) :> 8`,
				ast: `(:> (<: (call typeident 1) 40) 8)`,
				out: ['4294967296'],
			});
			expr({
				src: `(Int64(255) <: 32) & (Int64(15) <: 32)`,
				ast: `(& (<: (call typeident 255) 32) (<: (call typeident 15) 32))`,
				out: ['64424509440'],
			});
			expr({
				src: `(Int64(1) <: 40) | 5`,
				ast: `(| (<: (call typeident 1) 40) 5)`,
				out: ['1099511627781'],
			});
			expr({
				src: `(Int64(3) <: 40) ^ (Int64(1) <: 40)`,
				ast: `(^ (<: (call typeident 3) 40) (<: (call typeident 1) 40))`,
				out: ['2199023255552'],
			});
			expr({
				src: `~(Int64(1) <: 40)`,
				ast: `(~ (<: (call typeident 1) 40))`,
				out: ['-1099511627777'],
			});
		});

		h('String(Float64)', ({ expr }) => {
			expr({
				src: `String(1.5)`,
				ast: `(call typeident 1.5)`,
				out: ['1.5'],
			});
			expr({
				src: `String(0.5)`,
				ast: `(call typeident 0.5)`,
				out: ['0.5'],
			});
			expr({
				src: "'v=${0.5}'",
				ast: "(interp 0.5)",
				out: ['v=0.5'],
			});
		});

		h('Numeric promotion', ({ expr }) => {
			expr({
				src: `1 + 1.5`,
				ast: `(+ 1 1.5)`,
				out: ['2.5'],
			});
			expr({
				pre: `a: Int32 = 1; b: Float64 = 1.5`,
				src: `a + b`,
				ast: `(+ :a :b)`,
				out: ['2.5'],
			});
			// A literal with a decimal point or exponent is Float64 by
			// syntax even when its value is integral, so `9.0 / 2` is float
			// division (4.5), not integer division (4).
			expr({
				src: `9.0 / 2`,
				ast: `(/ 9 2)`,
				out: ['4.5'],
			});
			expr({
				src: `1.5e1 / 2`,
				ast: `(/ 15 2)`,
				out: ['7.5'],
			});
			expr({
				src: `9 / 2`,
				ast: `(/ 9 2)`,
				out: ['4'],
			});
		});

		h('Conditional operator', ({ expr, compileError }) => {
			compileError({
				src: `main { (1 ? 2 : 3) >> out }`,
				expected: 'compile-time constant',
			});
			compileError({
				src: `main { (1 < 2 ? 5 : 10) >> out }`,
				expected: 'compile-time constant',
			});
			compileError({
				src: `main { (true ? 5 : 10) >> out }`,
				expected: 'compile-time constant',
			});
			expr({
				src: `loop >> { $ >= 3 ? break : $ }`,
				ast: `(>> loop (fn @sequence (? (>= $ 3) break $)))`,
				out: ['0', '1', '2'],
			});
			expr({
				pre: `pick = (b: Bool): Int32 { next b ? 10 : 20 }`,
				src: `pick(true)`,
				ast: `(call :pick :true)`,
				out: ['10'],
			});
			compileError({
				src: `main { 1 > 10 ? 'big' >> out }`,
				expected: 'requires both branches',
			});
			expr({
				src: `[1, 2, 3] >> each >> Int32 { $ * 2 }`,
				ast: `(>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident ?) (* $ 2)))`,
				out: ['2', '4', '6'],
			});
			expr({
				src: `[1, 2, 3] >> each >> Int32 { $ > 1 ? $ }`,
				ast: `(>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident ?) (? (> $ 1) $)))`,
				out: ['2', '3'],
			});
			compileError({
				src: `main { 5 >> Int32 { void } }`,
				expected: 'cannot be emitted',
			});
			compileError({
				src: `main { 5 ? next 1 : next 2 >> out }`,
				expected: '`next` is not allowed',
			});
		});
	});

	h('Keywords', ({ p }) => {
		p('The following keywords are reserved.', ({ token }) => {
			token('break', 'Stop the enclosing pipeline chain', 'break');
			token(
				'done',
				"End the enclosing function's emission sequence",
				'done',
			);
			token('export', 'Export module symbol', 'export');
			token(
				'loop',
				'Infinite emitter primitive (yields 0, 1, 2, ...)',
				'loop',
			);
			token('main', 'Source file entry point', 'main');
			token('next', 'Emit the next value from a function', 'next');
			token('type', 'Define a type alias or structure', 'type');
		});
	});

	h('Number Literals', ({ expr, match, throws }) => {
		match('42 4_2 0600 0_600', 'number', 'number', 'number', 'number');
		expr({ src: 'nan', ast: ':nan' });
		expr({ src: 'infinity', ast: ':infinity' });

		match(`0b101010110101010 0b_0001101010_101`, 'number', 'number');

		expr({
			src: `0xBadFace; 0xBad_Face; 0x_67_7a_2f_cc_40_c6`,
			ast: '195951310 195951310 113774485586118',
		});
		expr({
			src: '72.40; 072.40; 2.71828',
			ast: '72.4 72.4 2.71828',
		});
		expr({
			src: `1.5e2; 6.67428e-11; 1E6; 0.15e+0_2`,
			ast: '150 6.67428e-11 1000000 15',
		});

		throws(() => match('0.'), {
			position: { start: 0, end: 2 },
		});
		throws(() => match('0x3h 10'), {
			position: { start: 0, end: 4 },
		});
		throws(() => match('0b12'), {
			position: { start: 0, end: 4 },
		});
		throws(() => match('  12f2'), {
			position: { start: 2, end: 5 },
		});
		throws(() => match('1_.5'));
		throws(() => match('1.5e_1'));
		throws(() => match('1.5e1_'));
		throws(() => match('42_'));
		throws(() => match('4__2'));
		throws(() => match('0_xBadFace'));
	});

	h('Boolean Literals', ({ expr }) => {
		expr({ src: 'true', ast: ':true' });
		expr({ src: 'false', ast: ':false' });
	});

	h('String Literals', ({ h, match, expr }) => {
		match(`'variable length \\'string\\''`, 'string');
		match(
			`'
        Multiline
        String
    '`,
			'string',
		);
		expr({
			p: 'A literal may span lines; every source line break (LF, CRLF, lone CR) becomes exactly `\\n`, so content is independent of the file’s line-ending style. Normalization precedes escape decoding — an explicit `\\r` survives. Continuation-line indentation is kept as written.',
			src: "'a\nb' == 'a\r\nb'",
			ast: "(== 'a\nb' 'a\r\nb')",
			out: ['true'],
		});
		expr({
			src: "length('a\r\nb')",
			ast: "(call :length @intrinsic 'a\r\nb')",
			out: ['3'],
		});
		match(
			"'${1}+${1}=${1+1}'",
			'strhead',
			'number',
			'strmid',
			'number',
			'strmid',
			'number',
			'+',
			'number',
			'strtail',
		);
		match("'no holes'", 'string');

		h('Escape Sequences', ({ expr, compileError }) => {
		 expr({
				src: `'line\\nA\\u{42}'`,
				ast: "'line\\nA\\u{42}'",
				out: ['line\nAB'],
			});
		 expr({
				src: `'a\\nb\\rc\\td\\'e\\00f'`,
				ast: `'a\\nb\\rc\\td\\'e\\00f'`,
				out: ["a\nb\rc\td'e\0f"],
			});
		 expr({
				src: `'\\41\\30\\"'`,
				ast: `'\\41\\30\\"'`,
				out: ['A0"'],
			});
			compileError({
				src: `main { '\\q' >> out }`,
				expected: 'Invalid string escape',
			});
		});

		h('Interpolation', ({ expr, compileError }) => {
			expr({
				src: "'${Char(65)}'",
				ast: `(interp (call typeident 65))`,
				out: ['A'],
			});
			expr({
				src: "'n=${5}'",
				ast: `(interp 5)`,
				out: ['n=5'],
			});
			expr({
				src: "'${Uint8(65)}'",
				ast: `(interp (call typeident 65))`,
				out: ['65'],
			});
			expr({
				src: "'${'x'}${'y'}'",
				ast: `(interp 'x' 'y')`,
				out: ['xy'],
			});
			expr({
				src: "'pre-${'mid'}-post'",
				ast: `(interp 'mid')`,
				out: ['pre-mid-post'],
			});
			expr({
				src: "'${'a'}${Char(66)}${'c'}'",
				ast: `(interp 'a' (call typeident 66) 'c')`,
				out: ['aBc'],
			});
			expr({
				src: "'a${'b${'c'}d'}e'",
				ast: `(interp (interp 'c'))`,
				out: ['abcde'],
			});
			expr({
				pre: "g: String = 'hi'",
				src: "'${g}!'",
				ast: `(interp :g)`,
				out: ['hi!'],
			});
			expr({
				src: "'${'ab'}${'c'}' == 'abc'",
				ast: `(== (interp 'ab' 'c') 'abc')`,
				out: ['true'],
			});
			expr({
				src: "'\\${x}'",
				ast: "'\\${x}'",
				out: ['${x}'],
			});
			compileError({
				src: "main { '${[1, 2]}' >> out }",
				expected: 'cannot convert',
			});
		});
	});

	h('Char', ({ expr, compileError }) => {
		expr({
			src: `String(Char(65))`,
			ast: `(call typeident (call typeident 65))`,
			out: ['A'],
		});
		expr({
			src: `String(Char(Uint8(66)))`,
			ast: `(call typeident (call typeident (call typeident 66)))`,
			out: ['B'],
		});
		compileError({
			src: `main { Char(65) + Char(66) >> out }`,
			expected: 'cannot be applied',
		});
		expr({
			src: `Char(0x110000) == Char(65533)`,
			ast: `(== (call typeident 1114112) (call typeident 65533))`,
			out: ['true'],
		});
		expr({
			src: `Char(0xD800) == Char(65533)`,
			ast: `(== (call typeident 55296) (call typeident 65533))`,
			out: ['true'],
		});
		expr({
			src: `Char(233)`,
			ast: `(call typeident 233)`,
			out: ['é'],
		});
		expr({
			src: `Char(8364)`,
			ast: `(call typeident 8364)`,
			out: ['€'],
		});
		expr({
			src: `Char(128512)`,
			ast: `(call typeident 128512)`,
			out: ['😀'],
		});
		expr({
			src: `Char(0x110000)`,
			ast: `(call typeident 1114112)`,
			out: ['�'],
		});
		expr({
			src: `length(String(Char(8364)))`,
			ast: `(call :length @intrinsic (call typeident (call typeident 8364)))`,
			out: ['3'],
		});
	});

	h('Function overloads', ({ expr, compileError }) => {
		expr({
			p: 'An overloaded name is a set of arms; a call selects the single arm whose parameter type accepts the argument. Dispatch is forward — the argument type chooses the arm — and never depends on the type expected of the result.',
			pre: 'size = (n: Int32): Int32 { n } | (s: String): Int32 { length(s) }',
			src: 'size(5)',
			ast: '(call :size 5)',
			out: ['5'],
		});
		expr({
			p: 'A different argument type selects a different arm of the same overload.',
			pre: 'size = (n: Int32): Int32 { n } | (s: String): Int32 { length(s) }',
			src: "size('abc')",
			ast: "(call :size 'abc')",
			out: ['3'],
		});
		compileError({
			p: 'Every arm of an overload must return the same type. An overload is one operation with many input types, not unrelated functions sharing a name, so the result type never depends on which arm ran; arms that disagree on the return type are rejected.',
			src: "f = (n: Int32): Int32 { n } | (s: String): Bool { length(s) == 0 }; main { f(5) >> out }",
			expected: 'must return the same type',
		});
		compileError({
			p: 'Two arms may not accept the same input type. Overload resolution must have a single answer, so a dispatch with two arms for one parameter type is rejected as ambiguous rather than silently preferring one.',
			src: "f = (n: Int32): Int32 { n } | (m: Int32): Int32 { m }; main { f(5) >> out }",
			expected: 'ambiguous overload',
		});
		expr({
			p: '`extend name (param: T): R { … }` adds an arm to an existing overload, dispatched by `T` like any other arm — how an overload defined in one place gains new input types elsewhere.',
			pre: "size = (n: Int32): Int32 { n }; extend size (s: String): Int32 { length(s) }",
			src: "size('abc')",
			ast: "(call :size 'abc')",
			out: ['3'],
		});
		compileError({
			p: '`extend` may only add to a name that is already an overload. Extending an undefined name is an error, so a misspelling cannot silently create a new one-arm function.',
			src: "extend nope (n: Int32): Int32 { n }; main { }",
			expected: 'not a dispatch',
		});
		compileError({
			p: 'An arm added with `extend` must return the overload’s established return type — the same uniform-return rule that governs the original arms.',
			src: "size = (n: Int32): Int32 { n }; extend size (s: String): Bool { true }; main { size(5) >> out }",
			expected: 'must return the same type',
		});
		compileError({
			p: 'An `extend` arm may not accept an input type an existing arm already handles; overlapping arms are rejected as ambiguous, exactly as within a single definition.',
			src: "size = (n: Int32): Int32 { n }; extend size (m: Int32): Int32 { m }; main { size(5) >> out }",
			expected: 'ambiguous overload',
		});
	});

	h('Type constructors', ({ expr, compileError }) => {
		expr({
			p: 'A type used as a call is its constructor — an overload keyed by the type whose arms all return that type. `String(x)` converts a value to its textual form by dispatching on the input type (the former `toString`, now retired).',
			src: 'String(true)',
			ast: '(call typeident :true)',
			out: ['true'],
		});
		expr({
			p: 'A narrower int widens to a wider int arm, the dispatch rule.',
			src: 'String(Uint8(200))',
			ast: '(call typeident (call typeident 200))',
			out: ['200'],
		});
		expr({
			p: 'A `String` argument is the identity — already text.',
			src: "String('already')",
			ast: "(call typeident 'already')",
			out: ['already'],
		});
		expr({
			p: 'A type’s default constructor takes its own structural value — the explicit spelling of the structural-to-nominal re-brand. A field-less error constructs with `Boom()` (the trace slot gives it existence); a plain type with no structure cannot even be declared.',
			pre: 'type Point = [ x: Int32, y: Int32 ]; dist = (p: Point): Int32 { p.x + p.y }',
			src: 'dist(Point([ x = 3, y = 4 ]))',
			ast: '(call :dist (call typeident (data (, (propdef :x ? 3) (propdef :y ? 4)))))',
			out: ['7'],
		});
		compileError({
			p: 'A structureless type is Void itself (`[]` is Void) — it has no values, so the declaration is rejected, not just its construction.',
			src: 'type Unit = []; main { }',
			expected: 'has no structure',
		});
		compileError({
			src: 'type Unit = Void; main { }',
			expected: 'has no structure',
		});
		compileError({
			src: 'type Point = [ x: Int32, y: Int32 ]; main { p = Point([ z = 1 ]); p.x >> out }',
			expected: 'not assignable to "Point"',
		});
		expr({
			p: '`extend String (…): String` adds a to-text arm for a new input type: this is how a user type gains a `String(x)` conversion, and how the built-in `Int32`/`Bool` arms are themselves defined.',
			pre: "type Celsius = Int32; extend String (c: Celsius): String { 'cold' }",
			src: 'String(Celsius(5))',
			ast: '(call typeident (call typeident 5))',
			out: ['cold'],
		});
		compileError({
			p: 'Every arm of a type constructor must return that type — `String(x)` always yields a `String` whatever the input — so an arm declaring any other return type is rejected. This is the uniform-return rule, pinned to the type by the constructor’s name.',
			src: "type Celsius = Int32; extend String (c: Celsius): Int32 { 0 }; main { String(Celsius(5)) >> out }",
			expected: 'must return String',
		});
	});

	h('Data Blocks', ({ expr, compileError, rule }) => {
		expr({
			src: `[ 'string', 2, true, 4.5 ]`,
			ast: `(data (, 'string' 2 :true 4.5))`,
		});
		expr({
			src: `[ 10 ] == 10`,
			ast: `(== (data 10) 10)`,
			out: ['true'],
		});
		expr({
			src: `[ label = 'string', 2 ]`,
			ast: `(data (, (propdef :label ? 'string') 2))`,
		});
		expr({
			src: `[ first = 'a', second = 'b' ].first`,
			ast: `(. (data (, (propdef :first ? 'a') (propdef :second ? 'b'))) :first)`,
			out: ['a'],
		});
		expr({
			src: `[ 10, 20, 30 ].1`,
			ast: `(. (data (, 10 20 30)) 1)`,
			out: ['20'],
		});
		expr({
			src: `[ x = 10, y = 20 ].0`,
			ast: `(. (data (, (propdef :x ? 10) (propdef :y ? 20))) 0)`,
			out: ['10'],
		});
		expr({
			pre: `double = (n: Int32): Int32 { n + n }; math = [ d = double ]`,
			src: `math.d(5)`,
			ast: `(call (. :math :d) 5)`,
			out: ['10'],
		});
		expr({
			src: `[ 1, x = 2, 3 ]`,
			ast: `(data (, 1 (propdef :x ? 2) 3))`,
		});
		compileError({
			src: `main { [ x = 1, x = 2 ] >> out }`,
			expected: 'Duplicate label "x"',
		});
		expr({
			src: `[ name: var = 'Alice', :var = 30 ]`,
			ast: `(data (, (propdef @variable :name ? 'Alice') (propdef @variable ? ? 30)))`,
		});
		rule({
			p: 'Positional members type like labeled ones wherever they appear \u2014 `d.0` is the member, not a fallback scalar.',
			src: `main { d = [ 'abcd\${7}', 42 ]; length(d.0) >> out; d.1 >> out }`,
			ast: `(root (main (def :d ? (data (, (interp 7) 42))) (>> (call :length @intrinsic (. :d 0)) :out) (>> (. :d 1) :out)))`,
			out: ['5', '42'],
		});
		rule({
			p: 'A one-element block collapses to its element \u2014 as a value (`[x]` is `x`) and as a type (`[T]` is `T`); `[\u2026]` is a fixed product, not a variable-length collection. So a `[String]` parameter is a `String`.',
			src: `wrap = (t: [String]): Int32 { length(t) };
main { wrap('hello') >> out }`,
			ast: `(root (def :wrap ? (fn @sequence (parameter :t (data (propdef ? typeident ?)) ?) typeident (call :length @intrinsic :t))) (main (>> (call :wrap 'hello') :out)))`,
			out: ['5'],
		});
		rule({
			src: `bump = (n: [Int32]): Int32 { n + 1 };
main { bump(41) >> out }`,
			ast: `(root (def :bump ? (fn @sequence (parameter :n (data (propdef ? typeident ?)) ?) typeident (+ :n 1))) (main (>> (call :bump 41) :out)))`,
			out: ['42'],
		});
		compileError({
			p: 'Because `[String]` is `String`, a multi-element block is a distinct product type and is rejected \u2014 not silently misread as a one-element collection.',
			src: `wrap = (t: [String]): Int32 { length(t) };
main { wrap([ 'p', 'q' ]) >> out }`,
			expected: 'not assignable',
		});
		expr({
			src: `[ 1, 2 ] >> each`,
			ast: `(>> (data (, 1 2)) :each)`,
			out: ['1', '2'],
		});
		// Streaming non-Int32 elements: the scalar-lift slot must use the
		// element's wasm type (e.g. f64), not a hardcoded i32.
		expr({
			src: `[ 1.5, 2.5, 3.5 ] >> each`,
			ast: `(>> (data (, 1.5 2.5 3.5)) :each)`,
			out: ['1.5', '2.5', '3.5'],
		});
		expr({
			src: `reverse([ 1.5, 2.5, 3.5 ])`,
			ast: `(call :reverse (data (, 1.5 2.5 3.5)))`,
			out: ['3.5', '2.5', '1.5'],
		});
		expr({
			pre: `sum = (b) { b.0 + b.1 }`,
			src: `[ 10, 20 ] >> sum`,
			ast: `(>> (data (, 10 20)) :sum)`,
			out: ['30'],
		});
		expr({
			src: `[ x = 1, y = 2 ] >> each`,
			ast: `(>> (data (, (propdef :x ? 1) (propdef :y ? 2))) :each)`,
			out: ['1', '2'],
		});
		expr({
			src: `([ [1, 2], [3, 4] ].1).0`,
			ast: `(. (. (data (, (data (, 1 2)) (data (, 3 4)))) 1) 0)`,
			out: ['3'],
		});
		expr({
			src: `[ [1, 2], [3, 4] ] >> each >> each`,
			ast: `(>> (data (, (data (, 1 2)) (data (, 3 4)))) :each :each)`,
			out: ['1', '2', '3', '4'],
		});
		rule({
			src: `main { [ [1, 2], [3, 4] ] >> each >> (p) { p.0 * p.1 } >> out }`,
			ast: `(root (main (>> (data (, (data (, 1 2)) (data (, 3 4)))) :each (fn @sequence (parameter :p ? ?) (* (. :p 0) (. :p 1))) :out)))`,
			out: ['2', '12'],
		});
		compileError({
			src: `main { [1, 2] >> each >> Int32:Int32 { 'oops' } >> out }`,
			expected: 'is not assignable',
		});
		rule({
			p: 'A block never splices: its items are its elements, labeled or not. `each` over record elements yields each element as a unit — a borrow of the block — so collections of records stream, index, and zip as written.',
			src: `type Point = [ x: Int32, y: Int32 ];
main { ps = [ [ x = 1, y = 2 ], [ x = 3, y = 4 ] ]; length(ps) >> out; ps >> each >> (p: Point) { p.x + p.y } >> out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (main (def :ps ? (data (, (data (, (propdef :x ? 1) (propdef :y ? 2))) (data (, (propdef :x ? 3) (propdef :y ? 4)))))) (>> (call :length @intrinsic :ps) :out) (>> :ps :each (fn @sequence (parameter :p typeident ?) (+ (. :p :x) (. :p :y))) :out)))`,
			out: ['2', '3', '7'],
		});
	});

	h('Code Blocks', ({ expr, ast, h, compileError }) => {
		expr({
			src: `(a) { a }`,
			ast: `(fn @sequence (parameter :a ? ?) :a)`,
		});
		expr({
			src: `(a: Int32, b: Int32) { a + b }`,
			ast: `(fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (+ :a :b))`,
		});
		ast({
			src: `helper = (f: Fn) { { f() } }`,
			ast: `(def :helper ? (fn @sequence (parameter :f typeident ?) (fn @sequence (call :f ?))))`,
		});
		expr({
			src: `[value = 5] >> { 10 + $.value }`,
			ast: `(>> (data (propdef :value ? 5)) (fn @sequence (+ 10 (. $ :value))))`,
			out: ['15'],
		});
		expr({
			src: `{ 1 + 2 }`,
			ast: `(fn @sequence (+ 1 2))`,
			out: ['3'],
		});
		expr({
			src: `{ 1, 2, 3 }`,
			ast: `(fn @sequence (, 1 2 3))`,
			out: ['1', '2', '3'],
		});
		expr({
			src: `{ }`,
			ast: `(fn @sequence)`,
			out: [],
		});
		compileError({
			src: `main { () { } >> out }`,
			expected: 'Empty `() { }`',
		});
		compileError({
			src: `main { { next 1 } >> out }`,
			expected: '`next` is not allowed in auto-emit',
		});
		compileError({
			src: `main { { done } >> out }`,
			expected: '`done`',
		});
		compileError({
			src: `main { { break } >> out }`,
			expected: '`break`',
		});
		compileError({
			src: `f = { next next 1; }; main { f() >> out }`,
			expected: 'Expected expression',
		});
		compileError({
			src: `f = (x: Int32) { x }; main { f(next 1) >> out }`,
			expected: 'Expected ")"',
		});
		expr({
			pre: `x = { $ }`,
			src: `x(1, 2, 3)`,
			ast: `(call :x (, 1 2 3))`,
			out: ['1', '2', '3'],
		});
	 expr({
			pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
			src: `add(b = 1, a = 2)`,
			ast: `(call :add (, (propdef :b ? 1) (propdef :a ? 2)))`,
			out: ['3'],
		});
		expr({
			pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
			src: `addOne(void)`,
			ast: `(call :addOne :void)`,
			out: ['42'],
		});

		h('Recursion', ({ rule }) => {
			rule({
				src: `factorial = (n: Int32): Int32 { (n <= 1) ? 1 : n * factorial(n - 1) }; main { factorial(0) >> out; factorial(1) >> out; factorial(2) >> out; factorial(3) >> out; factorial(4) >> out; factorial(5) >> out; }`,
				ast: '(root (def :factorial ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 1) 1 (* :n (call :factorial (- :n 1)))))) (main (>> (call :factorial 0) :out) (>> (call :factorial 1) :out) (>> (call :factorial 2) :out) (>> (call :factorial 3) :out) (>> (call :factorial 4) :out) (>> (call :factorial 5) :out)))',
				out: ['1', '1', '2', '6', '24', '120'],
			});

			rule({
				src: `fib = (n: Int32): Int32 { n <= 1 ? n : fib(n - 1) + fib(n - 2) }; main { fib(0) >> out; fib(1) >> out; fib(2) >> out; fib(3) >> out; fib(4) >> out; fib(5) >> out; fib(6) >> out; }`,
				ast: '(root (def :fib ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2)))))) (main (>> (call :fib 0) :out) (>> (call :fib 1) :out) (>> (call :fib 2) :out) (>> (call :fib 3) :out) (>> (call :fib 4) :out) (>> (call :fib 5) :out) (>> (call :fib 6) :out)))',
				out: ['0', '1', '1', '2', '3', '5', '8'],
			});

			rule({
				src: `ackermann = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1)))) }; main { ackermann(1, 3) >> out; ackermann(2, 3) >> out; ackermann(3, 3) >> out; ackermann(1, 5) >> out; ackermann(2, 5) >> out; ackermann(3, 5) >> out; }`,
				ast: `(root (def :ackermann ? (fn @sequence (parameter :m typeident ?) (parameter :n typeident ?) typeident (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1))))))))) (main (>> (call :ackermann (, 1 3)) :out) (>> (call :ackermann (, 2 3)) :out) (>> (call :ackermann (, 3 3)) :out) (>> (call :ackermann (, 1 5)) :out) (>> (call :ackermann (, 2 5)) :out) (>> (call :ackermann (, 3 5)) :out)))`,
				out: ['5', '9', '61', '7', '13', '253'],
			});

			// A function used as its OWN pipe stage (`(n - 1) >> f` inside `f`)
			// must compile — the stage inliner emits a real recursive call on
			// self-reference instead of inlining its own body forever (which
			// overflowed the compiler). No `out`: this fn has no base case, so we
			// only assert the compiler terminates and produces a module.
			rule({
				src: `f = (n: Int32): Int32 { (n - 1) >> f }; main { f(3) >> out }`,
				ast: `(root (def :f ? (fn @sequence (parameter :n typeident ?) typeident (>> (- :n 1) :f))) (main (>> (call :f 3) :out)))`,
			});

			// Self-pipe recursion with a base case runs and returns a value: the
			// recursive `(n - 1) >> f` stage is a real call, the ternary branch
			// leaves its value (it does not emit into the outer `>> out`).
			rule({
				src: `f = (n: Int32): Int32 { n <= 0 ? 100 : ((n - 1) >> f) }; main { f(3) >> out }`,
				ast: `(root (def :f ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 0) 100 (>> (- :n 1) :f)))) (main (>> (call :f 3) :out)))`,
				out: ['100'],
			});

			// The final stage of a pipe in tail position emits `return_call`,
			// so self-pipe recursion stays flat — 1M deep does not grow the stack.
			rule({
				src: `f = (n: Int32): Int32 { n <= 0 ? 100 : ((n - 1) >> f) }; main { f(1000000) >> out }`,
				ast: `(root (def :f ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 0) 100 (>> (- :n 1) :f)))) (main (>> (call :f 1000000) :out)))`,
				out: ['100'],
			});
		});

		h('Emitting Values', ({ expr }) => {
			expr({
				pre: `emitValues = { next(1, 2, 3); done; }`,
				src: `emitValues()`,
				ast: `(call :emitValues ?)`,
				out: ['1', '2', '3'],
			});
			expr({
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: ['2', '3'],
			});
			expr({
				pre: `emit = { done }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: [],
			});
			expr({
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $, $ + 10 }`,
				ast: `(>> (call :emit ?) (fn @sequence (, $ (+ $ 10))))`,
				out: ['1', '11', '2', '12'],
			});
		});

		h('Completion', ({ expr }) => {
			expr({
				pre: 'demo = { next(1); done; next(2); }',
				src: 'demo()',
				ast: '(call :demo ?)',
				out: ['1'],
			});
		});

		h('Chaining', ({ expr }) => {
			expr({
				pre: `
a = {
	add4 = (a: Int32) { a + 4 };
	times2 = (a: Int32) { a * 2 };
	add4times2 = { $ >> add4 >> times2 };
	next(10 >> add4times2);
}`,
				src: `a()`,
				ast: '(call :a ?)',
				out: ['28'],
			});
		});

		h('Re-emission & propagation', ({ rule, compileError }) => {
			compileError({
				src: `inner = { next(1, 2); done; }; outer = { inner(); next(99); done; }; main { outer() >> out }`,
				expected: 'value is not consumed',
			});
			rule({
				src: `inner = { next(1, 2); done; }; outer = { next inner(); next(99); done; }; main { outer() >> out }`,
				ast: `(root (def :inner ? (fn (next (, 1 2)) done)) (def :outer ? (fn (next (call :inner ?)) (next 99) done)) (main (>> (call :outer ?) :out)))`,
				out: ['1', '2', '99'],
			});
			rule({
				src: `inner = { next(1, 2); done; }; outer = { next inner() }; main { outer() >> out }`,
				ast: `(root (def :inner ? (fn (next (, 1 2)) done)) (def :outer ? (fn (next (call :inner ?)))) (main (>> (call :outer ?) :out)))`,
				out: ['1', '2'],
			});
			compileError({
				src: `outer = { { next(1, 2); done; }; next(99); done; }; main { outer() >> out }`,
				expected: 'value is not consumed',
			});
		});
	});

	h('Anonymous Blocks (Shape 1: untyped `{ body }`)', ({ p }) => {
		p(
			`Anonymous blocks \`{ body }\` are first-class function values. The body has two forms:
			 (1) auto-emit — value-expressions separated by \`,\` (no \`;\`), each auto-emits;
			 (2) statement body — statements separated by \`;\`, using \`next\` to emit.
			 Inside the block, \`$\` is the upstream value or call argument.`,
			({ expr, compileError }) => {
				expr({
					src: `{ }`,
					ast: `(fn @sequence)`,
					out: [],
				});
				expr({
					src: `{ 5 }`,
					ast: `(fn @sequence 5)`,
					out: ['5'],
				});
				expr({
					src: `{ 1, 2, 3 }`,
					ast: `(fn @sequence (, 1 2 3))`,
					out: ['1', '2', '3'],
				});
				expr({
					src: `5 >> { $ + 1 }`,
					ast: `(>> 5 (fn @sequence (+ $ 1)))`,
					out: ['6'],
				});
				expr({
					src: `[x = 10] >> { $.x }`,
					ast: `(>> (data (propdef :x ? 10)) (fn @sequence (. $ :x)))`,
					out: ['10'],
				});
				expr({
					src: `{ next 5; next 6; }`,
					ast: `(fn (next 5) (next 6))`,
					out: ['5', '6'],
				});
				expr({
					src: `loop >> { break }`,
					ast: `(>> loop (fn break))`,
					out: [],
				});
				compileError({
					src: `main { { next 5 } >> out }`,
					expected: '`next` is not allowed',
				});
				compileError({
					src: `main { { done } >> out }`,
					expected: '`done`',
				});
				compileError({
					src: `main { { 5; 6; } >> out }`,
					expected: 'no emission',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 2: type-prefix `T { body }`)', ({ p }) => {
		p(
			`A type expression followed by \`{ body }\` annotates the implicit \`$\` parameter
			 with type \`T\`. The body is auto-emit; emitted values determine the return type.
			 The type prefix may be: a simple typeident (\`Int32\`), a union (\`Int32 | String\`),
			 a tuple (\`[Int32, String]\`), or a labeled record (\`[a: Int32, b: Int32]\`).`,
			({ expr, compileError }) => {
				expr({
					src: `5 >> Int32 { $ + 1 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident ?) (+ $ 1)))`,
					out: ['6'],
				});
				expr({
					src: `5 >> Int32 { 1, 2, 3 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident ?) (, 1 2 3)))`,
					out: ['1', '2', '3'],
				});
				expr({
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { next n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ + 1 } | Error { 99 }`,
					ast: `(>> (call :risky 0) (| (fn @sequence (parameter ? typeident ?) (+ $ 1)) (fn @sequence (parameter ? typeident ?) 99)))`,
					out: ['99'],
				});
				expr({
					src: `true >> Bool { $ }`,
					ast: `(>> :true (fn @sequence (parameter ? typeident ?) $))`,
					out: ['true'],
				});
				expr({
					pre: `mixed = (): Int32 | String { next 42 }`,
					src: `mixed() >> Int32 | String { $ }`,
					ast: `(>> (call :mixed ?) (fn @sequence (parameter ? typeident ?) $))`,
					out: ['42'],
				});
				expr({
					src: `[1, 'hi'] >> [Int32, String] { $.0 }`,
					ast: `(>> (data (, 1 'hi')) (fn @sequence (parameter ? (data (, (propdef ? typeident ?) (propdef ? typeident ?))) ?) (. $ 0)))`,
					out: ['1'],
				});
				expr({
					src: `[a = 10, b = 20] >> [a: Int32, b: Int32] { $.a + $.b }`,
					ast: `(>> (data (, (propdef :a ? 10) (propdef :b ? 20))) (fn @sequence (parameter ? (data (, (propdef :a typeident ?) (propdef :b typeident ?))) ?) (+ (. $ :a) (. $ :b))))`,
					out: ['30'],
				});
				compileError({
					src: `main { 5 >> Int32 { } >> out }`,
					expected: 'empty',
				});
				compileError({
					src: `main { 5 >> [1, 2] { $ } >> out }`,
					expected: 'expected type',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 3: type-prefix with return `T:R { body }`)', ({ p }) => {
		p(
			`A type-prefix block may assert its emitted type via \`T:R\`; the body
			 (auto-emit or statement body) must produce values of type \`R\`. "Emits
			 nothing" is inferred, never written: a body of consumer calls makes the
			 stage terminal — any downstream stage is unreachable — and \`T:Void\` is
			 rejected like every other \`Void\` annotation.`,
			({ expr, compileError, rule }) => {
				expr({
					src: `5 >> Int32:Int32 { $ * 2 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident typeident) (* $ 2)))`,
					out: ['10'],
				});
				expr({
					src: `5 >> Int32:Bool { $ > 0 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident typeident) (> $ 0)))`,
					out: ['true'],
				});
				rule({
					src: `main { 5 >> Int32 { out($) } }`,
					ast: `(root (main (>> 5 (fn @sequence (parameter ? typeident ?) (call :out $)))))`,
					out: ['5'],
				});
				rule({
					src: `main { [1, 2, 3] >> each >> Int32 { out($) } }`,
					ast: `(root (main (>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident ?) (call :out $)))))`,
					out: ['1', '2', '3'],
				});
				expr({
					src: `5 >> Int32:Int32 { next $; next $ + 1; }`,
					ast: `(>> 5 (fn (parameter ? typeident typeident) (next $) (next (+ $ 1))))`,
					out: ['5', '6'],
				});
				compileError({
					src: `main { 5 >> Int32:Int32 { 'oops' } >> out }`,
					expected: 'is not assignable',
				});
				compileError({
					src: `main { 5 >> Int32 { out($) } >> Int32 { $ + 1 } >> out }`,
					expected: 'unreachable',
				});
				compileError({
					src: `main { 5 >> Int32:Void { out($) } }`,
					expected: 'return types are inferred',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 4: literal-type prefix `:T { body }`)', ({ p }) => {
		p(
			`A leading colon followed by a literal type creates an anonymous-slot block matching that literal type.
			 Use this for matching literal values (\`true\`, \`false\`, \`0\`, \`'on'\`, etc.).
			 Uppercase/named types use Shape 2 (\`T { body }\`) without the leading colon —
			 \`:Int32 { ... }\` is a compile error. Parens around a single anonymous slot
			 (\`(:T) { ... }\`) are likewise an error; the bare \`:T { ... }\` is canonical.`,
			({ expr, compileError }) => {
				expr({
					src: `true >> :true { 1 }`,
					ast: `(>> :true (fn @sequence (parameter ? typeident ?) 1))`,
					out: ['1'],
				});
				expr({
					src: `false >> :false { 0 }`,
					ast: `(>> :false (fn @sequence (parameter ? typeident ?) 0))`,
					out: ['0'],
				});
				expr({
					pre: `check = (n: Int32): Bool { next n > 0 }`,
					src: `check(5) >> :true { 'positive' } | :false { 'non-positive' }`,
					ast: `(>> (call :check 5) (| (fn @sequence (parameter ? typeident ?) 'positive') (fn @sequence (parameter ? typeident ?) 'non-positive')))`,
					out: ['positive'],
				});
				compileError({
					src: `main { loop >> :true { break } >> out }`,
					expected: 'does not consume',
				});
				expr({
					pre: `mode = (): 'on' | 'off' { next 'on' }`,
					src: `mode() >> :'on' { 'enabled' } | :'off' { 'disabled' }`,
					ast: `(>> (call :mode ?) (| (fn @sequence (parameter ? typeident ?) 'enabled') (fn @sequence (parameter ? typeident ?) 'disabled')))`,
					out: ['enabled'],
				});
				expr({
					src: `0 >> :0 | false | '' { 'falsy' }`,
					ast: `(>> 0 (fn @sequence (parameter ? typeident ?) 'falsy'))`,
					out: ['falsy'],
				});
				compileError({
					src: `main { 5 >> :Int32 { $ } >> out; }`,
					expected: 'use `Int32`',
				});
				compileError({
					src: `main { 5 >> (:Int32) { $ } >> out }`,
					expected: 'Parens',
				});
				compileError({
					pre: `check = (n: Int32): Bool { next n > 0 }`,
					src: `main { check(5) >> :true { 1 } >> out }`,
					expected: 'does not consume',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 6: single-named slot `(name: T) { body }`)', ({ p }) => {
		p(
			`\`(name: T) { body }\` is a single-slot pattern that matches by type and binds the
			 whole upstream value to a local name. Match rule: if upstream type equals/conforms
			 to \`T\`, bind. There is no field projection — to access one field of a multi-field
			 record, use Shape 2 (\`[a: T, b: T] { $.b }\`).

			 Body forms follow Shape 1: a single value-expression auto-emits; a statement body
			 (with \`;\`) uses \`next\` for emissions. A statement body whose only statements are
			 \`next\` of value-expressions is reducible — the compiler forces the shorter comma form.`,
			({ expr, compileError }) => {
				expr({
					src: `5 >> (n: Int32) { n + 1 }`,
					ast: `(>> 5 (fn @sequence (parameter :n typeident ?) (+ :n 1)))`,
					out: ['6'],
				});
				expr({
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { next n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ } | (e: Fail) { e.code }`,
					ast: `(>> (call :risky 0) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter :e typeident ?) (. :e :code))))`,
					out: ['7'],
				});
				expr({
					pre: `type Point = [x: Int32, y: Int32]; p: Point = [x = 3, y = 4]`,
					src: `p >> (q: Point) { q.x + q.y }`,
					ast: `(>> :p (fn @sequence (parameter :q typeident ?) (+ (. :q :x) (. :q :y))))`,
					out: ['7'],
				});
				expr({
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: ['10'],
				});
				expr({
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(n = 5)`,
					ast: `(call :double (propdef :n ? 5))`,
					out: ['10'],
				});
				expr({
					src: `5 >> (n: Int32) { doubled = n * 2; next doubled; next doubled + 1; }`,
					ast: `(>> 5 (fn (parameter :n typeident ?) (def :doubled ? (* :n 2)) (next :doubled) (next (+ :doubled 1))))`,
					out: ['10', '11'],
				});
				compileError({
					src: `main { 5 >> (n: Int32) { next n; next n + 1; } >> out }`,
					expected: 'reducible',
				});
				compileError({
					src: `main { [10, 20] >> (n: Int32) { n } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					src: `main { 5 >> (n: Int32) { next n } >> out }`,
					expected: '`next` is not allowed',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 7: single-named slot with return `(name: T): R { body }`)', ({ p }) => {
		p(
			`Shape 7 extends Shape 6 with an explicit return type \`R\`. Every emission from the body
			 (auto-emit or via \`next\`) must produce a value compatible with \`R\`. Without \`:R\`,
			 the return type is inferred; with \`:R\`, it is asserted and checked.`,
			({ expr, compileError, rule }) => {
				expr({
					pre: `double = (n: Int32): Int32 { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: ['10'],
				});
				expr({
					pre: `isPositive = (n: Int32): Bool { n > 0 }`,
					src: `isPositive(5)`,
					ast: `(call :isPositive 5)`,
					out: ['true'],
				});
				expr({
					pre: `type ParseErr = Error & [ code: Int32 ]; parseErr = (): ParseErr { [ code = 0 ] }; parseInt = (s: String): Int32 | Error { length(s) == 0 ? parseErr() : 42 }`,
					src: `parseInt('42')`,
					ast: `(call :parseInt '42')`,
					out: ['42'],
				});
				expr({
					pre: `square = (n: Int32): Int32 { half = n / 2; next half * 2; }`,
					src: `square(6)`,
					ast: `(call :square 6)`,
					out: ['6'],
				});
				rule({
					src: `print = (n: Int32) { out(n) }; main { 5 >> print }`,
					ast: `(root (def :print ? (fn @sequence (parameter :n typeident ?) (call :out :n))) (main (>> 5 :print)))`,
					out: ['5'],
				});
				expr({
					pre: `factorial = (n: Int32): Int32 { n <= 1 ? 1 : n * factorial(n - 1) }`,
					src: `factorial(5)`,
					ast: `(call :factorial 5)`,
					out: ['120'],
				});
				expr({
					pre: `pair = (n: Int32): [Int32, Int32] { [n, n + 1] }`,
					src: `pair(5) >> { $.0 + $.1 }`,
					ast: `(>> (call :pair 5) (fn @sequence (+ (. $ 0) (. $ 1))))`,
					out: ['11'],
				});
				expr({
					pre: `spread = (n: Int32): Int32 { half = n / 2; next half; next n - half; }`,
					src: `spread(10)`,
					ast: `(call :spread 10)`,
					out: ['5', '5'],
				});
				compileError({
					src: `main { double = (n: Int32): Int32 { 'oops' }; double(5) >> out; }`,
					expected: 'is not assignable',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 8: multi-slot destructure `(a, b) { body }`)', ({ p }) => {
		p(
			`Multi-slot patterns destructure their input into named slots. The fn's parameter
			 names define labels for \`$\`. Calls and chain piping conform to those labels:
			 positional args bind by slot order, labeled args reorder to match the fn's labels.
			 Mixing positional and labeled args in the same call is forbidden. Labels that don't
			 match the fn's parameter names are a compile error.`,
			({ expr, compileError }) => {
				expr({
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: ['3'],
				});
				expr({
					src: `[1, 2] >> (a: Int32, b: Int32) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (+ :a :b)))`,
					out: ['3'],
				});
				expr({
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `[b = 2, a = 1] >> sub`,
					ast: `(>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :sub)`,
					out: ['-1'],
				});
				expr({
					src: `[10, 20] >> (a, b) { a + b }`,
					ast: `(>> (data (, 10 20)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: ['30'],
				});
				expr({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: ['3'],
				});
				expr({
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `sub(b = 1, a = 2)`,
					ast: `(call :sub (, (propdef :b ? 1) (propdef :a ? 2)))`,
					out: ['1'],
				});
				expr({
					pre: `add3 = (a: Int32, b: Int32, c: Int32) { pair = a + b; next pair + c; }`,
					src: `add3(1, 2, 3)`,
					ast: `(call :add3 (, 1 2 3))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3] >> (a, b, c) { a + b + c }`,
					ast: `(>> (data (, 1 2 3)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (+ (+ :a :b) :c)))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3] >> (a, b) { a + b.0 + b.1 }`,
					ast: `(>> (data (, 1 2 3)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ (+ :a (. :b 0)) (. :b 1))))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3, 4] >> (a, b, c) { a + b + c.0 + c.1 }`,
					ast: `(>> (data (, 1 2 3 4)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (+ (+ (+ :a :b) (. :c 0)) (. :c 1))))`,
					out: ['10'],
				});
				expr({
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: ['3'],
				});
				compileError({
					src: `main { 5 >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					src: `main { [1, 2, 3] >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					src: `main { [1, 2, 3] >> (a: Int32, b: Int32) { a + b } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `main { add(x = 1, y = 2) >> out }`,
					expected: 'no match',
				});
				compileError({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `main { add(1, b = 2) >> out }`,
					expected: 'cannot mix',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 9: multi-slot destructure with return `(a, b): R { body }`)', ({ p }) => {
		p(
			`Shape 9 extends Shape 8 with an explicit return type \`R\`. Every emission from
			 the body must produce a value compatible with \`R\`. Same rules as Shape 7 (single
			 slot + return), but with multiple destructured parameters.`,
			({ expr, compileError }) => {
				expr({
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: ['3'],
				});
				expr({
					pre: `eq = (a: Int32, b: Int32): Bool { a == b }`,
					src: `eq(3, 3)`,
					ast: `(call :eq (, 3 3))`,
					out: ['true'],
				});
				expr({
					pre: `type DivErr = Error & [ code: Int32 ]; divErr = (): DivErr { [ code = 0 ] }; divide = (a: Int32, b: Int32): Int32 | Error { b == 0 ? divErr() : a / b }`,
					src: `divide(10, 2)`,
					ast: `(call :divide (, 10 2))`,
					out: ['5'],
				});
				expr({
					pre: `mid = (a: Int32, b: Int32, c: Int32): Int32 { sum = a + b + c; next sum / 3; }`,
					src: `mid(2, 4, 6)`,
					ast: `(call :mid (, 2 4 6))`,
					out: ['4'],
				});
				expr({
					pre: `printPair = (a: Int32, b: Int32) { out(a); out(b); }`,
					src: `printPair(1, 2)`,
					ast: `(call :printPair (, 1 2))`,
					out: ['1', '2'],
				});
				expr({
					pre: `swap = (a: Int32, b: Int32): [Int32, Int32] { [b, a] }`,
					src: `swap(1, 2) >> { $.0 - $.1 }`,
					ast: `(>> (call :swap (, 1 2)) (fn @sequence (- (. $ 0) (. $ 1))))`,
					out: ['1'],
				});
				expr({
					pre: `spread = (a: Int32, b: Int32): Int32 { next a; next b; }`,
					src: `spread(7, 11)`,
					ast: `(call :spread (, 7 11))`,
					out: ['7', '11'],
				});
				expr({
					pre: `ack = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ack(m - 1, 1) : ack(m - 1, ack(m, n - 1))) }`,
					src: `ack(2, 3)`,
					ast: `(call :ack (, 2 3))`,
					out: ['9'],
				});
				compileError({
					src: `main { bad = (a: Int32, b: Int32): Int32 { 'oops' }; bad(1, 2) >> out; }`,
					expected: 'is not assignable',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 12: parameter defaults `(name: T = expr) { body }`)', ({ p }) => {
		p(
			`A parameter may declare a default expression via \`= expr\`. The signature's type
			 is effectively \`T | Void\` for callers (they may pass \`void\` to use the default);
			 the body sees the narrowed concrete type \`T\` because the default substitution
			 happens at the param-binding step. Default expressions may reference earlier params.

			 Call rules:
			 - Positional: every slot must be specified. Pass \`void\` to use a defaulted slot's default.
			 - Named: only mention overrides; omitted slots use their defaults.
			 - Empty call \`f()\` requires a 0-param fn (no sugar for "all defaults"; use named or void).`,
			({ expr, compileError }) => {
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(void)`,
					ast: `(call :addOne :void)`,
					out: ['42'],
				});
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(5)`,
					ast: `(call :addOne 5)`,
					out: ['6'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(void, void)`,
					ast: `(call :pair (, :void :void))`,
					out: ['3'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(10, void)`,
					ast: `(call :pair (, 10 :void))`,
					out: ['12'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(b = 99)`,
					ast: `(call :pair (propdef :b ? 99))`,
					out: ['100'],
				});
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(n = void)`,
					ast: `(call :addOne (propdef :n ? :void))`,
					out: ['42'],
				});
				expr({
					pre: `relate = (a: Int32, b: Int32 = a + 1): Int32 { a + b }`,
					src: `relate(3, void)`,
					ast: `(call :relate (, 3 :void))`,
					out: ['7'],
				});
				compileError({
					pre: `f = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `main { f(void, 2) >> out }`,
					expected: 'not assignable',
				});
				compileError({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `main { addOne() >> out }`,
					expected: 'No matching overload',
				});
			},
		);
	});

	h('Assignment', ({ ast, rule, compileError }) => {
		ast({
			src: `host = 'localhost'`,
			ast: `(def :host ? 'localhost')`,
		});
		ast({
			src: `port = 8080`,
			ast: `(def :port ? 8080)`,
		});
		ast({
			src: `enabled = true`,
			ast: `(def :enabled ? :true)`,
		});
		ast({
			src: `retries: var = 0`,
			ast: `(def @variable :retries ? 0)`,
		});
		rule({
			src: `score: var = 0; main { score = score + 10; score >> out; }`,
			ast: `(root (def @variable :score ? 0) (main (= :score @variable (+ :score @variable 10)) (>> :score @variable :out)))`,
			out: ['10'],
		});
		compileError({
			src: `main { count = 1; count = 2 >> out; }`,
			expected: 'Cannot reassign immutable binding',
		});
		compileError({
			src: `main { a: Int32 >> out }`,
			expected: 'declaration without value',
		});
		compileError({
			src: `main { x = 1; demo = { x: Int32 = 2; next x; }; demo() >> out; }`,
			expected: 'Cannot redeclare block-scoped variable',
		});
		compileError({
			src: `main { unused = 42 >> out }`,
			expected: 'is declared but never used',
		});
	});

	h('Types', ({ expr, rule, compileError }) => {
		rule({
			src: `count: Int32 = 42; main { count >> out }`,
			ast: `(root (def :count typeident 42) (main (>> :count :out)))`,
			out: ['42'],
		});
		rule({
			src: `pi: Float64 = 3.14159; main { pi >> out }`,
			ast: `(root (def :pi typeident 3.14159) (main (>> :pi :out)))`,
			out: ['3.14159'],
		});
		rule({
			src: `name: String = 'Alice'; main { name >> out }`,
			ast: `(root (def :name typeident 'Alice') (main (>> :name :out)))`,
			out: ['Alice'],
		});
		expr({
			src: "'${Char(72)}${Char(105)}'",
			ast: `(interp (call typeident 72) (call typeident 105))`,
			out: ['Hi'],
		});
		expr({
			src: "'${'foo'}${'bar'}'",
			ast: `(interp 'foo' 'bar')`,
			out: ['foobar'],
		});
		expr({
			src: "'${'Hi'}${Char(33)}'",
			ast: `(interp 'Hi' (call typeident 33))`,
			out: ['Hi!'],
		});
		expr({
			src: `String(Char(72))`,
			ast: `(call typeident (call typeident 72))`,
			out: ['H'],
		});
		expr({
			src: "'${Uint16(233)}'",
			ast: `(interp (call typeident 233))`,
			out: ['233'],
		});
		expr({
			src: `Int32(2.5)`,
			ast: `(call typeident 2.5)`,
			out: ['2'],
		});
		compileError({
			src: `main { Int64('hello') >> out }`,
			expected: 'Cannot convert',
		});
		compileError({
			src: `main { Uint8([1, 2]) >> out }`,
			expected: 'Cannot convert',
		});
		compileError({
			src: `main { Float64('x') >> out }`,
			expected: 'Cannot convert',
		});
		expr({
			src: `[Uint8(72), Uint8(105)].1`,
			ast: `(. (data (, (call typeident 72) (call typeident 105))) 1)`,
			out: ['105'],
		});
		compileError({
			src: `s: String = [Uint8(72), Uint8(105)]`,
			expected: 'not assignable',
		});
		expr({
			src: `'abc' == 'abc'`,
			ast: `(== 'abc' 'abc')`,
			out: ['true'],
		});
		expr({
			src: `'abc' == 'abd'`,
			ast: `(== 'abc' 'abd')`,
			out: ['false'],
		});
		expr({
			src: `'ab' == 'abc'`,
			ast: `(== 'ab' 'abc')`,
			out: ['false'],
		});
		expr({
			src: "'${Char(104)}${Char(105)}' == 'hi'",
			ast: `(== (interp (call typeident 104) (call typeident 105)) 'hi')`,
			out: ['true'],
		});
		expr({
			src: `'abc' != 'abd'`,
			ast: `(!= 'abc' 'abd')`,
			out: ['true'],
		});
		rule({
			src: `flag: Bool = true; main { flag >> out }`,
			ast: `(root (def :flag typeident :true) (main (>> :flag :out)))`,
			out: ['true'],
		});
		rule({
			src: `mode: 'on' | 'off' = 'on'; main { mode >> out }`,
			ast: `(root (def :mode typeident 'on') (main (>> :mode :out)))`,
			out: ['on'],
		});
		compileError({
			src: `mode: 'on' | 'off' = 'invalid'`,
			expected: 'is not assignable',
		});
		rule({
			src: `n: Int32 | String = 42; main { n >> out }`,
			ast: `(root (def :n typeident 42) (main (>> :n :out)))`,
			out: ['42'],
		});
		rule({
			src: `type Point = [ x: Int32, y: Int32 ]; p: Point = [ x = 10, y = 20 ]; main { p.x >> out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :p typeident (data (, (propdef :x ? 10) (propdef :y ? 20)))) (main (>> (. :p :x) :out)))`,
			out: ['10'],
		});
		compileError({
			src: `type Celsius = [ deg: Int32 ]; type Fahrenheit = [ deg: Int32 ]; freezing = (): Celsius { [ deg = 0 ] }; f: Fahrenheit = freezing();`,
			expected: 'not assignable',
		});
		rule({
			src: `type Named = [ name: String ]; type Aged = [ age: Int32 ]; type Person = Named & Aged; person: Person = [ name = 'Alice', age = 30 ]; main { person.name >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Aged (data (propdef :age typeident ?))) (type :Person (& typeident typeident)) (def :person typeident (data (, (propdef :name ? 'Alice') (propdef :age ? 30)))) (main (>> (. :person :name) :out)))`,
			out: ['Alice'],
		});
		rule({
			src: `type Named = [ name: String ]; type Stamped = Named & [ id: Int32 ]; mk = (): Stamped { [ name = 'Ada', id = 7 ] }; nameOf = (n: Named): String { n.name }; main { nameOf(mk()) >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Stamped (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :name ? 'Ada') (propdef :id ? 7))))) (def :nameOf ? (fn @sequence (parameter :n typeident ?) typeident (. :n :name))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Point = [ x: Int32 ]; type Circle = [ r: Int32 ]; mp = (): Point { [ x = 1 ] }; mc = (): Circle { [ r = 9 ] }; shape = (n: Int32): Point | Circle { next n > 0 ? mp() : mc() }; main { shape(0 - 1) >> Point { 1 } | Circle { 2 } >> out }`,
			ast: `(root (type :Point (data (propdef :x typeident ?))) (type :Circle (data (propdef :r typeident ?))) (def :mp ? (fn @sequence typeident (data (propdef :x ? 1)))) (def :mc ? (fn @sequence typeident (data (propdef :r ? 9)))) (def :shape ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :mp ?) (call :mc ?))))) (main (>> (call :shape (- 0 1)) (| (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 2)) :out)))`,
			out: ['2'],
		});
		rule({
			src: `pick = (n: Int32): Int32 | String { next n > 0 ? 42 : 'hi' }; main { pick(1) >> Int32 { 0 - 1 } | String { 99 } >> out; pick(0) >> Int32 { 0 - 1 } | String { 99 } >> out; }`,
			ast: `(root (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 42 'hi')))) (main (>> (call :pick 1) (| (fn @sequence (parameter ? typeident ?) (- 0 1)) (fn @sequence (parameter ? typeident ?) 99)) :out) (>> (call :pick 0) (| (fn @sequence (parameter ? typeident ?) (- 0 1)) (fn @sequence (parameter ? typeident ?) 99)) :out)))`,
			out: ['-1', '99'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; f = (u: Int32 | DivByZero): Int32 { u >> Int32 { $ } | DivByZero { 0 - 1 } }; main { f(d(2)) >> out; f(d(0)) >> out; }`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (def :f ? (fn @sequence (parameter :u typeident ?) typeident (>> :u (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 1)))))) (main (>> (call :f (call :d 2)) :out) (>> (call :f (call :d 0)) :out)))`,
			out: ['5', '-1'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; id = (u: Int32 | DivByZero): Int32 | DivByZero { u }; main { id(d(2)) >> Int32 { $ } | DivByZero { 0 } >> out; id(d(0)) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (def :id ? (fn @sequence (parameter :u typeident ?) typeident :u)) (main (>> (call :id (call :d 2)) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out) (>> (call :id (call :d 0)) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `pick = (n: Int32): Int32 | String | Bool { next n > 5 ? 1 : (n > 0 ? 'mid' : true) }; main { pick(9) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; pick(3) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; pick(0) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; }`,
			ast: `(root (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 5) 1 (? (> :n 0) 'mid' :true))))) (main (>> (call :pick 9) (| (| (fn @sequence (parameter ? typeident ?) 100) (fn @sequence (parameter ? typeident ?) 200)) (fn @sequence (parameter ? typeident ?) 300)) :out) (>> (call :pick 3) (| (| (fn @sequence (parameter ? typeident ?) 100) (fn @sequence (parameter ? typeident ?) 200)) (fn @sequence (parameter ? typeident ?) 300)) :out) (>> (call :pick 0) (| (| (fn @sequence (parameter ? typeident ?) 100) (fn @sequence (parameter ? typeident ?) 200)) (fn @sequence (parameter ? typeident ?) 300)) :out)))`,
			out: ['100', '200', '300'],
		});
		rule({
			src: `mixed = (n: Int32): Float64 | String { next n > 0 ? 3.14 : 'hi' }; main { mixed(1) >> Float64 { $ } | String { 0.0 } >> out; mixed(0) >> Float64 { 1.5 } | String { 2.5 } >> out; }`,
			ast: `(root (def :mixed ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 3.14 'hi')))) (main (>> (call :mixed 1) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out) (>> (call :mixed 0) (| (fn @sequence (parameter ? typeident ?) 1.5) (fn @sequence (parameter ? typeident ?) 2.5)) :out)))`,
			out: ['3.14', '2.5'],
		});
		rule({
			src: `mixed = (n: Int32): Float64 | String { next n > 0 ? 3.14 : 'hello' }; main { mixed(1) >> out; mixed(0) >> out; }`,
			ast: `(root (def :mixed ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 3.14 'hello')))) (main (>> (call :mixed 1) :out) (>> (call :mixed 0) :out)))`,
			out: ['3.14', 'hello'],
		});
		rule({
			src: `log = (n: Int32) { out(n) }; main { 7 >> log }`,
			ast: `(root (def :log ? (fn @sequence (parameter :n typeident ?) (call :out :n))) (main (>> 7 :log)))`,
			out: ['7'],
		});
		compileError({
			p: 'Return types are inferred — a bare `: Void` annotation is rejected everywhere (fn returns, fn types, stage returns): it states nothing the body does not. `Void` is not writable; it exists only as the compiler\u2019s \u201cno value\u201d.',
			src: `log = (n: Int32): Void { out(n) }; main { 7 >> log }`,
			expected: 'return types are inferred',
		});
		compileError({
			src: `emit = (n: Int32): Int32 | Void { next n }; main { emit(7) >> out }`,
			expected: 'union identity',
		});
	});

	h('Int64', ({ rule, compileError }) => {
		rule({
			p: 'An integer literal is typed by its value: `Int32` when it fits, `Int64` otherwise (the analog of float-by-syntax).',
			src: `main { 5000000000 >> out }`,
			ast: `(root (main (>> 5000000000 :out)))`,
			out: ['5000000000'],
		});
		rule({
			p: 'A literal adopts any integer type whose range holds its value — declarations (incl. `var`), parameters, returns, and assignments. Non-literal values still convert explicitly (`Int64(x)`).',
			src: `n: Int64 = 5;
f = (a: Int64): Int64 { n > 0 ? a + a : 5000000000 };
main {
	f(7) >> out;
	b: var Uint8 = 100;
	b = 200;
	b >> out;
}`,
			ast: `(root (def :n typeident 5) (def :f ? (fn @sequence (parameter :a typeident ?) typeident (? (> :n 0) (+ :a :a) 5000000000))) (main (>> (call :f 7) :out) (def @variable :b typeident 100) (= :b @variable 200) (>> :b @variable :out)))`,
			out: ['14', '200'],
		});
		compileError({
			p: 'A literal outside the target range does not adopt.',
			src: `main { b: Uint8 = 300; b >> out }`,
			expected: 'not assignable to declared type "Uint8"',
		});
		compileError({
			p: 'Int literals never adopt float types — a float is written with a point or exponent.',
			src: `main { x: Float64 = 5; x >> out }`,
			expected: 'not assignable to declared type "Float64"',
		});
		rule({
			p: 'Integer literals are exact across the full 64-bit range (parsed as a BigInt past the safe-integer range); only values above 2^64-1 are rejected.',
			src: `main { 9007199254740993 >> out; 18446744073709551615 >> out }`,
			ast: `(root (main (>> 9007199254740993 :out) (>> 18446744073709551615 :out)))`,
			out: ['9007199254740993', '18446744073709551615'],
		});
		compileError({
			src: `main { 20000000000000000000 >> out }`,
			expected: 'Integer literal is too large',
		});
		rule({
			src: `f = (a: Int64, b: Int64): Int64 { a + b };
main {
	f(Int64(5), Int64(7)) >> out
}`,
			ast: `(root (def :f ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (+ :a :b))) (main (>> (call :f (, (call typeident 5) (call typeident 7))) :out)))`,
			out: ['12'],
		});
		rule({
			src: `main {
	Int64(1000000) * Int64(1000000) >> out
}`,
			ast: `(root (main (>> (* (call typeident 1000000) (call typeident 1000000)) :out)))`,
			out: ['1000000000000'],
		});
		rule({
			src: `f = (a: Int64, b: Int64): Int64 | DivByZero { a / b };
main {
	f(Int64(20), Int64(4)) >> Int64 { $ } | DivByZero { Int64(0) } >> out;
	f(Int64(20), Int64(0)) >> Int64 { $ } | DivByZero { Int64(0 - 1) } >> out;
}`,
			ast: `(root (def :f ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (/ :a :b))) (main (>> (call :f (, (call typeident 20) (call typeident 4))) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (call typeident 0))) :out) (>> (call :f (, (call typeident 20) (call typeident 0))) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (call typeident (- 0 1)))) :out)))`,
			out: ['5', '-1'],
		});
		rule({
			src: `main {
	Int64(10) + 3 >> out
}`,
			ast: `(root (main (>> (+ (call typeident 10) 3) :out)))`,
			out: ['13'],
		});
		rule({
			src: `main {
	Int64(5) < Int64(7) >> out
}`,
			ast: `(root (main (>> (< (call typeident 5) (call typeident 7)) :out)))`,
			out: ['true'],
		});
		rule({
			src: `main {
	Int64(5) + 2.5 >> out
}`,
			ast: `(root (main (>> (+ (call typeident 5) 2.5) :out)))`,
			out: ['7.5'],
		});
	});

	h('Unsigned integers', ({ rule }) => {
		rule({
			p: 'Unsigned types use unsigned arithmetic, comparison, and formatting — a value with the high bit set is not misread as negative. `String`/`out` and the usual arithmetic conversions preserve unsignedness.',
			src: `main { Uint32(4000000000) >> out }`,
			ast: `(root (main (>> (call typeident 4000000000) :out)))`,
			out: ['4000000000'],
		});
		rule({
			src: `main { Uint32(4294967295) >> out }`,
			ast: `(root (main (>> (call typeident 4294967295) :out)))`,
			out: ['4294967295'],
		});
		rule({
			src: `main { (Uint64(9000000000) * Uint64(2000000000)) >> out }`,
			ast: `(root (main (>> (* (call typeident 9000000000) (call typeident 2000000000)) :out)))`,
			out: ['18000000000000000000'],
		});
		rule({
			src: `main { (Uint32(4000000000) / Uint32(10)) >> out }`,
			ast: `(root (main (>> (/ (call typeident 4000000000) (call typeident 10)) :out)))`,
			out: ['400000000'],
		});
		rule({
			src: `main { (Uint32(4000000000) < Uint32(10) ? 'lt' : 'ge') >> out }`,
			ast: `(root (main (>> (? (< (call typeident 4000000000) (call typeident 10)) 'lt' 'ge') :out)))`,
			out: ['ge'],
		});
		rule({
			p: 'Dispatch prefers an exact type match over an int-widening one, so a `Uint32` argument binds the `Uint32` arm rather than a signed `Int32` arm listed before it.',
			src: `classify = (n: Int32): String { 'signed' } | (n: Uint32): String { 'unsigned' };
main { classify(Uint32(5)) >> out; classify(5) >> out }`,
			ast: `(root (def :classify ? (| (fn @sequence (parameter :n typeident ?) typeident 'signed') (fn @sequence (parameter :n typeident ?) typeident 'unsigned'))) (main (>> (call :classify (call typeident 5)) :out) (>> (call :classify 5) :out)))`,
			out: ['unsigned', 'signed'],
		});
	});

	h('Program exit', ({ rule }) => {
		rule({
			p: '`runtime.exit(code)` ends the program immediately; the host receives the code (the CLI exits with it). `main` itself is Void — completion is exit 0.',
			src: `main {
	'bye' >> out;
	runtime.exit(3);
	'unreachable' >> out;
}`,
			ast: `(root (main (>> 'bye' :out) (call (. :runtime :exit) 3) (>> 'unreachable' :out)))`,
			out: ['bye'],
			exit: 3,
		});
	});

	h('Heap', ({ rule }) => {
		rule({
			p: 'The heap grows on demand — allocation is not bounded by the initial 64KB memory page. Freed neighbors coalesce and oversized blocks split on reuse, so even a monotonically growing buffer plateaus near its final size instead of retaining every intermediate copy.',
			src: `fill = (n: Int32): String { n == 0 ? '' : '\${fill(n - 1)}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };
main { length(fill(1200)) >> out }`,
			ast: `(root (def :fill ? (fn @sequence (parameter :n typeident ?) typeident (? (== :n 0) '' (interp (call :fill (- :n 1)))))) (main (>> (call :length @intrinsic (call :fill 1200)) :out)))`,
			out: ['76800'],
			maxPages: 8,
		});
	});

	h('Heap — churn shapes', ({ rule }) => {
		rule({
			p: 'Collections of records churn flat: element literals are copied in and their source blocks freed, `each` scratch dies per call, and dropping the collection frees every element\u2019s heap members.',
			src: `type P = [ x: Int32, s: String ];
step = (n: Int32): Int32 { ps = [ [ x = n, s = 'a\${n}' ], [ x = n, s = 'b\${n}' ], [ x = n, s = 'c\${n}' ] ]; k: var = 0; ps >> each >> (p: P) { k = k + length(p.s); }; next k };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :P (data (, (propdef :x typeident ?) (propdef :s typeident ?)))) (def :step ? (fn (parameter :n typeident ?) typeident (def :ps ? (data (, (data (, (propdef :x ? :n) (propdef :s ? (interp :n)))) (data (, (propdef :x ? :n) (propdef :s ? (interp :n)))) (data (, (propdef :x ? :n) (propdef :s ? (interp :n))))))) (def @variable :k ? 0) (>> :ps :each (fn @sequence (parameter :p typeident ?) (= :k @variable (+ :k @variable (call :length @intrinsic (. :p :s)))))) (next :k @variable))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['1766685'],
			maxPages: 3,
		});
		rule({
			p: 'Churn runs flat across allocation shapes: sizes that never repeat still reuse (coalesced neighbors, split blocks, sub-word frees).',
			src: `step = (n: Int32): Int32 { m = 'x\${n}\${n * 7}\${n * 13}'; next length(m) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(400000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :n typeident ?) typeident (def :m ? (interp :n (* :n 7) (* :n 13))) (next (call :length @intrinsic :m)))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 400000 0)) :out)))`,
			out: ['8044701'],
			maxPages: 3,
		});
		rule({
			p: 'A fused loop piping fresh values into an un-annotated dispatch consumer runs flat — arm returns infer, so the source temp and each iteration\u2019s locals are freed.',
			src: `k: var = 0;
sink = (s: String) { k = k + length(s) } | (n: Int32) { k = k + n };
main { loop >> (i: Int32) { i >= 200000 ? break; 'v\${i}' >> sink; }; k >> out }`,
			ast: `(root (def @variable :k ? 0) (def :sink ? (| (fn @sequence (parameter :s typeident ?) (= :k @variable (+ :k @variable (call :length @intrinsic :s)))) (fn @sequence (parameter :n typeident ?) (= :k @variable (+ :k @variable :n))))) (main (>> loop (fn (parameter :i typeident ?) (? (>= :i 200000) break) (>> (interp :i) :sink))) (>> :k @variable :out)))`,
			out: ['1288890'],
			maxPages: 3,
		});
	});

	h('Heap — churn shapes (loops)', ({ rule }) => {
		rule({
			p: 'Streaming a literal per loop iteration runs flat — `each` scratch and stage locals die with the iteration.',
			src: `main { total: var = 0; loop >> (i: Int32) { i >= 100000 ? break; [ 1, 2, 3 ] >> each >> (n: Int32) { total = total + n; }; }; total >> out }`,
			ast: `(root (main (def @variable :total ? 0) (>> loop (fn (parameter :i typeident ?) (? (>= :i 100000) break) (>> (data (, 1 2 3)) :each (fn @sequence (parameter :n typeident ?) (= :total @variable (+ :total @variable :n)))))) (>> :total @variable :out)))`,
			out: ['600000'],
			maxPages: 3,
		});
		rule({
			src: `k: var = 0;
sink = (s: String) { k = k + length(s) } | (n: Int32) { k = k + n };
main { loop >> (i: Int32) { i >= 200000 ? break; sink('v\${i}'); }; k >> out }`,
			ast: `(root (def @variable :k ? 0) (def :sink ? (| (fn @sequence (parameter :s typeident ?) (= :k @variable (+ :k @variable (call :length @intrinsic :s)))) (fn @sequence (parameter :n typeident ?) (= :k @variable (+ :k @variable :n))))) (main (>> loop (fn (parameter :i typeident ?) (? (>= :i 200000) break) (call :sink (interp :i)))) (>> :k @variable :out)))`,
			out: ['1288890'],
			maxPages: 3,
		});
		rule({
			src: `k: var = 0;
swallow = (s: String) { k = k + length(s) };
main { loop >> (i: Int32) { i >= 200000 ? break; 'v\${i}' >> swallow; }; k >> out }`,
			ast: `(root (def @variable :k ? 0) (def :swallow ? (fn @sequence (parameter :s typeident ?) (= :k @variable (+ :k @variable (call :length @intrinsic :s))))) (main (>> loop (fn (parameter :i typeident ?) (? (>= :i 200000) break) (>> (interp :i) :swallow))) (>> :k @variable :out)))`,
			out: ['1288890'],
			maxPages: 3,
		});
	});

	h('Tail calls', ({ rule }) => {
		rule({
			src: `sum = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : sum(n - 1, acc + n) };
main {
	sum(100, 0) >> out
}`,
			ast: `(root (def :sum ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :sum (, (- :n 1) (+ :acc :n)))))) (main (>> (call :sum (, 100 0)) :out)))`,
			out: ['5050'],
		});
		rule({
			src: `countdown = (n: Int32): Int32 { n == 0 ? 0 : countdown(n - 1) };
main {
	countdown(1000000) >> out
}`,
			ast: `(root (def :countdown ? (fn @sequence (parameter :n typeident ?) typeident (? (== :n 0) 0 (call :countdown (- :n 1))))) (main (>> (call :countdown 1000000) :out)))`,
			out: ['0'],
		});
		rule({
			src: `f = (n: Int32, d: Int32): Int32 | DivByZero { n == 0 ? 10 / d : f(n - 1, d) };
main {
	f(1000000, 2) >> Int32 { $ } | DivByZero { 0 - 1 } >> out;
	f(1000000, 0) >> Int32 { $ } | DivByZero { 0 - 1 } >> out;
}`,
			ast: `(root (def :f ? (fn @sequence (parameter :n typeident ?) (parameter :d typeident ?) typeident (? (== :n 0) (/ 10 :d) (call :f (, (- :n 1) :d))))) (main (>> (call :f (, 1000000 2)) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 1))) :out) (>> (call :f (, 1000000 0)) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 1))) :out)))`,
			out: ['5', '-1'],
		});
	});

	h('Forward references & mutual recursion', ({
		rule,
		compileError,
		testBlock,
	}) => {
		rule({
			p: 'Module-scope definitions are order-independent from a function body, `main`, or `#test`. Mutual tail recursion compiles to `return_call`, so cycles run at any depth.',
			src: `isEven = (n: Int32): Bool { n == 0 ? true : isOdd(n - 1) };
isOdd = (n: Int32): Bool { n == 0 ? false : isEven(n - 1) };
main {
	isEven(10) >> out;
	isEven(1000001) >> out;
}`,
			ast: `(root (def :isEven ? (fn @sequence (parameter :n typeident ?) typeident (? (== :n 0) :true (call :isOdd (- :n 1))))) (def :isOdd ? (fn @sequence (parameter :n typeident ?) typeident (? (== :n 0) :false (call :isEven (- :n 1))))) (main (>> (call :isEven 10) :out) (>> (call :isEven 1000001) :out)))`,
			out: ['true', 'false'],
		});
		rule({
			p: '`main` may precede the definitions it calls.',
			src: `main { half(84) >> out }
half = (n: Int32): Int32 { n / 2 };`,
			ast: `(root (main (>> (call :half 84) :out)) (def :half ? (fn @sequence (parameter :n typeident ?) typeident (/ :n 2))))`,
			out: ['42'],
		});
		rule({
			p: 'Forward references resolve through `|`-dispatch definitions.',
			src: `pick = (n: Int32): Int32 { later(n) };
later = (n: Int32): Int32 { n + 1 } | (b: Bool): Int32 { 0 };
main { pick(4) >> out }`,
			ast: `(root (def :pick ? (fn @sequence (parameter :n typeident ?) typeident (call :later :n))) (def :later ? (| (fn @sequence (parameter :n typeident ?) typeident (+ :n 1)) (fn @sequence (parameter :b typeident ?) typeident 0))) (main (>> (call :pick 4) :out)))`,
			out: ['5'],
		});
		compileError({
			p: 'Top-level initializers evaluate in source order and may only reference earlier definitions.',
			src: `y = x + 1; x = 5; main { y >> out }`,
			expected: 'Identifier not defined',
		});
		compileError({
			p: 'A local cannot be used before its declaration.',
			src: `main { a = b + 1; b = 2; a >> out }`,
			expected: 'Identifier not defined',
		});
		compileError({
			src: `main { missing(1) >> out }`,
			expected: 'Identifier not defined',
		});
		testBlock({
			p: '`#test` may call the definition it precedes.',
			src: `#test { equal(dbl(2), 4); equal(dbl(3), 7) }
export dbl = (n: Int32): Int32 { n * 2 };`,
			out: ['6 != 7'],
		});
	});

	h('Data block layout', ({ rule }) => {
		rule({
			src: `type Point = [ x: Int32, y: Float64 ];
mk = (): Point { [ x = 7, y = 3.5 ] };
main {
	p = mk();
	p.x >> out;
	p.y >> out;
}`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :x ? 7) (propdef :y ? 3.5))))) (main (def :p ? (call :mk ?)) (>> (. :p :x) :out) (>> (. :p :y) :out)))`,
			out: ['7', '3.5'],
		});
		rule({
			src: `main {
	p = [ 1, 3.14 ];
	p.0 >> out;
	p.1 >> out;
}`,
			ast: `(root (main (def :p ? (data (, 1 3.14))) (>> (. :p 0) :out) (>> (. :p 1) :out)))`,
			out: ['1', '3.14'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n };
main {
	pair = [ d(2), d(0) ];
	pair.0 >> Int32 { $ } | DivByZero { 0 - 9 } >> out;
	pair.1 >> Int32 { $ } | DivByZero { 0 - 9 } >> out;
}`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (main (def :pair ? (data (, (call :d 2) (call :d 0)))) (>> (. :pair 0) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 9))) :out) (>> (. :pair 1) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 9))) :out)))`,
			out: ['5', '-9'],
		});
		rule({
			src: `type Named = [ name: String ];
type Wide = Named & [ score: Float64 ];
mk = (): Wide { [ name = 'Ada', score = 9.5 ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Wide (& typeident (data (propdef :score typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :name ? 'Ada') (propdef :score ? 9.5))))) (def :nameOf ? (fn @sequence (parameter :n typeident ?) typeident (. :n :name))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Named = [ name: String ];
type Tag = [ id: Int32 ];
type Good = Named & Tag;
mk = (): Good { [ name = 'Ada', id = 1 ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Tag (data (propdef :id typeident ?))) (type :Good (& typeident typeident)) (def :mk ? (fn @sequence typeident (data (, (propdef :name ? 'Ada') (propdef :id ? 1))))) (def :nameOf ? (fn @sequence (parameter :n typeident ?) typeident (. :n :name))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Named = [ name: String ];
type Tag = [ id: Int32 ];
type Bad = Tag & Named;
mk = (): Bad { [ id = 1, name = 'Ada' ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Tag (data (propdef :id typeident ?))) (type :Bad (& typeident typeident)) (def :mk ? (fn @sequence typeident (data (, (propdef :id ? 1) (propdef :name ? 'Ada'))))) (def :nameOf ? (fn @sequence (parameter :n typeident ?) typeident (. :n :name))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `main {
	[ 1, 3.14 ] >> (a: Int32, b: Float64) { b } >> out
}`,
			ast: `(root (main (>> (data (, 1 3.14)) (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) :b) :out)))`,
			out: ['3.14'],
		});
		rule({
			src: `type T = [ flag: Bool, val: Float64, n: Int32 ];
mk = (): T { [ flag = true, val = 2.5, n = 9 ] };
main {
	p = mk();
	p.flag >> out;
	p.val >> out;
	p.n >> out;
}`,
			ast: `(root (type :T (data (, (propdef :flag typeident ?) (propdef :val typeident ?) (propdef :n typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :flag ? :true) (propdef :val ? 2.5) (propdef :n ? 9))))) (main (def :p ? (call :mk ?)) (>> (. :p :flag) :out) (>> (. :p :val) :out) (>> (. :p :n) :out)))`,
			out: ['true', '2.5', '9'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n };
main {
	[ d(2), d(0) ] >> (a: Int32 | DivByZero, b: Int32 | DivByZero) { a } >> Int32 { $ } | DivByZero { 0 - 9 } >> out
}`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (main (>> (data (, (call :d 2) (call :d 0))) (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) :a) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) (- 0 9))) :out)))`,
			out: ['5'],
		});
		rule({
			src: `score: Int32 = 5;
main {
	[ score, score ] >> (a: Int32, b: Int32) { a + b } >> out
}`,
			ast: `(root (def :score typeident 5) (main (>> (data (, :score :score)) (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (+ :a :b)) :out)))`,
			out: ['10'],
		});
		rule({
			src: `type Point = [ x: Int32, y: Int32 ];
type Line = [ from: Point, to: Point ];
mk = (): Line { [ from = [ x = 0, y = 0 ], to = [ x = 3, y = 4 ] ] };
main {
	p = mk();
	p.from.y >> out;
	p.to.x >> out;
}`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (type :Line (data (, (propdef :from typeident ?) (propdef :to typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :from ? (data (, (propdef :x ? 0) (propdef :y ? 0)))) (propdef :to ? (data (, (propdef :x ? 3) (propdef :y ? 4)))))))) (main (def :p ? (call :mk ?)) (>> (. (. :p :from) :y) :out) (>> (. (. :p :to) :x) :out)))`,
			out: ['0', '3'],
		});
		rule({
			src: `main {
	length([ [ 1, 2 ], [ 3, 4 ] ]) >> out
}`,
			ast: `(root (main (>> (call :length @intrinsic (data (, (data (, 1 2)) (data (, 3 4))))) :out)))`,
			out: ['2'],
		});
		rule({
			src: `main {
	b = [ 1, 2 ];
	c = [ 3, 4 ];
	[ b, c ] >> out;
}`,
			ast: `(root (main (def :b ? (data (, 1 2))) (def :c ? (data (, 3 4))) (>> (data (, :b :c)) :out)))`,
			out: ['1', '2', '3', '4'],
		});
	});

	h('Errors', ({ rule, compileError }) => {
		rule({
			p: 'Every error carries a lazy origin trace: `Error = Trace`, one hidden word filled at construction with a static frame pointer — nothing is walked or copied until read. `String(e)`/`out` render it.',
			src: `type NotFound = Error & [ resource: String ];
nf = (r: String): NotFound { [ resource = r ] };
main { nf('/etc') >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence (parameter :r typeident ?) typeident (data (propdef :resource ? :r)))) (main (>> (call :nf '/etc') :out)))`,
			out: ['NotFound at nf:2'],
		});
		rule({
			p: 'A field-less error’s structure is `[]` — Void — so its default constructor is `Boom()`: the compiler fills the trace, the slot that gives the value existence. An error with fields constructs from its labeled block (`NotFound([ resource = r ])`) or by declared-return coercion.',
			src: `type Boom = Error;
guard = (n: Int32): Int32 | Boom { next n > 0 ? n : Boom() };
main { guard(0) >> Int32 { 'ok' } | Boom { String($) } >> out }`,
			ast: `(root (type :Boom typeident) (def :guard ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call typeident ?))))) (main (>> (call :guard 0) (| (fn @sequence (parameter ? typeident ?) 'ok') (fn @sequence (parameter ? typeident ?) (call typeident $))) :out)))`,
			out: ['Boom at guard:2'],
		});
		rule({
			p: 'Debug builds maintain a shadow call stack; construction snapshots it, and the trace renders the physical chain innermost-first. Release builds carry only the origin (same handle, `frames(e)` = 1).',
			debug: true,
			src: `type NotFound = Error & [ resource: String ];
nf = (r: String): NotFound { [ resource = r ] };
inner = (r: String): NotFound { b = nf(r); next b };
outer = (r: String): NotFound { b = inner(r); next b };
main { String(outer('/x')) >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence (parameter :r typeident ?) typeident (data (propdef :resource ? :r)))) (def :inner ? (fn (parameter :r typeident ?) typeident (def :b ? (call :nf :r)) (next :b))) (def :outer ? (fn (parameter :r typeident ?) typeident (def :b ? (call :inner :r)) (next :b))) (main (>> (call typeident (call :outer '/x')) :out)))`,
			out: ['NotFound at nf:2 <- nf:2 <- inner:3 <- outer:4'],
		});
		rule({
			p: 'A tail call replaces its shadow frame exactly as it replaces the physical one, so TCO chains collapse instead of growing — deep recursion stays flat even in debug builds.',
			debug: true,
			src: `type Boom = Error & [ at: Int32 ];
mk = (n: Int32): Boom { [ at = n ] };
spin = (n: Int32): Int32 | Boom { next n == 0 ? mk(n) : spin(n - 1) };
main { spin(200000) >> Int32 { 'ok' } | Error { String($) } >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :at typeident ?)))) (def :mk ? (fn @sequence (parameter :n typeident ?) typeident (data (propdef :at ? :n)))) (def :spin ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) (call :mk :n) (call :spin (- :n 1)))))) (main (>> (call :spin 200000) (| (fn @sequence (parameter ? typeident ?) 'ok') (fn @sequence (parameter ? typeident ?) (call typeident $))) :out)))`,
			out: ['Boom at mk:2 <- mk:2 <- spin:3'],
		});
		rule({
			p: '`origin(e)` reads the trace as a `Frame [name, fn, line]`; payload fields are untouched by the hidden slot, and the origin survives upcast to `Error`.',
			src: `type NotFound = Error & [ resource: String ];
nf = (r: String): NotFound { [ resource = r ] };
check = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf('/y') };
main {
	e = nf('/x');
	'\${origin(e).fn}:\${origin(e).line} \${e.resource}' >> out;
	check(0) >> Int32 { 'ok' } | Error { String($) } >> out;
}`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence (parameter :r typeident ?) typeident (data (propdef :resource ? :r)))) (def :check ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf '/y'))))) (main (def :e ? (call :nf '/x')) (>> (interp (. (call :origin @intrinsic :e) :fn) (. (call :origin @intrinsic :e) :line) (. :e :resource)) :out) (>> (call :check 0) (| (fn @sequence (parameter ? typeident ?) 'ok') (fn @sequence (parameter ? typeident ?) (call typeident $))) :out)))`,
			out: ['nf:2 /x', 'NotFound at nf:2'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; notFound = (r: String): NotFound { [ resource = r ] }; main { notFound('/x') >> Error { 1 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :notFound ? (fn @sequence (parameter :r typeident ?) typeident (data (propdef :resource ? :r)))) (main (>> (call :notFound '/x') (fn @sequence (parameter ? typeident ?) 1) :out)))`,
			out: ['1'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; lookup = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf() }; main { lookup(5) >> Int32 { $ } | NotFound { 0 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 5) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out)))`,
			out: ['5'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; fb = (): Forbidden { [ resource = 'y' ] }; pick = (n: Int32): Int32 | NotFound | Forbidden { next n > 0 ? nf() : fb() }; main { pick(0 - 1) >> Int32 { 1 } | NotFound { 2 } | Forbidden { 3 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (type :Forbidden (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :fb ? (fn @sequence typeident (data (propdef :resource ? 'y')))) (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :nf ?) (call :fb ?))))) (main (>> (call :pick (- 0 1)) (| (| (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 2)) (fn @sequence (parameter ? typeident ?) 3)) :out)))`,
			out: ['3'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; lookup = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf() }; main { lookup(0) >> Int32 { 1 } | Error { 9 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 0) (| (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 9)) :out)))`,
			out: ['9'],
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; fb = (): Forbidden { [ resource = 'y' ] }; n: NotFound = fb();`,
			expected: 'not assignable',
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; lookup = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf() }; main { lookup(5) >> Int32 { $ } >> out }`,
			expected: 'does not consume',
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; fb = (): Forbidden { [ resource = 'y' ] }; pick = (n: Int32): Int32 | NotFound | Forbidden { next n > 0 ? nf() : fb() }; main { pick(1) >> Int32 { 1 } | NotFound { 2 } >> out }`,
			expected: 'does not consume "Forbidden"',
		});
		rule({
			p: '`runtime.stack(e)` materializes the whole trace as a collection of `Frame`s \u2014 `[count][frame\u2026]`, elements inline \u2014 so it streams and measures like any record collection. Outside debug builds it holds the single origin frame.',
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): Boom { [ id = n ] };
main { b = mk(5); length(runtime.stack(b)) >> out; runtime.stack(b) >> each >> (f: Frame) { '\${f.fn}:\${f.line}' >> out } }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence (parameter :n typeident ?) typeident (data (propdef :id ? :n)))) (main (def :b ? (call :mk 5)) (>> (call :length @intrinsic (call (. :runtime :stack) :b)) :out) (>> (call (. :runtime :stack) :b) :each (fn @sequence (parameter :f typeident ?) (>> (interp (. :f :fn) (. :f :line)) :out)))))`,
			out: ['1', 'mk:2'],
		});
		rule({
			p: 'In debug builds the collection carries the captured chain \u2014 the same frames `frameAt` reads, origin first \u2014 and reading it churns flat: the collection is fresh, owned by its consumer, block-freed (its words are static frames).',
			debug: true,
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): Boom { [ id = n ] };
step = (n: Int32): Int32 { b = mk(n); k: var = 0; runtime.stack(b) >> each >> (f: Frame) { k = k + f.line; }; next k + length(runtime.stack(b)) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence (parameter :n typeident ?) typeident (data (propdef :id ? :n)))) (def :step ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mk :n)) (def @variable :k ? 0) (>> (call (. :runtime :stack) :b) :each (fn @sequence (parameter :f typeident ?) (= :k @variable (+ :k @variable (. :f :line))))) (next (+ :k @variable (call :length @intrinsic (call (. :runtime :stack) :b)))))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['1499995'],
			maxPages: 3,
		});
		rule({
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): Boom { [ id = n ] };
step = (n: Int32): Int32 { b = mk(n); k: var = 0; runtime.stack(b) >> each >> (f: Frame) { k = k + f.line; }; next k + length(runtime.stack(b)) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence (parameter :n typeident ?) typeident (data (propdef :id ? :n)))) (def :step ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mk :n)) (def @variable :k ? 0) (>> (call (. :runtime :stack) :b) :each (fn @sequence (parameter :f typeident ?) (= :k @variable (+ :k @variable (. :f :line))))) (next (+ :k @variable (call :length @intrinsic (call (. :runtime :stack) :b)))))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['300000'],
			maxPages: 3,
		});
		rule({
			debug: true,
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): Boom { [ id = n ] };
main { b = mk(9); s = runtime.stack(b); length(s) >> out; s >> each >> (f: Frame) { f.fn >> out } }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence (parameter :n typeident ?) typeident (data (propdef :id ? :n)))) (main (def :b ? (call :mk 9)) (def :s ? (call (. :runtime :stack) :b)) (>> (call :length @intrinsic :s) :out) (>> :s :each (fn @sequence (parameter :f typeident ?) (>> (. :f :fn) :out)))))`,
			out: ['2', 'mk', 'mk'],
		});
	});

	h('Nominal vs structural', ({ rule, compileError }) => {
		rule({
			src: `type A = [ v: Int32 ]; f = (x: A): Int32 { next x.v }; main { f([ v = 5 ]) >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (def :f ? (fn (parameter :x typeident ?) typeident (next (. :x :v)))) (main (>> (call :f (data (propdef :v ? 5))) :out)))`,
			out: ['5'],
		});
		rule({
			src: `type A = [ v: Int32 ]; n: A = [ v = 7 ]; main { n.v >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (def :n typeident (data (propdef :v ? 7))) (main (>> (. :n :v) :out)))`,
			out: ['7'],
		});
		rule({
			src: `type A = [ v: Int32 ]; type B = [ v: Int32 ]; af = (): A { [ v = 1 ] }; bf = (): B { [ v = 2 ] }; pick = (n: Int32): A | B { next n > 0 ? af() : bf() }; main { pick(0 - 1) >> A { 10 } | B { 20 } >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (type :B (data (propdef :v typeident ?))) (def :af ? (fn @sequence typeident (data (propdef :v ? 1)))) (def :bf ? (fn @sequence typeident (data (propdef :v ? 2)))) (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :af ?) (call :bf ?))))) (main (>> (call :pick (- 0 1)) (| (fn @sequence (parameter ? typeident ?) 10) (fn @sequence (parameter ? typeident ?) 20)) :out)))`,
			out: ['20'],
		});
		compileError({
			src: `type A = [ v: Int32 ]; type B = [ v: Int32 ]; bf = (): B { [ v = 1 ] }; n: A = bf();`,
			expected: 'not assignable',
		});
	});

	h('Grouping', ({ rule }) => {
		rule({
			src: `main { ((2 + 3) * 4) >> out }`,
			ast: `(root (main (>> (* (+ 2 3) 4) :out)))`,
			out: ['20'],
		});
		rule({
			src: `main { ((1 + 2) * (3 + 4)) >> out }`,
			ast: `(root (main (>> (* (+ 1 2) (+ 3 4)) :out)))`,
			out: ['21'],
		});
	});

	h('String-literal types', ({ rule, compileError }) => {
		rule({
			src: `type Mode = 'on'; m: Mode = 'on'; main { m >> out }`,
			ast: `(root (type :Mode typeident) (def :m typeident 'on') (main (>> :m :out)))`,
			out: ['on'],
		});
		rule({
			src: `type Toggle = 'on' | 'off'; t: Toggle = 'off'; main { t >> out }`,
			ast: `(root (type :Toggle typeident) (def :t typeident 'off') (main (>> :t :out)))`,
			out: ['off'],
		});
		compileError({
			src: `type Mode = 'on'; m: Mode = 'off';`,
			expected: 'not assignable',
		});
	});

	h('External declarations', ({ rule }) => {
		rule({
			src: `external host_log: (n: Int32); main { host_log(5) }`,
			ast: `(root (external @external :host_log (fn (parameter :n typeident ?))) (main (call :host_log @external 5)))`,
		});
	});

	h('Operator & condition typing', ({ rule, compileError }) => {
		compileError({
			src: `f = (n: Int32): Int32 { next n ? 1 : 2 }; main { f(5) >> out }`,
			expected: 'condition must be',
		});
		compileError({
			src: `main { (1 == 1 == 1) >> out }`,
			expected: 'cannot compare',
		});
		rule({
			src: `main { (5 & 3) >> out }`,
			ast: `(root (main (>> (& 5 3) :out)))`,
			out: ['1'],
		});
		compileError({
			src: `main { (2.5 & 1) >> out }`,
			expected: 'requires integer',
		});
		rule({
			src: `main { (5 | 2) >> out }`,
			ast: `(root (main (>> (| 5 2) :out)))`,
			out: ['7'],
		});
		compileError({
			src: `main { (2.5 | 1) >> out }`,
			expected: 'requires integer',
		});
		rule({
			src: `main { ('ab' == 'ab') >> out }`,
			ast: `(root (main (>> (== 'ab' 'ab') :out)))`,
			out: ['true'],
		});
		compileError({
			src: `main { ('a' + 'b') >> out }`,
			expected: 'cannot be applied',
		});
		compileError({
			src: `main { [] >> out }`,
			expected: 'not a value',
		});
		compileError({
			src: `main { 1 >> out } main { 2 >> out }`,
			expected: 'multiple `main`',
		});
		compileError({
			p: 'A program requires a `main` block; test-mode compiles are exempt (`#test` blocks are the entry).',
			src: `export f = (n: Int32): Int32 { n };`,
			expected: 'a program requires a `main` block',
		});
		compileError({
			p: 'All bitwise operators require integer operands — `|` included, even though it doubles as the dispatch operator.',
			src: `main { 1 == 2 | 4 >> out }`,
			expected: 'requires integer operands',
		});
		compileError({
			p: 'A bare value in `main` is not consumed — the same rule as everywhere else.',
			src: `main { 3 }`,
			expected: 'value is not consumed',
		});
		compileError({
			p: 'A multi-statement stage body must end in `next`, an assignment, or a Void expression — a dangling value has nowhere to go.',
			src: `main { a = 1; 5 >> Int32 { a = 2; a + $ } >> out }`,
			expected: 'value is not consumed',
		});
		compileError({
			src: `main { 0X1F >> out }`,
			expected: 'Expected digit',
		});
	});

	h('Argument binding (positional / named / spread)', ({ rule, compileError }) => {
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(1, 2) >> out }`,
			ast: `(root (def :sub ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (- :a :b))) (main (>> (call :sub (, 1 2)) :out)))`,
			out: ['-1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(b = 1, a = 2) >> out }`,
			ast: `(root (def :sub ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (- :a :b))) (main (>> (call :sub (, (propdef :b ? 1) (propdef :a ? 2))) :out)))`,
			out: ['1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { [1, 2] >> sub >> out }`,
			ast: `(root (def :sub ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (- :a :b))) (main (>> (data (, 1 2)) :sub :out)))`,
			out: ['-1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { [ b = 2, a = 1 ] >> sub >> out }`,
			ast: `(root (def :sub ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (- :a :b))) (main (>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :sub :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { next a - b }; main { subG(1, 2) >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :subG (, 1 2)) :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { next a - b }; main { subG(b = 1, a = 2) >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :subG (, (propdef :b ? 1) (propdef :a ? 2))) :out)))`,
			out: ['1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { next a - b }; main { [1, 2] >> subG >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, 1 2)) :subG :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { next a - b }; main { [ b = 2, a = 1 ] >> subG >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :subG :out)))`,
			out: ['-1'],
		});
		compileError({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(1, b = 2) >> out }`,
			expected: 'cannot mix positional and named',
		});
		compileError({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(a = 1) >> out }`,
			expected: 'missing argument',
		});
	});

	h('Arithmetic safety', ({ expr, rule, compileError }) => {
		expr({
			pre: `half = (n: Int32): Int32 { n / 2 }`,
			src: `half(10)`,
			ast: `(call :half 10)`,
			out: ['5'],
		});
		compileError({
			src: `main { 10 / 0 >> out }`,
			expected: 'zero',
		});
		compileError({
			src: `bad = (n: Int32): Int32 { 10 / n }; main { bad(2) >> out }`,
			expected: 'not assignable',
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; main { d(2) >> Int32 { $ } | DivByZero { 0 } >> out; d(0) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (main (>> (call :d 2) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out) (>> (call :d 0) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; main { x = d(2); y = d(0); x >> Int32 { $ } | DivByZero { 0 } >> out; y >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn @sequence (parameter :n typeident ?) typeident (/ 10 :n))) (main (def :x ? (call :d 2)) (def :y ? (call :d 0)) (>> :x (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out) (>> :y (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `recip = (n: Int32): Int32 { 10 / n >> Int32 { $ } | DivByZero { 0 } }; main { recip(5) >> out; recip(0) >> out; }`,
			ast: `(root (def :recip ? (fn @sequence (parameter :n typeident ?) typeident (>> (/ 10 :n) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0))))) (main (>> (call :recip 5) :out) (>> (call :recip 0) :out)))`,
			out: ['2', '0'],
		});
		expr({
			pre: `fdiv = (a: Float64, b: Float64): Float64 { a / b }`,
			src: `fdiv(7.5, 2.5)`,
			ast: `(call :fdiv (, 7.5 2.5))`,
			out: ['3'],
		});
		compileError({
			src: `f = (n: Int32): Int32 { n + 1; next 2; }; main { f(3) >> out }`,
			expected: 'not consumed',
		});
		expr({
			pre: `mod10 = (n: Int32): Int32 { n % 10 }`,
			src: `mod10(43)`,
			ast: `(call :mod10 43)`,
			out: ['3'],
		});
		compileError({
			src: `main { 10 % 0 >> out }`,
			expected: 'zero',
		});
		compileError({
			src: `main { 7.5 % 2.5 >> out }`,
			expected: 'integer operands',
		});
		rule({
			src: `m = (n: Int32): Int32 | DivByZero { 10 % n }; main { m(3) >> Int32 { $ } | DivByZero { 99 } >> out; m(0) >> Int32 { $ } | DivByZero { 99 } >> out; }`,
			ast: `(root (def :m ? (fn @sequence (parameter :n typeident ?) typeident (% 10 :n))) (main (>> (call :m 3) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 99)) :out) (>> (call :m 0) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 99)) :out)))`,
			out: ['1', '99'],
		});
		rule({
			src: `nm = (a: Int32, b: Int32): Int32 | DivByZero { a % b }; main { nm(0 - 7, 3) >> Int32 { $ } | DivByZero { 0 } >> out; nm(7, 0 - 3) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :nm ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (% :a :b))) (main (>> (call :nm (, (- 0 7) 3)) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out) (>> (call :nm (, 7 (- 0 3))) (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)) :out)))`,
			out: ['-1', '1'],
		});
	});

	h('Function types', ({ p }) => {
		p(
			`Function types are written as function-value signatures *without a body*. The presence of \`{ ... }\` is what distinguishes a function value from a function type. Parameter names in type position are optional — they're documentary; structural equivalence ignores them. Bare \`Fn\` remains the shorthand for "any function" when the signature is not relevant.`,
			({ expr, ast, compileError }) => {
				ast({
					src: `type BinOp = (Int32, Int32): Int32`,
					ast: `(type :BinOp (fn (parameter ? typeident ?) (parameter ? typeident ?) typeident))`,
				});
				ast({
					src: `type T1 = (Int32): Int32; type T2 = (a: Int32): Int32;`,
					ast: `(type :T1 (fn (parameter ? typeident ?) typeident)) (type :T2 (fn (parameter :a typeident ?) typeident))`,
				});
				expr({
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }; helper = (cb: (Int32, Int32): Int32): Int32 { cb(5, 10) }`,
					src: `helper(add)`,
					ast: `(call :helper :add)`,
					out: ['15'],
				});
				compileError({
					pre: `makeAdder = (x: Int32): ((Int32): Int32) { (y: Int32): Int32 { x + y } }`,
					src: `main { makeAdder(7)(10) >> out }`,
					expected: 'capture',
				});
				expr({
					pre: `constFn = (): ((Int32): Int32) { (y: Int32): Int32 { y + 1 } }`,
					src: `constFn()(10)`,
					ast: `(call (call :constFn ?) 10)`,
					out: ['11'],
				});
				ast({
					src: `type Handler = [name: String, fn: (Int32): Int32]`,
					ast: `(type :Handler (data (, (propdef :name typeident ?) (propdef :fn (fn (parameter ? typeident ?) typeident) ?))))`,
				});
				compileError({
					pre: `type Adder = (Int32): Int32`,
					src: `main { Adder(5) >> out }`,
					expected: 'not callable',
				});
				compileError({
					src: `add = (a: Int32, b: Int32): Int32`,
					expected: 'Expected "{"',
				});
			},
		);
	});

	h('Generics', ({ h }) => {
		h('Generic type aliases', ({ ast, rule }) => {
			ast({
				src: `type Result<T> = T | Error`,
				ast: `(type :Result (, (parameter :T ? ?)) typeident)`,
			});
			rule({
				src: `type Pair<T, U> = [T, U]; p: Pair<Int32, String> = [42, 'hi']; main { p.0 >> out }`,
				ast: `(root (type :Pair (, (parameter :T ? ?) (parameter :U ? ?)) (data (, (propdef ? typeident ?) (propdef ? typeident ?)))) (def :p typeident (data (, 42 'hi'))) (main (>> (. :p 0) :out)))`,
				out: ['42'],
			});
		});

		h('Generic value functions', ({ rule, expr }) => {
			rule({
				src: `identity = <T>(x: T): T { x }; main { identity(42) >> out; identity(7) >> out; }`,
				ast: `(root (def :identity ? (fn @sequence (, (parameter :T ? ?)) (parameter :x typeident ?) typeident :x)) (main (>> (call :identity 42) :out) (>> (call :identity 7) :out)))`,
				out: ['42', '7'],
			});
			rule({
				src: `pick = <T, U>(a: T, b: U): T { a }; main { pick(5, 9) >> out }`,
				ast: `(root (def :pick ? (fn @sequence (, (parameter :T ? ?) (parameter :U ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident :a)) (main (>> (call :pick (, 5 9)) :out)))`,
				out: ['5'],
			});
			rule({
				src: `first = <T>(a: T, b: T): T { a }; main { first(10, 20) >> out }`,
				ast: `(root (def :first ? (fn @sequence (, (parameter :T ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident :a)) (main (>> (call :first (, 10 20)) :out)))`,
				out: ['10'],
			});
			expr({
				pre: `reduce = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : reduce(r, f(acc, h), f) } }; add = (a: Int32, b: Int32): Int32 { a + b }`,
				src: `reduce([1, 2, 3], 0, add)`,
				ast: `(call :reduce (, (data (, 1 2 3)) 0 :add))`,
				out: ['6'],
			});
			// A higher-order arg may also be an inline function literal, not just a
			// named fn: it is lifted to a real function and bound to the param.
			expr({
				pre: `reduce = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : reduce(r, f(acc, h), f) } }`,
				src: `reduce([1, 2, 3], 0, (a: Int32, b: Int32): Int32 { a + b })`,
				ast: `(call :reduce (, (data (, 1 2 3)) 0 (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (+ :a :b))))`,
				out: ['6'],
			});
			// A recursive generic monomorphized over a non-Int32 element (Float64):
			// each spec's param must take its concrete arg's wasm type (f64), not
			// the Int32 default left by the in-place type-param placeholder.
			expr({
				pre: `reduce = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : reduce(r, f(acc, h), f) } }; addF = (a: Float64, b: Float64): Float64 { a + b }`,
				src: `reduce([1.5, 2.5, 3.5], 0.5, addF)`,
				ast: `(call :reduce (, (data (, 1.5 2.5 3.5)) 0.5 :addF))`,
				out: ['8'],
			});
			rule({
				p: 'A generic may recurse on a value with a fixed type — it monomorphizes once and self-calls, terminating at runtime like any recursion (termination is not proven, mirroring non-generic recursion). Type-reducing recursion (`reduce` above) still unrolls per level.',
				src: `rep = <T>(x: T, n: Int32): String { n <= 0 ? '' : '\${x}\${rep(x, n - 1)}' };
main { rep('ab', 3) >> out }`,
				ast: `(root (def :rep ? (fn @sequence (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (? (<= :n 0) '' (interp :x (call :rep (, :x (- :n 1))))))) (main (>> (call :rep (, 'ab' 3)) :out)))`,
				out: ['ababab'],
			});
			rule({
				src: `rep = <T>(x: T, n: Int32): String { n <= 0 ? '' : '\${x}\${rep(x, n - 1)}' };
main { rep(7, 4) >> out }`,
				ast: `(root (def :rep ? (fn @sequence (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (? (<= :n 0) '' (interp :x (call :rep (, :x (- :n 1))))))) (main (>> (call :rep (, 7 4)) :out)))`,
				out: ['7777'],
			});
			rule({
				src: `countDown = <T>(x: T, n: Int32): Int32 { n <= 0 ? 0 : 1 + countDown(x, n - 1) };
main { countDown('z', 5) >> out }`,
				ast: `(root (def :countDown ? (fn @sequence (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (? (<= :n 0) 0 (+ 1 (call :countDown (, :x (- :n 1))))))) (main (>> (call :countDown (, 'z' 5)) :out)))`,
				out: ['5'],
			});
			rule({
				p: 'A generic may wrap another generic and return its result: `join<T>` delegates to `fold`, whose type-param return resolves through the wrapper — piped or bound.',
				src: `cat = (a: String, b: String): String { '\${a}\${b}' };
join = <T>(t: T): String { fold(t, '', cat) };
main { join([ 'a', 'b', 'c' ]) >> out }`,
				ast: `(root (def :cat ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (interp :a :b))) (def :join ? (fn @sequence (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (call :fold (, :t '' :cat)))) (main (>> (call :join (data (, 'a' 'b' 'c'))) :out)))`,
				out: ['abc'],
			});
			rule({
				src: `add = (a: Int32, b: Int32): Int32 { a + b };
sum = <T>(t: T): Int32 { fold(t, 0, add) };
main { sum([ 1, 2, 3, 4 ]) >> out }`,
				ast: `(root (def :add ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (+ :a :b))) (def :sum ? (fn @sequence (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (call :fold (, :t 0 :add)))) (main (>> (call :sum (data (, 1 2 3 4))) :out)))`,
				out: ['10'],
			});
			rule({
				src: `join = <T>(t: T): String { fold(t, '', (a: String, b: String): String { '\${a}\${b}' }) };
main { join([ 'x', 'y', 'z' ]) >> out }`,
				ast: `(root (def :join ? (fn @sequence (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (call :fold (, :t '' (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) typeident (interp :a :b)))))) (main (>> (call :join (data (, 'x' 'y' 'z'))) :out)))`,
				out: ['xyz'],
			});
			rule({
				p: 'A multi-emit generic composes with another: `triple` re-emits `double`\\u2019s stream then one more, so `triple(3)` yields three values.',
				src: `double = <T>(f: T) { f, f };
triple = <T>(f: T) { double(f), f };
main { triple(3) >> out }`,
				ast: `(root (def :double ? (fn @sequence (, (parameter :T ? ?)) (parameter :f typeident ?) (, :f :f))) (def :triple ? (fn @sequence (, (parameter :T ? ?)) (parameter :f typeident ?) (, (call :double :f) :f))) (main (>> (call :triple 3) :out)))`,
				out: ['3', '3', '3'],
			});
		});

		h('Type-level chain in RHS', ({ ast }) => {
			ast({
				src: `type First<T> = T >> [H, R] { H }`,
				ast: `(type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident)))`,
			});
		});

		h('Type-level chain reduction', ({ rule }) => {
			rule({
				src: `type First<T> = T >> [H, R] { H }; v: First<[Int32, String]> = 42; main { v >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :v typeident 42) (main (>> :v :out)))`,
				out: ['42'],
			});
			rule({
				src: `type Each<T> = T >> [H, R] { H | Each<R> }; w: Each<[Int32, Bool]> = 7; main { w >> out }`,
				ast: `(root (type :Each (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :w typeident 7) (main (>> :w :out)))`,
				out: ['7'],
			});
			rule({
				src: `type First<T> = T >> [H, R] { H }; firstOf = <T>(t: T): First<T> { t.0 }; main { firstOf([42, 99]) >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :firstOf ? (fn @sequence (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (. :t 0))) (main (>> (call :firstOf (data (, 42 99))) :out)))`,
				out: ['42'],
			});
		});

		h('Recursive type definitions with implicit Void termination', ({ ast }) => {
			ast({
				src: `type Reverse<T> = T >> [H, R] { [Reverse<R>, H] }`,
				ast: `(type :Reverse (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (data (, (propdef ? typeident ?) (propdef ? typeident ?))))))`,
			});
		});

		h('Constraints via unions', ({ rule, compileError }) => {
			rule({
				src: `add = <T: Int32 | Int64>(a: T, b: T): T { a + b }; main { add(3, 4) >> out }`,
				ast: `(root (def :add ? (fn @sequence (, (parameter :T typeident ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident (+ :a :b))) (main (>> (call :add (, 3 4)) :out)))`,
				out: ['7'],
			});
			compileError({
				pre: `numeric = <T: Int32 | Float64>(x: T): T { x }`,
				src: `main { numeric('hi') >> out }`,
				expected: 'does not satisfy constraint',
			});
		});

		h('Compile errors', ({ compileError }) => {
			compileError({
				pre: `type Box<T> = [T, T]`,
				src: `b: Box<Int32, String> = [1, 2]`,
				expected: 'type argument',
			});
			compileError({
				pre: `type Pair<T, U> = [T, U]`,
				src: `p: Pair<Int32> = [42]`,
				expected: 'type argument',
			});
		});
	});

	h('Built-in identifiers', ({ h }) => {
		h('length', ({ expr }) => {
			expr({
				src: `length('hello')`,
				ast: `(call :length @intrinsic 'hello')`,
				out: ['5'],
			});
			expr({
				src: `length([1, 2, 3])`,
				ast: `(call :length @intrinsic (data (, 1 2 3)))`,
				out: ['3'],
			});
			expr({
				src: `length(5)`,
				ast: `(call :length @intrinsic 5)`,
				out: ['1'],
			});
			expr({
				src: `length([3])`,
				ast: `(call :length @intrinsic (data 3))`,
				out: ['1'],
			});
			expr({
				src: `length([ 'hi' ])`,
				ast: `(call :length @intrinsic (data 'hi'))`,
				out: ['2'],
			});
			expr({
				src: `length(void)`,
				ast: `(call :length @intrinsic :void)`,
				out: ['0'],
			});
		});
	});

	h('Modules', ({ p, modules }) => {
		p(
			`A module is a single source file; \`export\` marks its public surface. The standard library is a global prelude — its symbols (\`out\`, \`each\`, …) are in scope unqualified. \`@.seg.seg\` names a local module relative to the importing file; \`@name\` names a library through the entry's \`#importmap\`. \`(a, b) = @…\` binds exports by name (two or more names); \`m = @…\` binds the whole module as a namespace. A library never sees the program's map — its own \`#importmap\` starts a fresh unit, so published libraries carry no dependencies.`,
			({ ast }) => {
				ast({
					src: `export helper = (x: Int32) { x * 2 }`,
					ast: `(def @export :helper ? (fn @sequence (parameter :x typeident ?) (* :x 2)))`,
				});
			},
		);
		modules({
			p: 'Local modules, by-name destructuring, and namespace binds.',
			files: {
				'/util.gb': `export double = (n: Int32): Int32 { n * 2 };
export triple = (n: Int32): Int32 { n * 3 };`,
				'/geo.gb': `export area = (w: Int32, h: Int32): Int32 { w * h };`,
				'/main.gb': `(double, triple) = @.util;
geo = @.geo;
main { double(21) >> out; triple(7) >> out; geo.area(6, 7) >> out }`,
			},
			entry: '/main.gb',
			out: ['42', '21', '42'],
		});
		modules({
			p: 'A library resolves through the entry\u2019s `#importmap`, uses its own local modules, and its `main`-free exports fuse into the one program wasm.',
			files: {
				'/vendor/math/lib.gb': `(sq, cb) = @.impl;
export square = (n: Int32): Int32 { sq(n) };
export cube = (n: Int32): Int32 { cb(n) };`,
				'/vendor/math/impl.gb': `export sq = (n: Int32): Int32 { n * n };
export cb = (n: Int32): Int32 { n * n * n };`,
				'/main.gb': `#importmap { @math = './vendor/math/lib.gb'; }
(square, cube) = @math;
main { square(6) >> out; cube(3) >> out }`,
			},
			entry: '/main.gb',
			out: ['36', '27'],
		});
		modules({
			p: 'A `.gbm` bundle seals a library\u2019s closure — elaborated, post-check ASTs plus per-module hashes; the map accepts it interchangeably with a directory, and consumers assemble it without re-parsing or re-checking. Two bundles embedding an identical module dedupe by closure hash at assembly.',
			bundles: {
				'/vendor/a.gbm': {
					entry: '/dev/a/lib.gb',
					files: {
						'/dev/a/lib.gb': `(base, basex) = @.shared;
export ten = (n: Int32): Int32 { base(n) };`,
						'/dev/a/shared.gb': `export base = (n: Int32): Int32 { n * 10 };
export basex = (n: Int32): Int32 { n };`,
					},
				},
				'/vendor/b.gbm': {
					entry: '/dev/b/lib.gb',
					files: {
						'/dev/b/lib.gb': `(base, basex) = @.shared;
export eleven = (n: Int32): Int32 { base(n) + n };`,
						'/dev/b/shared.gb': `export base = (n: Int32): Int32 { n * 10 };
export basex = (n: Int32): Int32 { n };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap {
	@a = './vendor/a.gbm';
	@b = './vendor/b.gbm';
}
a = @a;
b = @b;
main { a.ten(4) >> out; b.eleven(4) >> out }`,
			},
			entry: '/main.gb',
			out: ['40', '44'],
		});
		modules({
			p: 'A destructure pattern binds exported values and exported types by the same name rule — the program writes signatures against a library\u2019s nominal types.',
			files: {
				'/items.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };`,
				'/main.gb': `(Item, mk) = @.items;
report = (i: Item): Int32 { i.id };
main { report(mk(7)) >> out }`,
			},
			entry: '/main.gb',
			out: ['7'],
		});
		modules({
			p: 'Closure-hash dedup unifies identical vendored modules across bundles: a value produced against one copy\u2019s nominal type is accepted by the other\u2019s typed consumer, because both copies became one module.',
			bundles: {
				'/vendor/a.gbm': {
					entry: '/dev/a/lib.gb',
					files: {
						'/dev/a/lib.gb': `(Item, mk) = @.shared;
export produce = (n: Int32): Item { next mk(n) };
export producex = (n: Int32): Int32 { n };`,
						'/dev/a/shared.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };
export idOf = (i: Item): Int32 { i.id };`,
					},
				},
				'/vendor/b.gbm': {
					entry: '/dev/b/lib.gb',
					files: {
						'/dev/b/lib.gb': `(Item, idOf) = @.shared;
export consume = (i: Item): Int32 { idOf(i) + 100 };
export consumex = (n: Int32): Int32 { n };`,
						'/dev/b/shared.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };
export idOf = (i: Item): Int32 { i.id };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap { @liba = './vendor/a.gbm'; @libb = './vendor/b.gbm'; }
(produce, producex) = @liba;
(consume, consumex) = @libb;
main { consume(produce(7)) >> out }`,
			},
			entry: '/main.gb',
			out: ['107'],
		});
		modules({
			p: 'An error constructed in a module carries its file in the origin frame; single-file programs omit it.',
			files: {
				'/items.gb': `export type Missing = Error & [ what: String ];
export find = (n: Int32): Int32 | Missing { next n > 0 ? n : [ what = 'thing' ] };`,
				'/main.gb': `(Missing, find) = @.items;
main { find(0) >> Int32 { 'ok' } | Error { String($) } >> out }`,
			},
			entry: '/main.gb',
			out: ['Missing at find:2 (items.gb)'],
		});
		modules({
			p: 'Import cycles are an error.',
			files: {
				'/a.gb': `(b1, bx) = @.b; export a1 = (n: Int32): Int32 { n };
export ax = (n: Int32): Int32 { n };`,
				'/b.gb': `(a1, ax) = @.a; export b1 = (n: Int32): Int32 { n };
export bx = (n: Int32): Int32 { n };`,
				'/main.gb': `(a1, ax) = @.a;
main { }`,
			},
			entry: '/main.gb',
			errors: 'import cycle',
		});
		modules({
			p: 'A module cannot declare `main` — it belongs to the program entry.',
			files: {
				'/lib.gb': `export f = (n: Int32): Int32 { n }; main { }`,
				'/main.gb': `(f, g) = @.lib;
main { }`,
			},
			entry: '/main.gb',
			errors: 'cannot declare `main`',
		});
		modules({
			p: 'An unmapped library name says exactly what to add.',
			files: {
				'/main.gb': `(a, b) = @nope;
main { }`,
			},
			entry: '/main.gb',
			errors: 'not in the import map',
		});
	});

	h('Statement separators', ({ rule, ast, compileError }) => {
		ast({
			src: `a = 1; b = 2;`,
			ast: '(def :a ? 1) (def :b ? 2)',
		});
		rule({
			src: `helper = (x: Int32) { x + 1 }; main { helper(1) >> out }`,
			ast: '(root (def :helper ? (fn @sequence (parameter :x typeident ?) (+ :x 1))) (main (>> (call :helper 1) :out)))',
			out: ['2'],
		});
		compileError({
			src: `count = 1; main { count >> out };`,
			expected: '";" is not allowed after',
		});
		compileError({
			src: `a = 1 b = 2`,
			expected: 'Expected ";"',
		});
		ast({
			src: `a = 1;`,
			ast: '(def :a ? 1)',
		});
		rule({
			p: '`;` separates statements and the trailing `;` is optional — a single statement, or the last statement in a block, may carry one or omit it.',
			src: `main { x = 5; x >> out }`,
			ast: '(root (main (def :x ? 5) (>> :x :out)))',
			out: ['5'],
		});
	});

	h('Statements', ({ h }) => {
		h('loop', ({ rule }) => {
			rule({
				src: `range = (n: Int32) { loop >> { $ >= n ? break : $ } }; main { range(3) >> out }`,
				ast: '(root (def :range ? (fn @sequence (parameter :n typeident ?) (>> loop (fn @sequence (? (>= $ :n) break $))))) (main (>> (call :range 3) :out)))',
				out: ['0', '1', '2'],
			});
			rule({
				src: `runUntil = (limit: Int32): Int32 { counter: var = 0; loop >> (i: Int32) { counter == limit ? break; counter = counter + 1; }; next counter; }; main { runUntil(5) >> out }`,
				ast: '(root (def :runUntil ? (fn (parameter :limit typeident ?) typeident (def @variable :counter ? 0) (>> loop (fn (parameter :i typeident ?) (? (== :counter @variable :limit) break) (= :counter @variable (+ :counter @variable 1)))) (next :counter @variable))) (main (>> (call :runUntil 5) :out)))',
				out: ['5'],
			});
			rule({
				src: `nestedBreak = (): Int32 { total: var = 0; loop >> (i: Int32) { i >= 2 ? break; loop >> (j: Int32) { j >= 2 ? break; total = total + 1; }; }; next total; }; main { nestedBreak() >> out }`,
				ast: `(root (def :nestedBreak ? (fn typeident (def @variable :total ? 0) (>> loop (fn (parameter :i typeident ?) (? (>= :i 2) break) (>> loop (fn (parameter :j typeident ?) (? (>= :j 2) break) (= :total @variable (+ :total @variable 1)))))) (next :total @variable))) (main (>> (call :nestedBreak ?) :out)))`,
				out: ['4'],
			});
		});

		h('break', ({ compileError }) => {
			compileError({
				src: `main { break }`,
				expected: '`break` outside pipe stage',
			});
			compileError({
				src: `f = (): Int32 { break }; main { f() >> out }`,
				expected: '`break` outside pipe stage',
			});
		});
	});

	h('Test blocks', ({ ast, compileError, rule, testBlock }) => {
		ast({
			src: `#test { 5 == 5 } target = (): Int32 { 5 }`,
			ast: `(test (== 5 5)) (def :target ? (fn @sequence typeident 5))`,
		});
		rule({
			src: `#test { ok(true) } export dbl = (n: Int32): Int32 { n * 2 }; main { dbl(5) >> out }`,
			ast: `(root (test (call :ok :true)) (def @export :dbl ? (fn @sequence (parameter :n typeident ?) typeident (* :n 2))) (main (>> (call :dbl 5) :out)))`,
			out: ['10'],
		});
		compileError({
			src: `#test { missingHelper(1) } target = (): Int32 { 1 }`,
			expected: 'Identifier not defined',
		});
		compileError({
			src: `#test { missingHelper(1) } target = (): Int32 { 1 }`,
			expected: 'Identifier not defined',
			testMode: true,
		});
		compileError({
			src: `#test { ok(true) } main { }`,
			expected: 'must immediately precede a function definition',
		});
		compileError({
			src: `#test { ok(true) } helper = (n: Int32): Int32 { n + 1 }; main { }`,
			expected: 'declared but never used',
		});
		testBlock({
			src: `#test { ok(5 == 5) } export target = (): Int32 { 5 }`,
			out: [],
		});
		testBlock({
			src: `#test { ok(5 == 6) } export target = (): Int32 { 5 }`,
			out: ['assertion failed'],
		});
		testBlock({
			src: `#test { equal(5, 5); equal(1, 2); equal(3, 3); } export target = (): Int32 { 5 }`,
			out: ['1 != 2'],
		});
		testBlock({
			src: "export hi = (): String { '${Char(72)}${Char(105)}' }; #test { equal(hi(), 'Hi') } export target = (): Int32 { 5 };",
			out: [],
		});
	});

	h('Ownership', ({ expr, compileError, rule }) => {
		rule({
			p: 'Drop glue: an owned heap value not moved out is freed at its block’s exit, so repeated allocation runs in constant memory (the free list is reused).',
			src: `step = (t: String): Int32 { s = 'xxxxxxxx\${t}yyyyyyyy'; next length(s) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step('zzzz')) };
main { spin(50000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :t typeident ?) typeident (def :s ? (interp :t)) (next (call :length @intrinsic :s)))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step 'zzzz'))))))) (main (>> (call :spin (, 50000 0)) :out)))`,
			out: ['1000000'],
			maxPages: 3,
		});
		rule({
			p: 'Expression temporaries — unbound results whose freshness is structural (an interp, a conversion, a call whose every return path is fresh-or-static) — are freed at their consumption point, so formatting in a loop runs in constant memory.',
			src: `spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + length('v\${n}')) };
main { spin(50000, 0) >> out }`,
			ast: `(root (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :length @intrinsic (interp :n)))))))) (main (>> (call :spin (, 50000 0)) :out)))`,
			out: ['288894'],
			maxPages: 3,
		});
		rule({
			p: 'A binding of a call whose every return path is fresh — including `next` of a local the callee owns, the constructor idiom — is owned by the binding block and freed at its exit.',
			src: `mkpad = (n: Int32): String { s = 'p\${n}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; next s };
probe = (n: Int32): Int32 { b = mkpad(n); next length(b) };
churn = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : churn(n - 1, acc + probe(n)) };
main { churn(50000, 0) >> out }`,
			ast: `(root (def :mkpad ? (fn (parameter :n typeident ?) typeident (def :s ? (interp :n)) (next :s))) (def :probe ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mkpad :n)) (next (call :length @intrinsic :b)))) (def :churn ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :churn (, (- :n 1) (+ :acc (call :probe :n))))))) (main (>> (call :churn (, 50000 0)) :out)))`,
			out: ['1888894'],
			maxPages: 3,
		});
		rule({
			p: 'A call whose result may alias a borrow (any return path yields a param or local) is never freed as a temporary — the owner’s value survives the call.',
			src: `id = (s: String): String { s };
main { t = 'q\${1}'; length(id(t)) + length(t) >> out }`,
			ast: `(root (def :id ? (fn @sequence (parameter :s typeident ?) typeident :s)) (main (def :t ? (interp 1)) (>> (+ (call :length @intrinsic (call :id :t)) (call :length @intrinsic :t)) :out)))`,
			out: ['4'],
		});
		rule({
			p: 'Error values, union payloads (branched on the live member\u2019s tag), and record literals are dropped like every owned value — error frees include the trace chain, so debug builds also run flat.',
			debug: true,
			src: `type Miss = Error & [ id: Int32 ];
get = (n: Int32): Int32 | Miss { next n > 0 ? n : [ id = n ] };
step = (n: Int32): Int32 { r = get(n - 50000); next r >> Int32 { $ } | Miss { 0 } };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Miss (& typeident (data (propdef :id typeident ?)))) (def :get ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (data (propdef :id ? :n)))))) (def :step ? (fn (parameter :n typeident ?) typeident (def :r ? (call :get (- :n 50000))) (next (>> :r (| (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0)))))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['1250025000'],
			maxPages: 3,
		});
		compileError({
			p: 'A `var` binding holds scalars only. Heap values (strings, data, errors) are single-assignment — created by a binding, moved by `next`, piped to consumers — so no mutable slot ever holds one, nothing needs freeing on reassignment, and no stored alias can outlive its owner.',
			src: `g: var = '';
main { g = 'x' }`,
			expected: 'holds scalars only',
		});
		compileError({
			src: `main { s: var = 'a\${1}'; s = 'b'; s >> out }`,
			expected: 'holds scalars only',
		});
		rule({
			p: 'Embedding an owned local in a labeled record member moves it — the record owns its members and dropping it frees them too (nested inline records included); the source name stays readable, as a borrow, until the record itself moves.',
			src: `step = (n: Int32): Int32 { m = 'x\${n}'; r = [ msg = m, id = n ]; next length(m) + r.id - n };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :n typeident ?) typeident (def :m ? (interp :n)) (def :r ? (data (, (propdef :msg ? :m) (propdef :id ? :n)))) (next (- (+ (call :length @intrinsic :m) (. :r :id)) :n)))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		compileError({
			src: `gen = (n: Int32) { m = 'x\${n}'; r = [ msg = m ]; next r; next [ msg = 'y\${length(m)}' ] };
main { gen(3) >> each >> out }`,
			expected: 'moved with',
		});
		compileError({
			src: `main { m = 'x\${1}'; r = [ a = m, b = m ]; length(r.a) >> out }`,
			expected: 'embedded twice',
		});
		compileError({
			src: `main { a = 'x\${1}'; b = a; r = [ msg = b ]; r.msg >> out }`,
			expected: 'cannot embed borrowed',
		});
		rule({
			p: 'A fresh value passed where the callee cannot retain it (scalar return, or every return path fresh) is freed by the caller after the call. A tail call to another fn demotes to a plain call rather than orphan the temp; self-recursion keeps `return_call`.',
			src: `use = (s: String): Int32 { length(s) };
step = (n: Int32): Int32 { use('x\${n}') };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :use ? (fn @sequence (parameter :s typeident ?) typeident (call :length @intrinsic :s))) (def :step ? (fn @sequence (parameter :n typeident ?) typeident (call :use (interp :n)))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		rule({
			p: 'A borrow-returning call\u2019s bound result adopts its fresh arguments: they live exactly as long as the binder\u2019s name — freed with the block, or carried along when the name moves out. Emitting a name that borrows a value dying with its block is rejected.',
			src: `pick = (a: String, b: String, k: Int32): String { k > 0 ? a : b };
step = (n: Int32): Int32 { r = pick('x\${n}', 'y', n); next length(r) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :pick ? (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (parameter :k typeident ?) typeident (? (> :k 0) :a :b))) (def :step ? (fn (parameter :n typeident ?) typeident (def :r ? (call :pick (, (interp :n) 'y' :n))) (next (call :length @intrinsic :r)))) (def :spin ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		compileError({
			src: `f = (): String { a = 'x\${1}'; b = a; next b };
main { f() >> out }`,
			expected: 'dies with this block',
		});
		rule({
			p: 'A self-recursive fn whose every call site passes a fresh value owns that heap param: each iteration frees the previous accumulator (a bare re-pass at the tail moves it instead), so accumulator recursion runs near its final size — with `return_call` kept, proven here by the depth.',
			src: `build = (n: Int32, acc: String): String { n == 0 ? acc : build(n - 1, '\${acc}x') };
main { length(build(200000, '')) >> out }`,
			ast: `(root (def :build ? (fn @sequence (parameter :n typeident ?) (parameter :acc typeident ?) typeident (? (== :n 0) :acc (call :build (, (- :n 1) (interp :acc)))))) (main (>> (call :length @intrinsic (call :build (, 200000 ''))) :out)))`,
			out: ['200000'],
			maxPages: 16,
		});
		rule({
			p: 'A fused loop frees what each iteration created — bound locals, and emitted values once a stage chain fully consumed them (a scalar drive result proves no stage kept the pointer) — so streaming loops run flat.',
			src: `gen = (n: Int32) { next 'a\${n}'; next 'b\${n}' };
main { total: var = 0; loop >> (i: Int32) { i >= 50000 ? break; m = 'x\${i}'; gen(length(m)) >> (s: String) { total = total + length(s); }; }; total >> out }`,
			ast: `(root (def :gen ? (fn (parameter :n typeident ?) (next (interp :n)) (next (interp :n)))) (main (def @variable :total ? 0) (>> loop (fn (parameter :i typeident ?) (? (>= :i 50000) break) (def :m ? (interp :i)) (>> (call :gen (call :length @intrinsic :m)) (fn @sequence (parameter :s typeident ?) (= :total @variable (+ :total @variable (call :length @intrinsic :s))))))) (>> :total @variable :out)))`,
			out: ['200000'],
			maxPages: 3,
		});
		rule({
			p: 'A value moved out with `next` is not freed by its creating block — the receiver reads it after later allocations.',
			src: `mk = (n: Int32): String { s = 'm\${n}'; next s };
main { a = mk(1); b = mk(2); a >> out; b >> out; }`,
			ast: `(root (def :mk ? (fn (parameter :n typeident ?) typeident (def :s ? (interp :n)) (next :s))) (main (def :a ? (call :mk 1)) (def :b ? (call :mk 2)) (>> :a :out) (>> :b :out)))`,
			out: ['m1', 'm2'],
		});
		rule({
			p: 'A callee never frees what it borrows — the owner’s value stays valid after the call.',
			src: `peek = (s: String): Int32 { length(s) };
main { t = 'q\${1}'; peek(t) >> out; peek(t) >> out; t >> out; }`,
			ast: `(root (def :peek ? (fn @sequence (parameter :s typeident ?) typeident (call :length @intrinsic :s))) (main (def :t ? (interp 1)) (>> (call :peek :t) :out) (>> (call :peek :t) :out) (>> :t :out)))`,
			out: ['2', '2', 'q1'],
		});
		expr({
			p: 'Scalars (`Int32`, `Float64`, `Bool`, `Char`) and interned string literals are copied, not owned — they may be rebound and read any number of times.',
			pre: 'a = 5; b = a',
			src: 'a + b',
			ast: '(+ :a :b)',
			out: ['10'],
		});
		expr({
			p: 'A heap value (a computed `String`, a data block, …) is owned by the block that creates it and freed at that block’s exit, its owned fields freed with it. Reading it — a field access, `length`, or passing it to a function — borrows it and leaves it valid; a value leaves its block only through `next`.',
			pre: 'twice = (s: String): Int32 { length(s) + length(s) }',
			src: "twice('hi')",
			ast: "(call :twice 'hi')",
			out: ['4'],
		});
		expr({
			p: '`next` of a borrowed value — a parameter, or an element drawn from one — emits a reference, not a move: it may be emitted repeatedly and forwarded freely, and the owner still frees it once. This is what makes `triple(x){x,x,x}` and `filter` expressible.',
			pre: 'triple = (s: String) { next s; next s; next s }',
			src: "triple('hi')",
			ast: "(call :triple 'hi')",
			out: ['hi', 'hi', 'hi'],
		});
		compileError({
			p: '`next` of a value owned here moves it to the receiver; the block no longer owns it, so using it again is an error. Emitting an owned value twice would need a copy, and there is no implicit copy.',
			src: "g = () { s = '${Char(65)}'; next s; next s }; main { g() >> out }",
			expected: 'used after move',
		});
		expr({
			p: 'Nothing transfers ownership but `next`; a binding never does. `b = a` borrows — both names read the one value, freed once at block exit. There is no clone: to hold a value past its owner it must be moved there (a fresh value), never duplicated.',
			pre: "dup = (): Int32 { s = '${Char(65)}'; b = s; next length(b) + length(s) }",
			src: 'dup()',
			ast: '(call :dup ?)',
			out: ['2'],
		});
		compileError({
			p: 'A binding that is never read is rejected as unused.',
			src: "main { s = 'hi'; b = s }",
			expected: 'never used',
		});
	});
});
