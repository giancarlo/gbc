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

	h('Comments', ({ p }) => {
		p(
			'Comments start with the `#` character and end at the end of line.',
			({ ast, match, equal, rule }) => {
				match('# Single Line Comment', 'comment');
				ast({
					src: '# Line Comment 1\n  # Line Comment 2\n',
					ast: 'comment comment',
				});
				ast({
					src: '# Comment 1\n#Comment 2\nmain { }',
					ast: 'comment comment (main)',
					test: ast => {
						equal(ast.children[0]?.line, 0);
						equal(ast.children[2]?.line, 2);
					},
				});

				rule({
					src: '# Comment\nmain { }\n# Comment 2',
					ast: '(root comment (main) comment)',
					test: ast => {
						equal(ast.children[1]?.line, 1);
					},
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

	h('Operators', ({ h, token, expr, match }) => {
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
		token('is', 'Type test (returns Bool; narrows in truthy branch)', 'is');

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
	 expr({ src: '1 + 2', ast: '(+ 1 2)', out: [3] });
	 expr({ src: '10 - 3', ast: '(- 10 3)', out: [7] });
	 expr({ src: '6 * 7', ast: '(* 6 7)', out: [42] });
	 expr({ src: '100 / 4', ast: '(/ 100 4)', out: [25] });
	 expr({
			src: '(10 + 5) * 2',
			ast: '(* (+ 10 5) 2)',
			out: [30],
		});

		match(
			'-10 -10_000 -10.53_3',
			'-',
			'number',
			'-',
			'number',
			'-',
			'number',
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
				p: 'bitwise',
				src: `[ ~0, 1 <: (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
				ast: `(data (, -1 (<: 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))`,
				out: [-1, 1 << (32 - 1), 0xf4],
			});
		});

		h('Numeric promotion', ({ expr }) => {
			expr({
				p: 'Mixing an integer literal with a float literal promotes the integer to the float\'s type (Float64 by default).',
				src: `1 + 1.5`,
				ast: `(+ 1 1.5)`,
				out: [2.5],
			});
			expr({
				p: 'Promotion also applies through typed bindings — `Int32 + Float64` yields `Float64`.',
				pre: `a: Int32 = 1; b: Float64 = 1.5`,
				src: `a + b`,
				ast: `(+ :a :b)`,
				out: [2.5],
			});
		});

		h('Conditional operator', ({ expr, compileError }) => {
			expr({
				p: 'Pure value-ternary: `cond ? a : b` selects one of two values. Both branches are required and must have compatible types.',
				src: '1 ? 2 : 3',
				ast: '(? 1 2 3)',
				out: [2],
			});
			expr({
				p: '`break` and `done` are bottom-typed control flow — they never return. They may appear in either branch of `?:`; the result type is determined by the non-bottom branch.',
				src: `loop >> { $ >= 3 ? break : $ }`,
				ast: `(>> loop (fn @sequence (? (>= $ 3) break $)))`,
				out: [0, 1, 2],
			});
			expr({
				p: 'Value-ternary inside `next` is the canonical form for value-choice emission.',
				pre: `pick = (b: Bool): Int32 { next b ? 10 : 20 }`,
				src: `pick(true)`,
				ast: `(call :pick :true)`,
				out: [10],
			});
			compileError({
				p: 'Single-branch `?:` is invalid where its value is consumed (value-only forms) — both branches required (or a bottom-typed control branch like `break`/`done`). In an emit position it is allowed (conditional emission, below).',
				src: `main { 1 > 10 ? 'big' >> out }`,
				expected: 'requires both branches',
			});
			expr({
				p: 'A stage emits its body value for each input, so `>> each >> T { f($) }` is `map` — the chain is the transform; no `map` function is needed.',
				src: `[1, 2, 3] >> each >> Int32 { $ * 2 }`,
				ast: `(>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident ?) (* $ 2)))`,
				out: [2, 4, 6],
			});
			expr({
				p: 'In an emit position (a stage body), single-branch `cond ? value` emits `value` when the condition holds and emits nothing when it does not — the chain stops on the false path. This is the canonical filter; no `filter` function is needed.',
				src: `[1, 2, 3] >> each >> Int32 { $ > 1 ? $ }`,
				ast: `(>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident ?) (? (> $ 1) $)))`,
				out: [2, 3],
			});
			compileError({
				p: '`void` is not a value and cannot be emitted — a chain stops on void rather than emitting a void value. Use single-branch `cond ? value` for conditional emission.',
				src: `main { 5 >> Int32 { void } }`,
				expected: 'cannot be emitted',
			});
			compileError({
				p: '`next` is not allowed in `?:` branches — use `next cond ? X : Y` (value-ternary inside `next`).',
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
			token('is', 'Type test operator (narrows in truthy branch)', 'is');
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
			p: 'Decimal floats accept scientific notation with `e` or `E` exponent. Underscores in exponent digits group large values.',
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

	h('String Literals', ({ h, match }) => {
		match(`'variable length \\'string\\''`, 'string');
		match(
			`'
        Multiline
        String
    '`,
			'string',
		);
		match("'${1}+${1}=${1+1}'", 'string');

		h('Escape Sequences', ({ expr }) => {
		 expr({
				p: 'String literals support escape sequences such as newline and unicode code points.',
				src: `'line\\nA\\u{42}'`,
				ast: "'line\\nA\\u{42}'",
				out: ['line\nAB'],
			});
		 expr({
				p: "Basic escape sequences: `\\n` newline, `\\r` carriage return, `\\t` tab, `\\'` single quote, `\\0` null character.",
				src: `'a\\nb\\rc\\td\\'e\\0f'`,
				ast: `'a\\nb\\rc\\td\\'e\\0f'`,
				out: ["a\nb\rc\td'e\0f"],
			});
		});
	});

	h('Data Blocks', ({ expr, compileError }) => {
		expr({
			p: `Data blocks are enclosed in brackets '[]' and are zero-indexed.`,
			src: `[ 'string', 2, true, 4.5 ]`,
			ast: `(data (, 'string' 2 :true 4.5))`,
		});
		expr({
			p: `Data blocks represent memory, they are not collections. Items can't be added or removed.
				    Think of them like strings. The first character is the same as the individual character.
				    A single-item data block is equal to its sole element (D10 singleton-collapse).`,
			src: `[ 10 ] == 10`,
			ast: `(== (data 10) 10)`,
			out: [true],
		});
		expr({
			p: `Labels alias positions in a data block.`,
			src: `[ label = 'string', 2 ]`,
			ast: `(data (, (propdef :label ? 'string') 2))`,
		});
		expr({
			p: `Labels are read with the \`.\` operator.`,
			src: `[ first = 'a', second = 'b' ].first`,
			ast: `(. (data (, (propdef :first ? 'a') (propdef :second ? 'b'))) :first)`,
			out: ['a'],
		});
		expr({
			p: `Positions are accessed with \`.\` followed by an integer literal.`,
			src: `[ 10, 20, 30 ].1`,
			ast: `(. (data (, 10 20 30)) 1)`,
			out: [20],
		});
		expr({
			p: `A label and its position name the same value.`,
			src: `[ x = 10, y = 20 ].0`,
			ast: `(. (data (, (propdef :x ? 10) (propdef :y ? 20))) 0)`,
			out: [10],
		});
		expr({
			p: `A label may name a function; \`block.label(args)\` calls it. Because the label is a constant function, the call resolves to a direct call at compile time — a record of functions is a static namespace (this is how the prelude exposes \`runtime.trace()\`).`,
			pre: `double = (n: Int32): Int32 { n + n }; math = [ d = double ]`,
			src: `math.d(5)`,
			ast: `(call (. :math :d) 5)`,
			out: [10],
		});
		expr({
			p: `Labels can appear anywhere; positions count up regardless.`,
			src: `[ 1, x = 2, 3 ]`,
			ast: `(data (, 1 (propdef :x ? 2) 3))`,
		});
		compileError({
			p: `Label names must be unique.`,
			src: `main { [ x = 1, x = 2 ] >> out }`,
			expected: 'Duplicate label "x"',
		});
		expr({
			p: `\`var\` is a type modifier marking a value as mutable. Annotated fields use \`name: type = value\`; the name is optional.`,
			src: `[ name: var = 'Alice', :var = 30 ]`,
			ast: `(data (, (propdef @variable :name ? 'Alice') (propdef @variable ? ? 30)))`,
		});
		expr({
			p: `\`>>\` passes data blocks through as single values. Use \`each\` to iterate.`,
			src: `[ 1, 2 ] >> each`,
			ast: `(>> (data (, 1 2)) :each)`,
			out: [1, 2],
		});
		expr({
			p: `Data blocks pass through \`>>\` as one value.`,
			pre: `sum = (b) { b.0 + b.1 }`,
			src: `[ 10, 20 ] >> sum`,
			ast: `(>> (data (, 10 20)) :sum)`,
			out: [30],
		});
		expr({
			p: `Iteration yields values only; labels are compile-time aliases and do not appear at runtime.`,
			src: `[ x = 1, y = 2 ] >> each`,
			ast: `(>> (data (, (propdef :x ? 1) (propdef :y ? 2))) :each)`,
			out: [1, 2],
		});
		expr({
			p: `Nested data block literals are flattened; data has no runtime nesting.`,
			src: `[ [1, 2], [3, 4] ].2`,
			ast: `(. (data (, (data (, 1 2)) (data (, 3 4)))) 2)`,
			out: [3],
		});
		expr({
			p: `Iteration over a nested literal yields the flattened values.`,
			src: `[ [1, 2], [3, 4] ] >> each`,
			ast: `(>> (data (, (data (, 1 2)) (data (, 3 4)))) :each)`,
			out: [1, 2, 3, 4],
		});
	});

	h('Code Blocks', ({ expr, ast, h, compileError }) => {
		expr({
			p: `Code Blocks are defined with \`{}\` and are first-class function values. To declare parameters, prefix the body with \`(params)\`. The body may be auto-emit (value-expressions, no \`;\`) or a statement body (statements with \`;\`, using \`next\` to emit).`,
			src: `(a) { a }`,
			ast: `(fn @sequence (parameter :a ? ?) :a)`,
		});
		expr({
			p: `Code Blocks accept a single data-block argument. With a destructuring pattern, the slots are bound to local names.`,
			src: `(a: Int32, b: Int32) { a + b }`,
			ast: `(fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (+ :a :b))`,
		});
		ast({
			p: `Code Blocks can accept other code blocks as parameters or return code blocks.`,
			src: `helper = (f: Fn) { { f() } }`,
			ast: `(def :helper ? (fn @sequence (parameter :f typeident ?) (fn @sequence (call :f ?))))`,
		});
		expr({
			p: `The code block argument is available as \`$\`. Named arguments can be accessed with the '.' operator.`,
			src: `[value = 5] >> { 10 + $.value }`,
			ast: `(>> (data (propdef :value ? 5)) (fn @sequence (+ 10 (. $ :value))))`,
			out: [15],
		});
		expr({
			p: `Anonymous \`{ expr }\` is a function value; each top-level expression auto-emits when the block runs.`,
			src: `{ 1 + 2 }`,
			ast: `(fn @sequence (+ 1 2))`,
			out: [3],
		});
		expr({
			p: `Comma-separated expressions in \`{}\` each emit a value.`,
			src: `{ 1, 2, 3 }`,
			ast: `(fn @sequence (, 1 2 3))`,
			out: [1, 2, 3],
		});
		expr({
			p: `Empty \`{ }\` is the canonical no-op function — zero emissions.`,
			src: `{ }`,
			ast: `(fn @sequence)`,
			out: [],
		});
		compileError({
			p: `Empty parameter list with empty body \`() { }\` is invalid; use \`{ }\` for a no-op function.`,
			src: `main { () { } >> out }`,
			expected: 'Empty `() { }`',
		});
		compileError({
			p: '`next` is statement-only and cannot appear in an expression position, including the body of `{}`.',
			src: `main { { next 1 } >> out }`,
			expected: '`next` is not allowed in auto-emit',
		});
		compileError({
			p: '`done` is a statement and is not allowed as an expression value.',
			src: `main { { done } >> out }`,
			expected: '`done`',
		});
		compileError({
			p: '`break` is a statement and is not allowed as an expression value.',
			src: `main { { break } >> out }`,
			expected: '`break`',
		});
		compileError({
			p: '`next` cannot appear as the value of another `next`.',
			src: `f = { next next 1; }; main { f() >> out }`,
			expected: 'Expected expression',
		});
		compileError({
			p: '`next` cannot appear as a value in an expression (e.g. as a function argument).',
			src: `f = (x: Int32) { x }; main { f(next 1) >> out }`,
			expected: 'Expected ")"',
		});
		expr({
			p: 'The call `()` operator groups comma-separated values into a data block. `f(1, 2, 3)` passes `[1, 2, 3]` as the single argument.',
			pre: `x = { $ }`,
			src: `x(1, 2, 3)`,
			ast: `(call :x (, 1 2 3))`,
			out: [1, 2, 3],
		});
	 expr({
			p: 'Named arguments use `name = value`. They are matched to parameters by name regardless of order.',
			pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
			src: `add(b = 1, a = 2)`,
			ast: `(call :add (, (propdef :b ? 1) (propdef :a ? 2)))`,
			out: [3],
		});
		expr({
			p: 'Parameters can declare default values. Pass `void` in a slot to use its default.',
			pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
			src: `addOne(void)`,
			ast: `(call :addOne :void)`,
			out: [42],
		});

		h('Recursion', ({ rule }) => {
			rule({
				p: 'Code Blocks can call themselves recursively.',
				src: `factorial = (n: Int32): Int32 { (n <= 1) ? 1 : n * factorial(n - 1) }; main { factorial(0) >> out; factorial(1) >> out; factorial(2) >> out; factorial(3) >> out; factorial(4) >> out; factorial(5) >> out; }`,
				ast: '(root (def :factorial ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 1) 1 (* :n (call :factorial (- :n 1)))))) (main (>> (call :factorial 0) :out) (>> (call :factorial 1) :out) (>> (call :factorial 2) :out) (>> (call :factorial 3) :out) (>> (call :factorial 4) :out) (>> (call :factorial 5) :out)))',
				out: [1, 1, 2, 6, 24, 120],
			});

			rule({
				p: 'fibonacci',
				src: `fib = (n: Int32): Int32 { n <= 1 ? n : fib(n - 1) + fib(n - 2) }; main { fib(0) >> out; fib(1) >> out; fib(2) >> out; fib(3) >> out; fib(4) >> out; fib(5) >> out; fib(6) >> out; }`,
				ast: '(root (def :fib ? (fn @sequence (parameter :n typeident ?) typeident (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2)))))) (main (>> (call :fib 0) :out) (>> (call :fib 1) :out) (>> (call :fib 2) :out) (>> (call :fib 3) :out) (>> (call :fib 4) :out) (>> (call :fib 5) :out) (>> (call :fib 6) :out)))',
				out: [0, 1, 1, 2, 3, 5, 8],
			});

			rule({
				p: 'ackermann',
				src: `ackermann = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1)))) }; main { ackermann(1, 3) >> out; ackermann(2, 3) >> out; ackermann(3, 3) >> out; ackermann(1, 5) >> out; ackermann(2, 5) >> out; ackermann(3, 5) >> out; }`,
				ast: `(root (def :ackermann ? (fn @sequence (parameter :m typeident ?) (parameter :n typeident ?) typeident (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1))))))))) (main (>> (call :ackermann (, 1 3)) :out) (>> (call :ackermann (, 2 3)) :out) (>> (call :ackermann (, 3 3)) :out) (>> (call :ackermann (, 1 5)) :out) (>> (call :ackermann (, 2 5)) :out) (>> (call :ackermann (, 3 5)) :out)))`,
				out: [5, 9, 61, 7, 13, 253],
			});
		});

		h('Emitting Values', ({ expr }) => {
			expr({
				p: 'Inside a `(...){}` body, the `next` statement emits a value. A function can emit zero, one, or many values; `next(a, b, c)` emits each of a, b, c separately.',
				pre: `emitValues = { next(1, 2, 3); done; }`,
				src: `emitValues()`,
				ast: `(call :emitValues ?)`,
				out: [1, 2, 3],
			});
			expr({
				p: 'When a stage emits multiple values, each value flows downstream independently.',
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: [2, 3],
			});
			expr({
				p: 'A stage that emits nothing causes downstream stages to receive nothing.',
				pre: `emit = { done }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: [],
			});
			expr({
				p: 'A stage that emits multiple values per input multiplies the sequence. Comma-separated expressions in `{}` each emit.',
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $, $ + 10 }`,
				ast: `(>> (call :emit ?) (fn @sequence (, $ (+ $ 10))))`,
				out: [1, 11, 2, 12],
			});
		});

		h('Completion', ({ expr }) => {
			expr({
				p: 'The `done` statement inside a `(...){}` body terminates the function early; statements after `done` do not run.',
				pre: 'demo = { next(1); done; next(2); }',
				src: 'demo()',
				ast: '(call :demo ?)',
				out: [1],
			});
		});

		h('Chaining', ({ expr }) => {
			expr({
				p: 'Functions can be chained with `>>`. The pipe passes the left value into the right stage as its argument, bound to `$`.',
				pre: `
a = {
	add4 = (a: Int32) { a + 4 };
	times2 = (a: Int32) { a * 2 };
	add4times2 = { $ >> add4 >> times2 };
	next(10 >> add4times2);
}`,
				src: `a()`,
				ast: '(call :a ?)',
				out: [28],
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
					p: 'Empty block — canonical no-op function with zero emissions.',
					src: `{ }`,
					ast: `(fn @sequence)`,
					out: [],
				});
				expr({
					p: 'Single value-expression auto-emits.',
					src: `{ 5 }`,
					ast: `(fn @sequence 5)`,
					out: [5],
				});
				expr({
					p: 'Comma-separated value-expressions each auto-emit.',
					src: `{ 1, 2, 3 }`,
					ast: `(fn @sequence (, 1 2 3))`,
					out: [1, 2, 3],
				});
				expr({
					p: '`$` is the upstream value when used as a pipe stage.',
					src: `5 >> { $ + 1 }`,
					ast: `(>> 5 (fn @sequence (+ $ 1)))`,
					out: [6],
				});
				expr({
					p: 'Field access via `$.name` on labeled upstream data.',
					src: `[x = 10] >> { $.x }`,
					ast: `(>> (data (propdef :x ? 10)) (fn @sequence (. $ :x)))`,
					out: [10],
				});
				expr({
					p: 'Statement body uses `;` to separate statements; `next` emits values.',
					src: `{ next 5; next 6; }`,
					ast: `(fn (next 5) (next 6))`,
					out: [5, 6],
				});
				expr({
					p: '`break` is valid in a block. As a chain stage it terminates the enclosing chain.',
					src: `loop >> { break }`,
					ast: `(>> loop (fn break))`,
					out: [],
				});
				compileError({
					p: '`next` in auto-emit body (single expression, no `;`) is forbidden — use `{ X }` to emit X directly.',
					src: `main { { next 5 } >> out }`,
					expected: '`next` is not allowed',
				});
				compileError({
					p: '`done` alone in a block is a no-op — invalid.',
					src: `main { { done } >> out }`,
					expected: '`done`',
				});
				compileError({
					p: 'Statement body that produces no emissions is invalid (use comma-list `{ a, b }` for auto-emit).',
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
					p: 'Simple type prefix; `$` is typed as Int32.',
					src: `5 >> Int32 { $ + 1 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident ?) (+ $ 1)))`,
					out: [6],
				});
				expr({
					p: 'Multi-emit via commas; return type is inferred from emissions.',
					src: `5 >> Int32 { 1, 2, 3 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident ?) (, 1 2 3)))`,
					out: [1, 2, 3],
				});
				expr({
					p: 'Type prefix `Error` is a catch-all for any error variant — it matches by composition, since every error type composes `Error` (D50).',
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { next n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ + 1 } >> Error { 99 }`,
					ast: `(>> (call :risky 0) (fn @sequence (parameter ? typeident ?) (+ $ 1)) (fn @sequence (parameter ? typeident ?) 99))`,
					out: [99],
				});
				expr({
					p: 'Bool prefix; `$` is the bool value (passthrough).',
					src: `true >> Bool { $ }`,
					ast: `(>> :true (fn @sequence (parameter ? typeident ?) $))`,
					out: [true],
				});
				expr({
					p: 'Union type prefix; matches any variant of the union.',
					pre: `mixed = (): Int32 | String { next 42 }`,
					src: `mixed() >> Int32 | String { $ }`,
					ast: `(>> (call :mixed ?) (fn @sequence (parameter ? typeident ?) $))`,
					out: [42],
				});
				expr({
					p: 'Tuple type prefix; `$` is the positional tuple, accessed via `.N`.',
					src: `[1, 'hi'] >> [Int32, String] { $.0 }`,
					ast: `(>> (data (, 1 'hi')) (fn @sequence (parameter ? (data (, (propdef ? typeident ?) (propdef ? typeident ?))) ?) (. $ 0)))`,
					out: [1],
				});
				expr({
					p: 'Labeled record type prefix; `$` has labeled fields accessed via `.name`.',
					src: `[a = 10, b = 20] >> [a: Int32, b: Int32] { $.a + $.b }`,
					ast: `(>> (data (, (propdef :a ? 10) (propdef :b ? 20))) (fn @sequence (parameter ? (data (, (propdef :a typeident ?) (propdef :b typeident ?))) ?) (+ (. $ :a) (. $ :b))))`,
					out: [30],
				});
				compileError({
					p: 'Empty body in a typed block is invalid.',
					src: `main { 5 >> Int32 { } >> out }`,
					expected: 'empty',
				});
				compileError({
					p: 'A value-block like `[1, 2]` is a data block (value), not a type — cannot be a type prefix.',
					src: `main { 5 >> [1, 2] { $ } >> out }`,
					expected: 'expected type',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 3: type-prefix with return `T:R { body }`)', ({ p }) => {
		p(
			`A type-prefix block may declare an explicit return type via \`T:R\`. The body
			 (auto-emit or statement body) must produce values of type \`R\`. A return type
			 of \`Void\` means the stage consumes input as a side effect and emits nothing —
			 any downstream stage is unreachable and is a compile error.`,
			({ expr, compileError, rule }) => {
				expr({
					p: 'Explicit return type; scalar in, scalar out.',
					src: `5 >> Int32:Int32 { $ * 2 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident typeident) (* $ 2)))`,
					out: [10],
				});
				expr({
					p: 'Return type may differ from input type (transform).',
					src: `5 >> Int32:Bool { $ > 0 }`,
					ast: `(>> 5 (fn @sequence (parameter ? typeident typeident) (> $ 0)))`,
					out: [true],
				});
				rule({
					p: 'Void return: the stage consumes input as a side effect; nothing flows downstream.',
					src: `main { 5 >> Int32:Void { out($) } }`,
					ast: `(root (main (>> 5 (fn @sequence (parameter ? typeident typeident) (call :out $)))))`,
					out: [5],
				});
				rule({
					p: 'Iterated Void-stage runs body once per input value.',
					src: `main { [1, 2, 3] >> each >> Int32:Void { out($) } }`,
					ast: `(root (main (>> (data (, 1 2 3)) :each (fn @sequence (parameter ? typeident typeident) (call :out $)))))`,
					out: [1, 2, 3],
				});
				expr({
					p: 'Statement body with explicit return type; each `next` emits a value of type R.',
					src: `5 >> Int32:Int32 { next $; next $ + 1; }`,
					ast: `(>> 5 (fn (parameter ? typeident typeident) (next $) (next (+ $ 1))))`,
					out: [5, 6],
				});
				compileError({
					p: 'Body emission type must match the declared return type.',
					src: `main { 5 >> Int32:Int32 { 'oops' } >> out }`,
					expected: 'is not assignable',
				});
				compileError({
					p: 'A stage after a Void-returning stage is unreachable (Void emits nothing).',
					src: `main { 5 >> Int32:Void { out($) } >> Int32 { $ + 1 } >> out }`,
					expected: 'unreachable',
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
					p: 'Literal `true` type-prefix; matches the Bool value `true`.',
					src: `true >> :true { 1 }`,
					ast: `(>> :true (fn @sequence (parameter ? typeident ?) 1))`,
					out: [1],
				});
				expr({
					p: 'Literal `false` type-prefix; matches the Bool value `false`.',
					src: `false >> :false { 0 }`,
					ast: `(>> :false (fn @sequence (parameter ? typeident ?) 0))`,
					out: [0],
				});
				expr({
					p: 'Bool dispatch using two literal-type prefixes; pattern-match on truthy/falsy.',
					pre: `check = (n: Int32): Bool { next n > 0 }`,
					src: `check(5) >> :true { 'positive' } >> :false { 'non-positive' }`,
					ast: `(>> (call :check 5) (fn @sequence (parameter ? typeident ?) 'positive') (fn @sequence (parameter ? typeident ?) 'non-positive'))`,
					out: ['positive'],
				});
				expr({
					p: 'Literal-type guard — terminate the chain when truthy.',
					src: `loop >> :true { break }`,
					ast: `(>> loop (fn (parameter ? typeident ?) break))`,
					out: [],
				});
				expr({
					p: 'Literal string type-prefix; matches a specific string value.',
					pre: `mode = (): 'on' | 'off' { next 'on' }`,
					src: `mode() >> :'on' { 'enabled' } >> :'off' { 'disabled' }`,
					ast: `(>> (call :mode ?) (fn @sequence (parameter ? typeident ?) 'enabled') (fn @sequence (parameter ? typeident ?) 'disabled'))`,
					out: ['enabled'],
				});
				expr({
					p: 'Literal-type union; matches any listed literal value.',
					src: `0 >> :0 | false | '' { 'falsy' }`,
					ast: `(>> 0 (fn @sequence (parameter ? typeident ?) 'falsy'))`,
					out: ['falsy'],
				});
				compileError({
					p: 'Uppercase/named types use Shape 2 (`T { body }`), not `:T { body }`.',
					src: `main { 5 >> :Int32 { $ } >> out; }`,
					expected: 'use `Int32`',
				});
				compileError({
					p: 'Parens around a single anonymous slot (`(:T) { body }`) are not allowed — use `:T { body }` (literal) or `T { body }` (named).',
					src: `main { 5 >> (:Int32) { $ } >> out }`,
					expected: 'Parens',
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
					p: 'Scalar type-match: upstream Int32, pattern Int32, binds whole value.',
					src: `5 >> (n: Int32) { n + 1 }`,
					ast: `(>> 5 (fn @sequence (parameter :n typeident ?) (+ :n 1)))`,
					out: [6],
				});
				expr({
					p: 'Named-slot match on an error type: the whole error binds to `e`; access its structured fields via `e.field` (D50 — errors carry typed fields, not a string id).',
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { next n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ } >> (e: Fail) { e.code }`,
					ast: `(>> (call :risky 0) (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter :e typeident ?) (. :e :code)))`,
					out: [7],
				});
				expr({
					p: 'User-type match: Point (structural per D35). Whole Point bound to `p`.',
					pre: `type Point = [x: Int32, y: Int32]; p: Point = [x = 3, y = 4]`,
					src: `p >> (q: Point) { q.x + q.y }`,
					ast: `(>> :p (fn @sequence (parameter :q typeident ?) (+ (. :q :x) (. :q :y))))`,
					out: [7],
				});
				expr({
					p: 'Single-slot fn definition; positional call passes scalar (single-item data blocks are banned).',
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: [10],
				});
				expr({
					p: 'Named-call sugar: `double(n = 5)` works when the label matches the pattern slot. Not a data block construction; pure call-site convention.',
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(n = 5)`,
					ast: `(call :double (propdef :n ? 5))`,
					out: [10],
				});
				expr({
					p: 'Statement body required when there are statements other than `next` (e.g., a local def).',
					src: `5 >> (n: Int32) { doubled = n * 2; next doubled; next doubled + 1; }`,
					ast: `(>> 5 (fn (parameter :n typeident ?) (def :doubled ? (* :n 2)) (next :doubled) (next (+ :doubled 1))))`,
					out: [10, 11],
				});
				compileError({
					p: 'A statement body whose only statements are `next` value-expressions is reducible — the compiler requires the shorter comma form `{ X1, X2 }`.',
					src: `main { 5 >> (n: Int32) { next n; next n + 1; } >> out }`,
					expected: 'reducible',
				});
				compileError({
					p: 'Single-slot typed pattern on multi-element input: under head-rest, `n` binds the whole `[10, 20]`. Type check fails — `[Int32, Int32]` is not assignable to declared `Int32`.',
					src: `main { [10, 20] >> (n: Int32) { n } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					p: '`next` is forbidden in auto-emit body (no `;`). Use `{ n }` for auto-emit or `{ next n; }` for statement body.',
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
					p: 'Standard transform: scalar in, scalar out, types match.',
					pre: `double = (n: Int32): Int32 { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: [10],
				});
				expr({
					p: 'Different input and output types — predicate (Int → Bool).',
					pre: `isPositive = (n: Int32): Bool { n > 0 }`,
					src: `isPositive(5)`,
					ast: `(call :isPositive 5)`,
					out: [true],
				});
				expr({
					p: 'Union return type — function may fail.',
					pre: `type ParseErr = Error & [ code: Int32 ]; parseErr = (): ParseErr { [ code = 0 ] }; parseInt = (s: String): Int32 | Error { length(s) == 0 ? parseErr() : 42 }`,
					src: `parseInt('42')`,
					ast: `(call :parseInt '42')`,
					out: [42],
				});
				expr({
					p: 'Statement body required (def present). Each `next` argument must match the declared return type.',
					pre: `square = (n: Int32): Int32 { half = n / 2; next half * 2; }`,
					src: `square(6)`,
					ast: `(call :square 6)`,
					out: [6],
				});
				rule({
					p: 'Void return: side-effect sink. No downstream emission.',
					src: `print = (n: Int32): Void { out(n) }; main { 5 >> print }`,
					ast: `(root (def :print ? (fn @sequence (parameter :n typeident ?) typeident (call :out :n))) (main (>> 5 :print)))`,
					out: [5],
				});
				expr({
					p: 'Recursion — fn name is bound before its body is evaluated.',
					pre: `factorial = (n: Int32): Int32 { n <= 1 ? 1 : n * factorial(n - 1) }`,
					src: `factorial(5)`,
					ast: `(call :factorial 5)`,
					out: [120],
				});
				expr({
					p: 'Tuple return — emits one tuple value (not multi-emit).',
					pre: `pair = (n: Int32): [Int32, Int32] { [n, n + 1] }`,
					src: `pair(5) >> { $.0 + $.1 }`,
					ast: `(>> (call :pair 5) (fn @sequence (+ (. $ 0) (. $ 1))))`,
					out: [11],
				});
				expr({
					p: 'Multi-emit with explicit return type — each `next` emits a value of type R.',
					pre: `spread = (n: Int32): Int32 { half = n / 2; next half; next n - half; }`,
					src: `spread(10)`,
					ast: `(call :spread 10)`,
					out: [5, 5],
				});
				compileError({
					p: 'Body emission type must match declared return type.',
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
					p: 'Standard 2-slot positional destructure; types inferred from upstream tuple.',
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: [3],
				});
				expr({
					p: 'Typed 2-slot — each slot type is explicit; checked against upstream.',
					src: `[1, 2] >> (a: Int32, b: Int32) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a typeident ?) (parameter :b typeident ?) (+ :a :b)))`,
					out: [3],
				});
				expr({
					p: `Labeled input with matching slot names — reordered to fn's label order. Subtraction reveals the reorder.`,
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `[b = 2, a = 1] >> sub`,
					ast: `(>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :sub)`,
					out: [-1],
				});
				expr({
					p: 'Untyped destructure — types inferred per slot from upstream.',
					src: `[10, 20] >> (a, b) { a + b }`,
					ast: `(>> (data (, 10 20)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: [30],
				});
				expr({
					p: 'Fn definition with two typed slots; positional call.',
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: [3],
				});
				expr({
					p: `Named call — labels reorder to match fn's parameter labels.`,
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `sub(b = 1, a = 2)`,
					ast: `(call :sub (, (propdef :b ? 1) (propdef :a ? 2)))`,
					out: [1],
				});
				expr({
					p: 'Statement body with a local def; not reducible to comma form.',
					pre: `add3 = (a: Int32, b: Int32, c: Int32) { pair = a + b; next pair + c; }`,
					src: `add3(1, 2, 3)`,
					ast: `(call :add3 (, 1 2 3))`,
					out: [6],
				});
				expr({
					p: 'Patterns scale to any arity (3+ slots work the same way).',
					src: `[1, 2, 3] >> (a, b, c) { a + b + c }`,
					ast: `(>> (data (, 1 2 3)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (+ (+ :a :b) :c)))`,
					out: [6],
				});
				expr({
					p: 'Head-rest: the last positional slot binds the rest of the input as a sub-tuple. Here `a` = 1, `b` = `[2, 3]`; access via `b.0`, `b.1`.',
					src: `[1, 2, 3] >> (a, b) { a + b.0 + b.1 }`,
					ast: `(>> (data (, 1 2 3)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ (+ :a (. :b 0)) (. :b 1))))`,
					out: [6],
				});
				expr({
					p: 'Head-rest scales: `c` (last slot) binds the 2-element rest `[3, 4]`.',
					src: `[1, 2, 3, 4] >> (a, b, c) { a + b + c.0 + c.1 }`,
					ast: `(>> (data (, 1 2 3 4)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (+ (+ (+ :a :b) (. :c 0)) (. :c 1))))`,
					out: [10],
				});
				expr({
					p: 'D10 singleton-collapse reconciles the 2-element case: `b` binds `[2]` which collapses to `2`, so `a + b` is scalar addition.',
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn @sequence (parameter :a ? ?) (parameter :b ? ?) (+ :a :b)))`,
					out: [3],
				});
				compileError({
					p: 'Head-rest on scalar input: `5` lifts to `[5]` via D10, so `a` = 5 and `b` binds the empty rest `[]` (Void). The body `a + b` then fails — Void is not a numeric operand.',
					src: `main { 5 >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					p: 'Untyped pattern matches the rest as a tuple. Body `a + b` then fails — `b` is `[Int32, Int32]`, not a numeric. Type slots to force strict arity.',
					src: `main { [1, 2, 3] >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					p: 'Typed slot enforces strict arity: `(a: Int32, b: Int32)` requires the rest to be assignable to `Int32`. `[1, 2, 3]` makes `b` = `[Int32, Int32]`, which does not collapse to a scalar.',
					src: `main { [1, 2, 3] >> (a: Int32, b: Int32) { a + b } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					p: `Named call with labels that don't match fn's parameter names.`,
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `main { add(x = 1, y = 2) >> out }`,
					expected: 'no match',
				});
				compileError({
					p: 'Mixing positional and named args in the same call is forbidden.',
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
					p: 'Standard 2-slot transform; both inputs and output are Int32.',
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: [3],
				});
				expr({
					p: 'Predicate: 2 inputs, Bool output.',
					pre: `eq = (a: Int32, b: Int32): Bool { a == b }`,
					src: `eq(3, 3)`,
					ast: `(call :eq (, 3 3))`,
					out: [true],
				});
				expr({
					p: 'Union return — function may fail.',
					pre: `type DivErr = Error & [ code: Int32 ]; divErr = (): DivErr { [ code = 0 ] }; divide = (a: Int32, b: Int32): Int32 | Error { b == 0 ? divErr() : a / b }`,
					src: `divide(10, 2)`,
					ast: `(call :divide (, 10 2))`,
					out: [5],
				});
				expr({
					p: 'Statement body required (def present). Each `next` must match the declared return type.',
					pre: `mid = (a: Int32, b: Int32, c: Int32): Int32 { sum = a + b + c; next sum / 3; }`,
					src: `mid(2, 4, 6)`,
					ast: `(call :mid (, 2 4 6))`,
					out: [4],
				});
				expr({
					p: 'Void return: side-effect sink. No emission downstream.',
					pre: `printPair = (a: Int32, b: Int32): Void { out(a); out(b); }`,
					src: `printPair(1, 2)`,
					ast: `(call :printPair (, 1 2))`,
					out: [1, 2],
				});
				expr({
					p: 'Tuple return — emits one tuple value (not multi-emit).',
					pre: `swap = (a: Int32, b: Int32): [Int32, Int32] { [b, a] }`,
					src: `swap(1, 2) >> { $.0 - $.1 }`,
					ast: `(>> (call :swap (, 1 2)) (fn @sequence (- (. $ 0) (. $ 1))))`,
					out: [1],
				});
				expr({
					p: 'Multi-emit with explicit return type — each `next` emits a value of type R.',
					pre: `spread = (a: Int32, b: Int32): Int32 { next a; next b; }`,
					src: `spread(7, 11)`,
					ast: `(call :spread (, 7 11))`,
					out: [7, 11],
				});
				expr({
					p: 'Multi-arg recursion (Ackermann).',
					pre: `ack = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ack(m - 1, 1) : ack(m - 1, ack(m, n - 1))) }`,
					src: `ack(2, 3)`,
					ast: `(call :ack (, 2 3))`,
					out: [9],
				});
				compileError({
					p: 'Body emission type must match the declared return type.',
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
					p: 'Positional `void` substitutes the default expression.',
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(void)`,
					ast: `(call :addOne :void)`,
					out: [42],
				});
				expr({
					p: 'Positional with explicit value.',
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(5)`,
					ast: `(call :addOne 5)`,
					out: [6],
				});
				expr({
					p: 'Multi-param: all defaults via explicit `void`s.',
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(void, void)`,
					ast: `(call :pair (, :void :void))`,
					out: [3],
				});
				expr({
					p: `Mid-position \`void\` uses that slot's default.`,
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(10, void)`,
					ast: `(call :pair (, 10 :void))`,
					out: [12],
				});
				expr({
					p: 'Named call — omitted slots use their defaults (sparse-named).',
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(b = 99)`,
					ast: `(call :pair (propdef :b ? 99))`,
					out: [100],
				});
				expr({
					p: 'Named with `void` is equivalent to omitting the named arg.',
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(n = void)`,
					ast: `(call :addOne (propdef :n ? :void))`,
					out: [42],
				});
				expr({
					p: 'Default expression may reference earlier params.',
					pre: `relate = (a: Int32, b: Int32 = a + 1): Int32 { a + b }`,
					src: `relate(3, void)`,
					ast: `(call :relate (, 3 :void))`,
					out: [7],
				});
				compileError({
					p: 'Required param (no default) cannot be passed `void`.',
					pre: `f = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `main { f(void, 2) >> out }`,
					expected: 'not assignable',
				});
				compileError({
					p: 'Empty call on a 1+ param fn is a shape mismatch (no "all defaults" sugar).',
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `main { addOne() >> out }`,
					expected: 'No matching overload',
				});
			},
		);
	});

	h('Assignment', ({ ast, rule, compileError }) => {
		ast({
			p: 'Bind a name to a value with `=`. Bindings are immutable by default.',
			src: `host = 'localhost'`,
			ast: `(def :host ? 'localhost')`,
		});
		ast({
			p: 'The type is inferred from the value.',
			src: `port = 8080`,
			ast: `(def :port ? 8080)`,
		});
		ast({
			p: 'Booleans bind the same way.',
			src: `enabled = true`,
			ast: `(def :enabled ? :true)`,
		});
		ast({
			p: 'Prefix the type with `var` to declare a mutable binding. The value can be reassigned later.',
			src: `retries: var = 0`,
			ast: `(def @variable :retries ? 0)`,
		});
		rule({
			p: 'Reassigning a mutable binding uses plain `=` (no `var` modifier on reassignment).',
			src: `score: var = 0; main { score = score + 10; score >> out; }`,
			ast: `(root (def @variable :score ? 0) (main (= :score @variable (+ :score @variable 10)) (>> :score @variable :out)))`,
			out: [10],
		});
		compileError({
			p: 'Reassigning an immutable binding is a compile error.',
			src: `main { count = 1; count = 2 >> out; }`,
			expected: 'Cannot reassign immutable binding',
		});
		compileError({
			p: 'A binding must be initialized at declaration; declaration without value is a compile error.',
			src: `main { a: Int32 >> out }`,
			expected: 'declaration without value',
		});
		compileError({
			p: 'Shadowing — an inner scope cannot redeclare a name from an outer scope.',
			src: `main { x = 1; demo = { x: Int32 = 2; next x; }; demo() >> out; }`,
			expected: 'Cannot redeclare block-scoped variable',
		});
		compileError({
			p: 'A declared binding must be referenced; unused bindings are a compile error.',
			src: `main { unused = 42 >> out }`,
			expected: 'is declared but never used',
		});
	});

	h('Types', ({ expr, rule, compileError }) => {
		rule({
			p: 'Built-in integer types specify storage width: `Int8`, `Int16`, `Int32`, `Int64`, and unsigned `Uint8`–`Uint64`. There is no bare `Int` alias; precision is always explicit.',
			src: `count: Int32 = 42; main { count >> out }`,
			ast: `(root (def :count typeident 42) (main (>> :count :out)))`,
			out: [42],
		});
		rule({
			p: 'Floats: `Float32` and `Float64`. No bare `Float` alias.',
			src: `pi: Float64 = 3.14159; main { pi >> out }`,
			ast: `(root (def :pi typeident 3.14159) (main (>> :pi :out)))`,
			out: [3.14159],
		});
		rule({
			p: '`String` for text values.',
			src: `name: String = 'Alice'; main { name >> out }`,
			ast: `(root (def :name typeident 'Alice') (main (>> :name :out)))`,
			out: ['Alice'],
		});
		expr({
			p: 'A `String` is a sequence of `Uint8` bytes interpreted as UTF-8 — `String = [Uint8]` (D51). A `String` and a `[Uint8]` byte block share the same byte-buffer representation, so the `String(...)` constructor (D26) brands a byte block as text with no conversion: `String([Uint8(72), Uint8(105)])` is the string `Hi`.',
			src: `String([Uint8(72), Uint8(105)])`,
			ast: `(call typeident (data (, (call typeident 72) (call typeident 105))))`,
			out: ['Hi'],
		});
		expr({
			p: '`String([...])` concatenates byte-buffer parts (each a `String` or a `Uint8`) into one new buffer — the allocation and copy *is* the explicit construction (D52). Two strings concatenate:',
			src: `String(['foo', 'bar'])`,
			ast: `(call typeident (data (, 'foo' 'bar')))`,
			out: ['foobar'],
		});
		expr({
			p: 'A `String([...])` may mix strings and bytes; a `Uint8` part contributes its single byte. `Uint8(33)` is `!`, so this appends it:',
			src: `String(['Hi', Uint8(33)])`,
			ast: `(call typeident (data (, 'Hi' (call typeident 33))))`,
			out: ['Hi!'],
		});
		compileError({
			p: 'A `String([...])` part is a `Uint8` (one byte) or a `String` — a wider integer like `Uint16` is rejected. It is ambiguous (raw bytes vs a codepoint), and a codepoint must be UTF-8-*encoded* to its bytes, never stored raw (that would break the UTF-8 invariant). Codepoint→bytes encoding is a future explicit operation, not a constructor part; non-ASCII is written as a string literal.',
			src: `main { String([Uint16(233)]) >> out }`,
			expected: 'must be String or Uint8',
		});
		expr({
			p: 'A bare data block of `Uint8` is a byte *tuple*, not a `String` (D36/D49) — it stays addressable by position, and is branded as text only via the explicit `String(...)` constructor. Here the block keeps tuple semantics: `.1` reads the second byte.',
			src: `[Uint8(72), Uint8(105)].1`,
			ast: `(. (data (, (call typeident 72) (call typeident 105))) 1)`,
			out: [105],
		});
		compileError({
			p: 'Constructing a `String` is explicit (D52): a data block is never *implicitly* a `String`, because turning bytes into text can allocate and copy, and that work must be visible — not hidden behind a `: String` annotation. Even a contiguous all-`Uint8` block must go through the `String(...)` constructor. Only a string literal and another `String` assign to `String` directly.',
			src: `s: String = [Uint8(72), Uint8(105)]`,
			expected: 'not assignable',
		});
		rule({
			p: '`Bool` for `true`/`false` values.',
			src: `flag: Bool = true; main { flag >> out }`,
			ast: `(root (def :flag typeident :true) (main (>> :flag :out)))`,
			out: [true],
		});
		rule({
			p: 'Literal types restrict a value to specific literal constants. Use `|` to union literal types.',
			src: `mode: 'on' | 'off' = 'on'; main { mode >> out }`,
			ast: `(root (def :mode typeident 'on') (main (>> :mode :out)))`,
			out: ['on'],
		});
		compileError({
			p: 'Assigning a value outside the literal type is a compile error.',
			src: `mode: 'on' | 'off' = 'invalid'`,
			expected: 'is not assignable',
		});
		rule({
			p: 'Union types — a value can be one of several listed types.',
			src: `n: Int32 | String = 42; main { n >> out }`,
			ast: `(root (def :n typeident 42) (main (>> :n :out)))`,
			out: [42],
		});
		expr({
			p: '`is` reads the value type the checker assigned. An immutable def takes its value type, not the declared union annotation.',
			pre: `n: Int32 | String = 42; m: Int32 | String = 'hi'`,
			src: `{ n is Int32, n is String, m is Int32, m is String }`,
			ast: `(fn @sequence (, (is :n typeident) (is :n typeident) (is :m typeident) (is :m typeident)))`,
			out: [true, false, false, true],
		});
		rule({
			p: 'Union-typed parameters narrow per call site via specialization. Calling the same fn with different concrete arms compiles independent bodies; each body sees the narrowed type.',
			src: `f = (v: Int32 | String) { next(v is Int32, v is String) }; main { f(5) >> out; f('x') >> out; }`,
			ast: `(root (def :f ? (fn (parameter :v typeident ?) (next (, (is :v typeident) (is :v typeident))))) (main (>> (call :f 5) :out) (>> (call :f 'x') :out)))`,
			out: [true, false, false, true],
		});
		rule({
			p: 'A `type` declaration creates a named type alias. A bare data block coerces structurally into it (D49): the literal `[ x = 10, y = 20 ]` acquires the `Point` identity by matching its members.',
			src: `type Point = [ x: Int32, y: Int32 ]; p: Point = [ x = 10, y = 20 ]; main { p.x >> out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :p typeident (data (, (propdef :x ? 10) (propdef :y ? 20)))) (main (>> (. :p :x) :out)))`,
			out: [10],
		});
		compileError({
			p: 'Named types are nominal (D49): a type’s identity is its declaration instance, not its structure. Two distinct named types with identical members are not interchangeable — a value already typed as one (here `Celsius`, via the return type of `freezing`) never assigns to the other (`Fahrenheit`), even though both are `[ deg: Int32 ]`. The one-way coercion above only applies to a bare block that has no declared identity yet.',
			src: `type Celsius = [ deg: Int32 ]; type Fahrenheit = [ deg: Int32 ]; freezing = (): Celsius { [ deg = 0 ] }; f: Fahrenheit = freezing();`,
			expected: 'not assignable',
		});
		rule({
			p: 'Intersection types (`A & B`) combine fields of both types. A value must satisfy all members.',
			src: `type Named = [ name: String ]; type Aged = [ age: Int32 ]; type Person = Named & Aged; person: Person = [ name = 'Alice', age = 30 ]; main { person.name >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Aged (data (propdef :age typeident ?))) (type :Person (& typeident typeident)) (def :person typeident (data (, (propdef :name ? 'Alice') (propdef :age ? 30)))) (main (>> (. :person :name) :out)))`,
			out: ['Alice'],
		});
		rule({
			p: 'Composition is **subtyping**: a value of `A & B` is-a `A` and is-a `B`, so it may be used wherever either component is expected. The relation is one-way — a plain `A` is not an `A & B`. Here `Stamped` composes `Named`, so a `Stamped` value is accepted by a function taking a `Named`.',
			src: `type Named = [ name: String ]; type Stamped = Named & [ id: Int32 ]; mk = (): Stamped { [ name = 'Ada', id = 7 ] }; nameOf = (n: Named): String { n.name }; main { nameOf(mk()) >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Stamped (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn @sequence typeident (data (, (propdef :name ? 'Ada') (propdef :id ? 7))))) (def :nameOf ? (fn @sequence (parameter :n typeident ?) typeident (. :n :name))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			p: 'A chain over a union routes each value to the stage whose type it is-a — discrimination is by nominal type, with no tag written by the user. This is general, not an error feature: any union of named types dispatches the same way.',
			src: `type Point = [ x: Int32 ]; type Circle = [ r: Int32 ]; mp = (): Point { [ x = 1 ] }; mc = (): Circle { [ r = 9 ] }; shape = (n: Int32): Point | Circle { next n > 0 ? mp() : mc() }; main { shape(0 - 1) >> Point { 1 } >> Circle { 2 } >> out }`,
			ast: `(root (type :Point (data (propdef :x typeident ?))) (type :Circle (data (propdef :r typeident ?))) (def :mp ? (fn @sequence typeident (data (propdef :x ? 1)))) (def :mc ? (fn @sequence typeident (data (propdef :r ? 9)))) (def :shape ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :mp ?) (call :mc ?))))) (main (>> (call :shape (- 0 1)) (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 2) :out)))`,
			out: [2],
		});
		rule({
			p: '`Void` return type is the side-effect sink: the function consumes its input and emits nothing (D17). It is meaningful and distinct from a value return.',
			src: `log = (n: Int32): Void { out(n) }; main { 7 >> log }`,
			ast: `(root (def :log ? (fn @sequence (parameter :n typeident ?) typeident (call :out :n))) (main (>> 7 :log)))`,
			out: [7],
		});
		compileError({
			p: 'Void is the absorbing identity for unions (D40): `T | Void` equals `T`. A written `T | Void` is therefore a redundant second spelling of `T` and is a compile error (D44 — no warnings; redundancy is rejected, not flagged). Computed `T | Void` (type-level reduction, default-param typing) collapses silently; only the user-written form errors.',
			src: `emit = (n: Int32): Int32 | Void { next n }; main { emit(7) >> out }`,
			expected: 'union identity',
		});
	});

	h('Errors', ({ rule, compileError }) => {
		rule({
			p: 'An error is an ordinary nominal type that composes the standard library’s `Error` (D50): `type NotFound = Error & [ resource: String ]` is a plain `&` composition, not a special form. There is no `error` keyword and no built-in error type beyond the `Error` marker. An error’s information is its *type* and its *structured fields* — there is deliberately no string id or message, because the type itself is the identity.',
			src: `type NotFound = Error & [ resource: String ]; notFound = (r: String): NotFound { [ resource = r ] }; main { notFound('/x') >> Error { 1 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :notFound ? (fn @sequence (parameter :r typeident ?) typeident (data (propdef :resource ? :r)))) (main (>> (call :notFound '/x') (fn @sequence (parameter ? typeident ?) 1) :out)))`,
			out: [1],
		});
		rule({
			p: 'Errors are values. A function that may fail returns a union of its success type and the error type — `T | NotFound`, or the catch-all `T | Error`. The error variant is produced by an ordinary constructor call, with no exception machinery, and travels along the chain like any other value.',
			src: `type NotFound = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; lookup = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf() }; main { lookup(5) >> Int32 { $ } >> NotFound { 0 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 5) (fn @sequence (parameter ? typeident ?) $) (fn @sequence (parameter ? typeident ?) 0) :out)))`,
			out: [5],
		});
		rule({
			p: 'A chain discriminates errors by type: each typed stage `>> T { … }` consumes the variant whose type the value *is-a*, and the success variant flows to its own stage. Two error types with identical structure are told apart by nominal identity, not by shape.',
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; fb = (): Forbidden { [ resource = 'y' ] }; pick = (n: Int32): Int32 | NotFound | Forbidden { next n > 0 ? nf() : fb() }; main { pick(0 - 1) >> Int32 { 1 } >> NotFound { 2 } >> Forbidden { 3 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (type :Forbidden (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :fb ? (fn @sequence typeident (data (propdef :resource ? 'y')))) (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :nf ?) (call :fb ?))))) (main (>> (call :pick (- 0 1)) (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 2) (fn @sequence (parameter ? typeident ?) 3) :out)))`,
			out: [3],
		});
		rule({
			p: 'A `>> Error { … }` stage is a catch-all: since every error type composes `Error`, it matches *any* error variant. A chain matches the first stage a value is-a, so specific handlers must precede the `Error` catch-all.',
			src: `type NotFound = Error & [ resource: String ]; nf = (): NotFound { [ resource = 'x' ] }; lookup = (n: Int32): Int32 | NotFound { next n > 0 ? n : nf() }; main { lookup(0) >> Int32 { 1 } >> Error { 9 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn @sequence typeident (data (propdef :resource ? 'x')))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 0) (fn @sequence (parameter ? typeident ?) 1) (fn @sequence (parameter ? typeident ?) 9) :out)))`,
			out: [9],
		});
		compileError({
			p: 'Errors obey nominal identity (D49): two error types with the same fields stay distinct. A `Forbidden` is not a `NotFound`, so a value of one is never assignable to the other — the very property that lets a chain tell them apart.',
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; fb = (): Forbidden { [ resource = 'y' ] }; n: NotFound = fb();`,
			expected: 'not assignable',
		});
	});

	h('Function types', ({ p }) => {
		p(
			`Function types are written as function-value signatures *without a body* (D41). The presence of \`{ ... }\` is what distinguishes a function value from a function type. Parameter names in type position are optional — they're documentary; structural equivalence ignores them. Bare \`Fn\` (D14) remains the shorthand for "any function" when the signature is not relevant.`,
			({ expr, ast, compileError }) => {
				ast({
					p: 'Function type as a type alias — names a signature with no body.',
					src: `type BinOp = (Int32, Int32): Int32`,
					ast: `(type :BinOp (fn (parameter ? typeident ?) (parameter ? typeident ?) typeident))`,
				});
				ast({
					p: 'Parameter names in type position are optional and documentary. The two forms denote structurally equivalent types.',
					src: `type T1 = (Int32): Int32; type T2 = (a: Int32): Int32;`,
					ast: `(type :T1 (fn (parameter ? typeident ?) typeident)) (type :T2 (fn (parameter :a typeident ?) typeident))`,
				});
				expr({
					p: 'Function type as a parameter type — higher-order function. The callback `cb` is invoked inside `helper` with two scalar arguments.',
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }; helper = (cb: (Int32, Int32): Int32): Int32 { cb(5, 10) }`,
					src: `helper(add)`,
					ast: `(call :helper :add)`,
					out: [15],
				});
				compileError({
					p: 'Function values are non-capturing (D45): a returned function that references an enclosing binding (`x`) is an escaping closure and is forbidden. State is passed explicitly instead — `add(7, 10)` or threaded as pipe data.',
					pre: `makeAdder = (x: Int32): ((Int32): Int32) { (y: Int32): Int32 { x + y } }`,
					src: `main { makeAdder(7)(10) >> out }`,
					expected: 'capture',
				});
				expr({
					p: 'An inner function that does NOT reference enclosing bindings is a plain non-capturing value; returning it is allowed.',
					pre: `constFn = (): ((Int32): Int32) { (y: Int32): Int32 { y + 1 } }`,
					src: `constFn()(10)`,
					ast: `(call (call :constFn ?) 10)`,
					out: [11],
				});
				ast({
					p: 'Function type as a field type in a labeled tuple.',
					src: `type Handler = [name: String, fn: (Int32): Int32]`,
					ast: `(type :Handler (data (, (propdef :name typeident ?) (propdef :fn (fn (parameter ? typeident ?) typeident) ?))))`,
				});
				compileError({
					p: 'A function type is not a constructor — it describes a signature, not a value to construct. (Scalar and data types are callable as constructors; function types are not.)',
					pre: `type Adder = (Int32): Int32`,
					src: `main { Adder(5) >> out }`,
					expected: 'not callable',
				});
				compileError({
					p: 'The trailing `{ ... }` is the only thing distinguishing a function value from a function type. In value position a signature without a body has no body to parse — error.',
					src: `add = (a: Int32, b: Int32): Int32`,
					expected: 'Expected "{"',
				});
			},
		);
	});

	h('Generics', ({ h }) => {
		h('Generic type aliases', ({ ast, rule }) => {
			ast({
				p: 'Generic type alias with a single type parameter. `<T>` introduces the parameter; the RHS references it. (`T | Void` would be illegal per D44 — Void is the union identity — so a generic union pairs `T` with a real type like `Error`.)',
				src: `type Result<T> = T | Error`,
				ast: `(type :Result (, (parameter :T ? ?)) typeident)`,
			});
			rule({
				p: 'Generic type alias with two parameters; instantiation with concrete types and field access via positional `.N`.',
				src: `type Pair<T, U> = [T, U]; p: Pair<Int32, String> = [42, 'hi']; main { p.0 >> out }`,
				ast: `(root (type :Pair (, (parameter :T ? ?) (parameter :U ? ?)) (data (, (propdef ? typeident ?) (propdef ? typeident ?)))) (def :p typeident (data (, 42 'hi'))) (main (>> (. :p 0) :out)))`,
				out: [42],
			});
		});

		h('Generic value functions', ({ rule, expr, compileError }) => {
			rule({
				p: 'Generic value function — same `<T>` syntax at the value level. The compiler infers the type argument from each call-site value and monomorphizes per concrete type (D42). Two calls with the same arg type share one specialization.',
				src: `identity = <T>(x: T): T { x }; main { identity(42) >> out; identity(7) >> out; }`,
				ast: `(root (def :identity ? (fn @sequence (, (parameter :T ? ?)) (parameter :x typeident ?) typeident :x)) (main (>> (call :identity 42) :out) (>> (call :identity 7) :out)))`,
				out: [42, 7],
			});
			rule({
				p: 'Two type parameters — head-rest semantics applies at the type-parameter level just as at the value-parameter level (D39). Each is inferred independently from its argument.',
				src: `pick = <T, U>(a: T, b: U): T { a }; main { pick(5, 9) >> out }`,
				ast: `(root (def :pick ? (fn @sequence (, (parameter :T ? ?) (parameter :U ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident :a)) (main (>> (call :pick (, 5 9)) :out)))`,
				out: [5],
			});
			rule({
				p: 'The type argument is inferred from the call-site value; a recursive generic monomorphizes per concrete type. (Explicit call-site type arguments — `f<T>(x)` — are deferred; the leading `<` collides with the less-than operator.)',
				src: `first = <T>(a: T, b: T): T { a }; main { first(10, 20) >> out }`,
				ast: `(root (def :first ? (fn @sequence (, (parameter :T ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident :a)) (main (>> (call :first (, 10 20)) :out)))`,
				out: [10],
			});
			expr({
				p: 'A recursive generic value function reduces a data block to a single value: it destructures head/rest each level (D39), threads an accumulator, and terminates at `length(r) == 0` (D47). The argument type shrinks per level so the recursion monomorphizes to a base case. A function-valued parameter (`f`) is called directly. As a value-returning consumer it also composes as a pipe source.',
				pre: `reduce = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : reduce(r, f(acc, h), f) } }; add = (a: Int32, b: Int32): Int32 { a + b }`,
				src: `reduce([1, 2, 3], 0, add)`,
				ast: `(call :reduce (, (data (, 1 2 3)) 0 :add))`,
				out: [6],
			});
			compileError({
				p: 'A recursive generic whose recursive call does not shrink its argument toward a base case is rejected — it would never terminate.',
				pre: `loopy = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : loopy(t, f(acc, h), f) } }; add = (a: Int32, b: Int32): Int32 { a + b }`,
				src: `main { loopy([1, 2, 3], 0, add) >> out }`,
				expected: 'does not reduce',
			});
		});

		h('Type-level chain in RHS', ({ ast }) => {
			ast({
				p: 'A type definition\'s RHS may use chain expressions for structural dispatch on the input. Same `>>` and shape patterns as value-level chains (Shape 2). The destructure names `H`/`R` bind head/rest as type variables (D39) in the stage body.',
				src: `type First<T> = T >> [H, R] { H }`,
				ast: `(type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident)))`,
			});
		});

		h('Type-level chain reduction (D43 reduction engine)', ({ rule }) => {
			rule({
				p: 'Applying a type-level chain to a concrete type reduces it: `First<[Int32, String]>` evaluates the chain (head-rest binds H=Int32, R=String; body yields H) to `Int32`, so `v` accepts `42`.',
				src: `type First<T> = T >> [H, R] { H }; v: First<[Int32, String]> = 42; main { v >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :v typeident 42) (main (>> :v :out)))`,
				out: [42],
			});
			rule({
				p: 'A recursive chain reduces structurally with implicit Void termination (D40): `Each<[Int32, Bool]>` → `Int32 | Each<[Bool]>` → `Int32 | Bool | Each<Void>` → `Int32 | Bool`. `w` accepts `7` (Int32 is in the union).',
				src: `type Each<T> = T >> [H, R] { H | Each<R> }; w: Each<[Int32, Bool]> = 7; main { w >> out }`,
				ast: `(root (type :Each (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :w typeident 7) (main (>> :w :out)))`,
				out: [7],
			});
			rule({
				p: 'Reduction at monomorphization: a generic value fn whose return type applies a chain (`firstOf(t): First<T>`) reduces `First<T>` to a concrete type once `T` is bound at the call site. `firstOf([42, 99])` specializes with T=`[Int32, Int32]`, return reduces to `Int32`, body `t.0` yields 42.',
				src: `type First<T> = T >> [H, R] { H }; firstOf = <T>(t: T): First<T> { t.0 }; main { firstOf([42, 99]) >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) typeident))) (def :firstOf ? (fn @sequence (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (. :t 0))) (main (>> (call :firstOf (data (, 42 99))) :out)))`,
				out: [42],
			});
		});

		h('Recursive type definitions with implicit Void termination', ({ ast }) => {
			ast({
				p: 'Recursive type-level function using head-rest. No explicit base case — when the input is no longer destructurable as `[H, R]`, no chain stage matches and Void terminates by D40\'s implicit fall-through. D10 auto-flattens nested results.',
				src: `type Reverse<T> = T >> [H, R] { [Reverse<R>, H] }`,
				ast: `(type :Reverse (, (parameter :T ? ?)) (>> typeident (fn @sequence (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (data (, (propdef ? typeident ?) (propdef ? typeident ?))))))`,
			});
		});

		h('Constraints via unions', ({ rule, compileError }) => {
			rule({
				p: 'A type parameter constrained to a union via `:`. Each call site must pass a type assignable to the union; monomorphization per concrete chosen type.',
				src: `add = <T: Int32 | Int64>(a: T, b: T): T { a + b }; main { add(3, 4) >> out }`,
				ast: `(root (def :add ? (fn @sequence (, (parameter :T typeident ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident (+ :a :b))) (main (>> (call :add (, 3 4)) :out)))`,
				out: [7],
			});
			compileError({
				p: 'Constraint violation — the inferred type argument does not satisfy the declared constraint union.',
				pre: `numeric = <T: Int32 | Float64>(x: T): T { x }`,
				src: `main { numeric('hi') >> out }`,
				expected: 'does not satisfy constraint',
			});
		});

		h('Compile errors', ({ compileError }) => {
			compileError({
				p: 'Instantiating a generic type alias with too many type arguments is an arity error.',
				pre: `type Box<T> = [T, T]`,
				src: `b: Box<Int32, String> = [1, 2]`,
				expected: 'type argument',
			});
			compileError({
				p: 'Generic type used at an instantiation site without all required type arguments — count mismatch.',
				pre: `type Pair<T, U> = [T, U]`,
				src: `p: Pair<Int32> = [42]`,
				expected: 'type argument',
			});
		});
	});

	h('Built-in identifiers', ({ h }) => {
		h('length', ({ expr }) => {
			expr({
				p: '`length(s)` returns the character length of a string.',
				src: `length('hello')`,
				ast: `(call :length @intrinsic 'hello')`,
				out: [5],
			});
			expr({
				p: '`length(d)` returns the slot count of a data block.',
				src: `length([1, 2, 3])`,
				ast: `(call :length @intrinsic (data (, 1 2 3)))`,
				out: [3],
			});
			expr({
				p: '`length` is total: a scalar is a one-element sequence (D10: `x ≡ [x]`), so its length is 1.',
				src: `length(5)`,
				ast: `(call :length @intrinsic 5)`,
				out: [1],
			});
			expr({
				p: 'A singleton data block has length 1 (D10 collapses `[x]` to `x`).',
				src: `length([3])`,
				ast: `(call :length @intrinsic (data 3))`,
				out: [1],
			});
			expr({
				p: '`length(void)` is 0 — the empty terminal (D40). This is the canonical emptiness test for stream consumers; `length(x) == 0` replaces any `x == void`.',
				src: `length(void)`,
				ast: `(call :length @intrinsic :void)`,
				out: [0],
			});
		});
	});

	h('Modules', ({ p }) => {
		p(
			`A module is a single source file. Top-level declarations may be marked with the \`export\` modifier to expose them to other modules. The standard library is a global prelude — its symbols (\`out\`, \`each\`, \`error\`, …) are in scope unqualified, no import needed. The \`@\` operator resolves a member of an external module: \`@module.name\`.`,
			({ rule, ast }) => {
				ast({
					src: `export helper = (x: Int32) { x * 2 }`,
					ast: `(def @export :helper ? (fn @sequence (parameter :x typeident ?) (* :x 2)))`,
				});
				rule({
					p: 'Prelude symbols (here `out`) are global — used unqualified.',
					src: `main { 'data' >> out }`,
					ast: `(root (main (>> 'data' :out)))`,
				});
				ast({
					src: `main { 'data' >> @utils.process }`,
					ast: `(main (>> 'data' (. @utils :process)))`,
				});
			},
		);
	});

	h('Statement separators', ({ rule, ast, compileError }) => {
		ast({
			p: 'Statements are separated by `;`. Trailing `;` on the last statement of a block is required (no implicit terminator).',
			src: `a = 1; b = 2;`,
			ast: '(def :a ? 1) (def :b ? 2)',
		});
		rule({
			p: 'A `main` block is self-terminating — no `;` after its closing `}`. A def whose value is a lambda still requires `;` after the def itself.',
			src: `helper = (x: Int32) { x + 1 }; main { helper(1) >> out }`,
			ast: '(root (def :helper ? (fn @sequence (parameter :x typeident ?) (+ :x 1))) (main (>> (call :helper 1) :out)))',
			out: [2],
		});
		compileError({
			p: '`;` after a `main` block is a parse error.',
			src: `count = 1; main { count >> out };`,
			expected: '";" is not allowed after',
		});
		compileError({
			p: 'Missing `;` between non-block statements is a parse error.',
			src: `a = 1 b = 2`,
			expected: 'Expected ";"',
		});
		compileError({
			p: 'A `;` after a single statement is a parse error (`;` is only allowed between statements).',
			src: `a = 1;`,
			expected: '";" is not allowed after a single statement',
		});
	});

	h('Statements', ({ h }) => {
		h('loop', ({ rule }) => {
			rule({
				p: '`loop` is an infinite emitter primitive yielding successive integers (0, 1, 2, ...). Compose it with pipe stages. Use `break` to stop the chain.',
				src: `range = (n: Int32) { loop >> { $ >= n ? break : $ } }; main { range(3) >> out }`,
				ast: '(root (def :range ? (fn @sequence (parameter :n typeident ?) (>> loop (fn @sequence (? (>= $ :n) break $))))) (main (>> (call :range 3) :out)))',
				out: [0, 1, 2],
			});
			rule({
				p: 'An event-loop pattern: run a side-effecting stage forever until a condition triggers `break`.',
				src: `runUntil = (limit: Int32): Int32 { counter: var = 0; loop >> (i: Int32) { counter == limit ? break; counter = counter + 1; }; next counter; }; main { runUntil(5) >> out }`,
				ast: '(root (def :runUntil ? (fn (parameter :limit typeident ?) typeident (def @variable :counter ? 0) (>> loop (fn (parameter :i typeident ?) (? (== :counter @variable :limit) break) (= :counter @variable (+ :counter @variable 1)))) (next :counter @variable))) (main (>> (call :runUntil 5) :out)))',
				out: [5],
			});
		});
	});
});
