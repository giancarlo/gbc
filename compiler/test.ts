import { spec } from './test-api.js';

/*

The GB programming language is a concise, type-safe, and functional programming language that
emphasizes immutability, modularity, and streamlined syntax.

## Design Constitution

Language features must avoid breaking these rules:

1. **One Way:** Restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns via syntax and types.
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
		 The pipe \`>>\` operator will call the \`@.out\` function passing its left value as an argument.
		`,
			({ rule }) => {
				rule({
					src: `main { 'Hello World' >> @.out }`,
					ast: `(root (main (>> 'Hello World' (. @ :out @external))))`,
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
		token('++', 'Increase', '++');
		token('--', 'Decrease', '--');
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
				out: [[-1, 1 << (32 - 1), 0xf4]],
			});
		});

		h('Conditional operator', ({ expr }) => {
			expr({
				p: 'The ternary operator syntax is `condition ? true_value : false_value`. The `else` part (`: false_value`) is optional. If you omit it, the expression emits a value only when the condition is truthy.',
				src: '1 > 10 ? { $ + 1 }',
				ast: '(? (> 1 10) (fn @sequence (+ $ 1)))',
			});
			expr({ src: '1 ? 2 : 3', ast: '(? 1 2 3)' });
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
			src: `0xBadFace 0xBad_Face 0x_67_7a_2f_cc_40_c6`,
			ast: '195951310 195951310 113774485586118',
		});
		expr({
			src: '72.40 072.40 2.71828',
			ast: '72.4 72.4 2.71828',
		});
		expr({
			p: 'Decimal floats accept scientific notation with `e` or `E` exponent. Underscores in exponent digits group large values.',
			src: `1.5e2 6.67428e-11 1E6 0.15e+0_2`,
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
				    Think of them like strings. The first character is the same as the individual character.`,
			src: `[ 10 ] == 10`,
			ast: `(== (data 10) 10)`,
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
			p: `Labels can appear anywhere; positions count up regardless.`,
			src: `[ 1, x = 2, 3 ]`,
			ast: `(data (, 1 (propdef :x ? 2) 3))`,
		});
		compileError({
			p: `Label names must be unique.`,
			src: `main { [ x = 1, x = 2 ] >> @.out }`,
			expected: 'Duplicate label "x"',
		});
		expr({
			p: `\`var\` is a type modifier marking a value as mutable. Annotated fields use \`name: type = value\`; the name is optional.`,
			src: `[ name: var = 'Alice', :var = 30 ]`,
			ast: `(data (, (propdef :name @variable ? 'Alice') (propdef @variable ? ? 30)))`,
		});
		expr({
			p: `\`>>\` passes data blocks through as single values. Use \`@.each\` to iterate.`,
			src: `[ 1, 2 ] >> @.each`,
			ast: `(>> (data (, 1 2)) (. @ :each))`,
			out: [1, 2],
		});
		expr({
			p: `Data blocks pass through \`>>\` as one value.`,
			pre: `sum = fn(b) { next(b.0 + b.1) }`,
			src: `[ 10, 20 ] >> sum`,
			ast: `(>> (data (, 10 20)) :sum)`,
			out: [30],
		});
		expr({
			p: `Iteration yields values only; labels are compile-time aliases and do not appear at runtime.`,
			src: `[ x = 1, y = 2 ] >> @.each`,
			ast: `(>> (data (, (propdef :x ? 1) (propdef :y ? 2))) (. @ :each))`,
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
			src: `[ [1, 2], [3, 4] ] >> @.each`,
			ast: `(>> (data (, (data (, 1 2)) (data (, 3 4)))) (. @ :each))`,
			out: [1, 2, 3, 4],
		});
	});

	h('Code Blocks', ({ expr, ast, h, compileError }) => {
		expr({
			p: `Code Blocks are defined with \`{}\`. To declare parameters, prepend the block with \`fn\`. \`fn(...) { body }\` does not auto-emit; use \`next\` to emit a value.`,
			src: `fn(a) { next a }`,
			ast: `(fn (parameter :a ? ?) (next :a))`,
		});
		expr({
			p: `Code Blocks accept a single argument. That argument can be a data block, and with \`fn\` syntax its labels are available as individual variables.`,
			src: `fn(a: Int32, b: Int32) { next a + b }`,
			ast: `(fn (parameter :a typeident ?) (parameter :b typeident ?) (next (+ :a :b)))`,
		});
		ast({
			p: `Code Blocks can accept other code blocks as parameters or return code blocks.`,
			src: `helper = fn(f: Fn) { next { f() } }`,
			ast: `(def :helper ? (fn (parameter :f typeident ?) (next (fn @sequence (call :f ?)))))`,
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
			p: `Empty \`fn() { }\` body is a compile error; use \`{ }\` for a no-op function.`,
			src: `main { fn() { } >> @.out }`,
			expected: 'Empty `fn(...) { }` body',
		});
		expr({
			p: 'The call `()` operator groups comma-separated values into a data block. `f(1, 2, 3)` passes `[1, 2, 3]` as the single argument.',
			pre: `x = { $ }`,
			src: `x(1, 2, 3)`,
			ast: `(call :x (, 1 2 3))`,
			out: [[1, 2, 3]],
		});
	 expr({
			p: 'Named arguments use `name = value`. They are matched to parameters by name regardless of order.',
			pre: `add = fn(a: Int32, b: Int32): Int32 { next a + b }`,
			src: `add(b = 1, a = 2)`,
			ast: `(call :add (, (propdef :b ? 1) (propdef :a ? 2)))`,
			out: [3],
		});
		expr({
			p: 'Parameters can declare default values. When the caller omits the slot, the default is used.',
			pre: `addOne = fn(n: Int32 = 41): Int32 { next n + 1 }`,
			src: `addOne()`,
			ast: `(call :addOne ?)`,
			out: [42],
		});

		h('Recursion', ({ rule }) => {
			rule({
				p: 'Code Blocks can call themselves recursively.',
				src: `factorial = fn(n: Int32): Int32 { next (n <= 1) ? 1 : n * factorial(n - 1) } main { factorial(0) >> @.out factorial(1) >> @.out factorial(2) >> @.out factorial(3) >> @.out factorial(4) >> @.out factorial(5) >> @.out }`,
				ast: '(root (def :factorial ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 1) 1 (* :n (call :factorial (- :n 1))))))) (main (>> (call :factorial 0) (. @ :out @external)) (>> (call :factorial 1) (. @ :out @external)) (>> (call :factorial 2) (. @ :out @external)) (>> (call :factorial 3) (. @ :out @external)) (>> (call :factorial 4) (. @ :out @external)) (>> (call :factorial 5) (. @ :out @external))))',
				out: [1, 1, 2, 6, 24, 120],
			});

			rule({
				p: 'fibonacci',
				src: `fib = fn(n: Int32): Int32 { next n <= 1 ? n : fib(n - 1) + fib(n - 2) } main { fib(0) >> @.out fib(1) >> @.out fib(2) >> @.out fib(3) >> @.out fib(4) >> @.out fib(5) >> @.out fib(6) >> @.out }`,
				ast: '(root (def :fib ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2))))))) (main (>> (call :fib 0) (. @ :out @external)) (>> (call :fib 1) (. @ :out @external)) (>> (call :fib 2) (. @ :out @external)) (>> (call :fib 3) (. @ :out @external)) (>> (call :fib 4) (. @ :out @external)) (>> (call :fib 5) (. @ :out @external)) (>> (call :fib 6) (. @ :out @external))))',
				out: [0, 1, 1, 2, 3, 5, 8],
			});

			rule({
				p: 'ackermann',
				src: `ackermann = fn(m: Int32, n: Int32): Int32 { next(m == 0 ? n + 1 : (n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1))))) } main { ackermann(1, 3) >> @.out ackermann(2, 3) >> @.out ackermann(3, 3) >> @.out ackermann(1, 5) >> @.out ackermann(2, 5) >> @.out ackermann(3, 5) >> @.out }`,
				ast: `(root (def :ackermann ? (fn (parameter :m typeident ?) (parameter :n typeident ?) typeident (next (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1)))))))))) (main (>> (call :ackermann (, 1 3)) (. @ :out @external)) (>> (call :ackermann (, 2 3)) (. @ :out @external)) (>> (call :ackermann (, 3 3)) (. @ :out @external)) (>> (call :ackermann (, 1 5)) (. @ :out @external)) (>> (call :ackermann (, 2 5)) (. @ :out @external)) (>> (call :ackermann (, 3 5)) (. @ :out @external))))`,
				out: [5, 9, 61, 7, 13, 253],
			});
		});

		h('Emitting Values', ({ expr }) => {
			expr({
				p: 'Inside a `fn(...){}` body, the `next` statement emits a value. A function can emit zero, one, or many values; `next(a, b, c)` emits each of a, b, c separately.',
				pre: `emitValues = fn() { next(1, 2, 3) done }`,
				src: `emitValues()`,
				ast: `(call :emitValues ?)`,
				out: [1, 2, 3],
			});
			expr({
				p: 'When a stage emits multiple values, each value flows downstream independently.',
				pre: `emit = fn() { next(1, 2) done }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: [2, 3],
			});
			expr({
				p: 'A stage that emits nothing causes downstream stages to receive nothing.',
				pre: `emit = fn() { done }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn @sequence (+ $ 1)))`,
				out: [],
			});
			expr({
				p: 'A stage that emits multiple values per input multiplies the sequence. Comma-separated expressions in `{}` each emit.',
				pre: `emit = fn() { next(1, 2) done }`,
				src: `emit() >> { $, $ + 10 }`,
				ast: `(>> (call :emit ?) (fn @sequence (, $ (+ $ 10))))`,
				out: [1, 11, 2, 12],
			});
		});

		h('Completion', ({ expr }) => {
			expr({
				p: 'The `done` statement inside a `fn(...){}` body terminates the function early; statements after `done` do not run.',
				pre: 'demo = fn() { next(1) done next(2) }',
				src: 'demo()',
				ast: '(call :demo ?)',
				out: [1],
			});
		});

		h('Chaining', ({ expr }) => {
			expr({
				p: 'Functions can be chained with `>>`. The pipe passes the left value into the right stage as its argument, bound to `$`.',
				pre: `
a = fn() {
	add4 = fn(a:Int32) { next a + 4 }
	times2 = fn(a:Int32) { next a * 2 }
	add4times2 = { $ >> add4 >> times2 }
	next(10 >> add4times2)
}`,
				src: `a()`,
				ast: '(call :a ?)',
				out: [28],
			});
		});
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
			ast: `(def :retries @variable ? 0)`,
		});
		rule({
			p: 'Reassigning a mutable binding uses plain `=` (no `var` modifier on reassignment).',
			src: `score: var = 0 main { score = score + 10 score >> @.out }`,
			ast: `(root (def :score @variable ? 0) (main (= :score @variable (+ :score @variable 10)) (>> :score @variable (. @ :out @external))))`,
			out: [10],
		});
		compileError({
			p: 'Reassigning an immutable binding is a compile error.',
			src: `main { count = 1 count = 2 >> @.out }`,
			expected: 'Cannot reassign immutable binding',
		});
		compileError({
			p: 'A binding must be initialized at declaration; declaration without value is a compile error.',
			src: `main { a: Int32 >> @.out }`,
			expected: 'declaration without value',
		});
		compileError({
			p: 'Shadowing — an inner scope cannot redeclare a name from an outer scope.',
			src: `main { x = 1 demo = fn() { x: Int32 = 2 next x } demo() >> @.out }`,
			expected: 'Cannot redeclare block-scoped variable',
		});
		compileError({
			p: 'A declared binding must be referenced; unused bindings are a compile error.',
			src: `main { unused = 42 >> @.out }`,
			expected: 'is declared but never used',
		});
	});

	h('Types', ({ expr, rule, compileError }) => {
		rule({
			p: 'Built-in integer types specify storage width: `Int8`, `Int16`, `Int32`, `Int64`, and unsigned `Uint8`–`Uint64`. There is no bare `Int` alias; precision is always explicit.',
			src: `count: Int32 = 42 main { count >> @.out }`,
			ast: `(root (def :count typeident 42) (main (>> :count (. @ :out @external))))`,
			out: [42],
		});
		rule({
			p: 'Floats: `Float32` and `Float64`. No bare `Float` alias.',
			src: `pi: Float64 = 3.14159 main { pi >> @.out }`,
			ast: `(root (def :pi typeident 3.14159) (main (>> :pi (. @ :out @external))))`,
			out: [3.14159],
		});
		rule({
			p: '`String` for text values.',
			src: `name: String = 'Alice' main { name >> @.out }`,
			ast: `(root (def :name typeident 'Alice') (main (>> :name (. @ :out @external))))`,
			out: ['Alice'],
		});
		rule({
			p: '`Bool` for `true`/`false` values.',
			src: `flag: Bool = true main { flag >> @.out }`,
			ast: `(root (def :flag typeident :true) (main (>> :flag (. @ :out @external))))`,
			out: [true],
		});
		rule({
			p: 'Literal types restrict a value to specific literal constants. Use `|` to union literal types.',
			src: `mode: 'on' | 'off' = 'on' main { mode >> @.out }`,
			ast: `(root (def :mode typeident 'on') (main (>> :mode (. @ :out @external))))`,
			out: ['on'],
		});
		compileError({
			p: 'Assigning a value outside the literal type is a compile error.',
			src: `mode: 'on' | 'off' = 'invalid'`,
			expected: 'is not assignable',
		});
		rule({
			p: 'Union types — a value can be one of several listed types.',
			src: `n: Int32 | String = 42 main { n >> @.out }`,
			ast: `(root (def :n typeident 42) (main (>> :n (. @ :out @external))))`,
			out: [42],
		});
		expr({
			p: '`is` reads the value type the checker assigned. An immutable def takes its value type, not the declared union annotation.',
			pre: `n: Int32 | String = 42 m: Int32 | String = 'hi'`,
			src: `{ n is Int32, n is String, m is Int32, m is String }`,
			ast: `(fn @sequence (, (is :n typeident) (is :n typeident) (is :m typeident) (is :m typeident)))`,
			out: [true, false, false, true],
		});
		rule({
			p: 'Union-typed parameters narrow per call site via specialization. Calling the same fn with different concrete arms compiles independent bodies; each body sees the narrowed type.',
			src: `f = fn(v: Int32 | String) { next(v is Int32, v is String) } main { f(5) >> @.out f('x') >> @.out }`,
			ast: `(root (def :f ? (fn (parameter :v typeident ?) (next (, (is :v typeident) (is :v typeident))))) (main (>> (call :f 5) (. @ :out @external)) (>> (call :f 'x') (. @ :out @external))))`,
			out: [true, false, false, true],
		});
		rule({
			p: 'A `type` declaration creates a named type alias.',
			src: `type Point = [ x: Int32, y: Int32 ] p: Point = [ x = 10, y = 20 ] main { p.x >> @.out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :p typeident (data (, (propdef :x ? 10) (propdef :y ? 20)))) (main (>> (. :p :x) (. @ :out @external))))`,
			out: [10],
		});
		rule({
			p: 'Intersection types (`A & B`) combine fields of both types. A value must satisfy all members.',
			src: `type Named = [ name: String ] type Aged = [ age: Int32 ] type Person = Named & Aged person: Person = [ name = 'Alice', age = 30 ] main { person.name >> @.out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Aged (data (propdef :age typeident ?))) (type :Person (& typeident typeident)) (def :person typeident (data (, (propdef :name ? 'Alice') (propdef :age ? 30)))) (main (>> (. :person :name) (. @ :out @external))))`,
			out: ['Alice'],
		});
	});

	h('Modules', ({ p }) => {
		p(
			`A module is a single source file. Top-level declarations may be marked with the \`export\` modifier to expose them to other modules. The \`@\` operator accesses module namespaces: \`@.name\` resolves a standard library symbol; \`@module.name\` resolves a member of an external module.`,
			({ rule, ast }) => {
				ast({
					src: `export helper = fn(x: Int32) { next x * 2 }`,
					ast: `(def :helper @export ? (fn (parameter :x typeident ?) (next (* :x 2))))`,
				});
				rule({
					src: `main { 'data' >> @.out }`,
					ast: `(root (main (>> 'data' (. @ :out @external))))`,
				});
				ast({
					src: `main { 'data' >> @utils.process }`,
					ast: `(main (>> 'data' (. @utils :process)))`,
				});
			},
		);
	});

	h('Statements', ({ h }) => {
		h('loop', ({ rule }) => {
			rule({
				p: '`loop` is an infinite emitter primitive yielding successive integers (0, 1, 2, ...). Compose it with pipe stages. Use `break` to stop the chain.',
				src: `range = fn(n: Int32) { next(loop >> fn(i) { i < n ? next i : break }) } main { range(3) >> @.out }`,
				ast: '(root (def :range ? (fn (parameter :n typeident ?) (next (>> loop (fn (parameter :i ? ?) (? (< :i :n) (next :i) break)))))) (main (>> (call :range 3) (. @ :out @external))))',
				out: [0, 1, 2],
			});
			rule({
				p: 'An event-loop pattern: run a side-effecting stage forever until a condition triggers `break`.',
				src: `runUntil = fn(limit: Int32): Int32 { counter: var = 0 loop >> fn(i) { counter == limit ? break counter = counter + 1 } next counter } main { runUntil(5) >> @.out }`,
				ast: '(root (def :runUntil ? (fn (parameter :limit typeident ?) typeident (def :counter @variable ? 0) (>> loop (fn (parameter :i ? ?) (? (== :counter @variable :limit) break) (= :counter @variable (+ :counter @variable 1)))) (next :counter @variable))) (main (>> (call :runUntil 5) (. @ :out @external))))',
				out: [5],
			});
		});
	});
});
