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
					ast: `(root (main (>> 'Hello World' (. @ :out))))`,
				});
			},
		);
	});

	h('Comments', ({ p }) => {
		p(
			'Comments start with the `#` character and end at the end of line.',
			({ expr, match, equal, rule }) => {
				match('# Single Line Comment', 'comment');
				expr({
					src: '# Line Comment 1\n  # Line Comment 2\n',
					ast: 'comment comment',
				});
				expr({
					src: '# Comment 1\n#Comment 2\na = 10',
					ast: 'comment comment (def :a 10)',
					test: (_, ast) => {
						equal(ast.children[0]?.line, 0);
						equal(ast.children[2]?.line, 2);
					},
				});

				rule({
					src: '# Comment\nmain { }\n# Comment 2',
					ast: '(root comment main comment)',
					test: (_, ast) => {
						equal(ast.children[1]?.line, 1);
					},
				});
			},
		);
	});

	h('Identifiers', ({ p }) => {
		p(
			'Identifiers must begin with a letter and can include alphanumeric characters or underscores.',
			({ match, throws }) => {
				match('ident', { kind: 'ident' });
				match('ident_2', { kind: 'ident' });
				match('ident_', { kind: 'ident' });

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

		h('Bitwise', ({ expr, equalValues }) => {
			expr({
				p: 'bitwise',
				src: `[ ~0, 1 <: (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
				ast: `(data (, -1 (<: 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))`,
				test: r => equalValues(r(), [[-1, 1 << (32 - 1), 0xf4]]),
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
			token('done', 'Mark the function as complete', 'done');
			token('export', 'Export module symbol', 'export');
			token('main', 'Source file entry point', 'main');
			token('next', 'Emit the next value from a function', 'next');
			token('type', 'Define a type alias or structure', 'type');
		});
	});

	/*h('Types', ({ should, parse } ) => {
		
			/*should('parse variable types', a => {
				const { scope } = parse('a: int = 100');
				a.ok(scope.a);
				a.equal(scope.a?.type?.name, 'int');
			});

		})*/

	h('Number Literals', ({ expr, match, throws }) => {
		match('42 4_2 0600 0_600', 'number', 'number', 'number', 'number');
		expr({ src: 'NaN', ast: ':NaN' });
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
	});

	h('Boolean Literals', ({ expr }) => {
		expr({ src: 'true', ast: ':true' });
		expr({ src: 'false', ast: ':false' });
	});

	h('String Literals', ({ match }) => {
		match(`'variable length \\'string\\''`, 'string');
		match(
			`'
        Multiline
        String
    '`,
			'string',
		);
		match("'${1}+${1}=${1+1}'", 'string');
	});

	h('Data Blocks', ({ expr }) => {
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
			p: `Labels can point to locations within data blocks.`,
			src: `[ label = 'string', 2 ]`,
			ast: `(data (, (propdef :label 'string') 2))`,
		});
		expr({
			p: `By default data is immutable. The 'var' type modifier can be used to specify variable fields.`,
			src: `[ :var = 'string', 2 ]`,
			ast: `(data (, (propdef :label 'string') 2))`,
		});
		expr({
			p: `Data blocks are iterable.`,
			src: `[ 1, 2 ] >> @.each >> @.out`,
			ast: `(data (, (propdef :label 'string') 2))`,
		});
	});

	h('Code Blocks', ({ expr, h }) => {
		expr({
			p: `Code Blocks are defined with \`{}\`. To declare parameters, prepend the block with \`fn\`.`,
			src: `fn(a) { a }`,
			ast: `(fn (parameter :a ?) (next :a))`,
		});
		expr({
			p: `Code Blocks accept a single argument. That argument can be a data block, and with \`fn\` syntax its labels are available as individual variables.`,
			src: `fn(a: int, b: int) { a + b }`,
			ast: `(fn (parameter :a) (parameter :b) (next (+ :a :b)))`,
		});
		expr({
			p: `Code Blocks can accept other code blocks as parameters or return code blocks.`,
			src: `fn(f: fn) { { f() } }`,
			ast: `(fn (parameter :f) (next (fn @sequence (call :f ?))))`,
		});
		expr({
			p: `The code block argument is available as \`$\`. Named arguments can be accessed with the '.' operator.`,
			src: `{ 10 + $.value }`,
			ast: `(fn @sequence (+ $ (. $ :value)))`,
		});
		expr({
			p: `One-line code blocks automatically emit the value of the single expression.`,
			src: `{ 1 + 2 }`,
			ast: `(fn (next (+ 1 2)))`,
		});
		expr({
			p: 'The call `()` operator groups comma-separated values into a data block.',
			src: `x = { $ } x(1, 2, 3)`,
			ast: `(fn (next (+ 1 2)))`,
		});
		expr({
			p: 'If named arguments are used, all arguments must include the name.',
			src: `add = fn(a: int, b: int): int { a + b } next(add(1, 2), add(b = 1, a = 2))`,
			ast: `(fn (next (+ 1 2)))`,
		});

		h('Recursion', ({ expr, equal }) => {
			expr({
				p: 'Code Blocks can call themselves recursively.',
				src: `
factorial = fn(n: int): int {
    next (n <= 1) ? 1 : n * factorial(n - 1)
}
			`,
				ast: '(root (def :factorial (fn (parameter :n typeident) typeident (? (next (<= :n 1)) 1 (* :n (call :factorial (- :n 1)))))))',
				//'const factorial=(n)=>{return(n<=1) ? 1 : n*factorial(n-1)}',
				test: factorial => {
					equal(factorial(0), 1);
					equal(factorial(1), 1);
					equal(factorial(2), 2);
					equal(factorial(3), 6);
					equal(factorial(4), 24);
					equal(factorial(5), 120);
				},
			});

			expr<(n: number) => number>({
				p: 'fibonacci',
				src: `fib = fn(n: int) => n <= 1 ? n : fib(n - 1) + fib(n - 2)`,
				ast: '(def :fib (fn @lambda (parameter :n typeident) (next (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2)))))))',
				test: fib => {
					equal(fib(0), 0);
					equal(fib(1), 1);
					equal(fib(2), 1);
					equal(fib(3), 2);
					equal(fib(4), 3);
					equal(fib(5), 5);
					equal(fib(6), 8);
				},
			});

			expr<(a: number, b: number) => number>({
				p: 'ackermann',
				src: `
ackermann = fn(m: int, n:int) {
	next(m == 0 ? n + 1 :
		(n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1)))))
}
		`,
				ast: `(def :ackermann (fn (parameter :m typeident) (parameter :n typeident) (next (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1))))))))))`,
				test: ack => {
					equal(ack(1, 3), 5);
					equal(ack(2, 3), 9);
					equal(ack(3, 3), 61);
					equal(ack(1, 5), 7);
					equal(ack(2, 5), 13);
					equal(ack(3, 5), 253);
				},
			});
		});

		h('Emitting Values', ({ expr, equalValues }) => {
			expr({
				p: 'The `next` keyword is used within a function to emit a value. A function can emit one, multiple or zero values.',
				src: `
emitValues = {
    next(1, 2, 3)
    done
}
next(emitValues())
					`,
				ast: '',
			});
			expr({
				p: 'The `next` keyword is used within a function to emit a value. A function can emit one, multiple or zero values.',
				src: `
emitValues = {
    next(1, 2, 3)
    done
}
next(emitValues())
					`,
				ast: '',
			});
			expr({
				p: 'If a stage emits multiple values, each value is passed downstream independently.',
				src: `
emit = { next(1, 2) done }
next(emit() >> { $ + 1 })
				`,
				ast: '',
				test: fn => {
					equalValues(fn(), [2, 3]);
				},
			});
			expr({
				p: 'If a stage emits nothing, downstream stages receive nothing for that path.',
				src: `
emit = { done }
next(emit() >> { $ + 1 })
				`,
				ast: '',
				test: fn => {
					equalValues(fn(), []);
				},
			});
			expr({
				p: 'The pipeline completes when all upstream emissions are consumed.',
				src: `
emit = { next(1, 2) done }
next(emit() >> { next($, $ + 10) })
				`,
				ast: '',
				test: fn => {
					equalValues(fn(), [1, 11, 2, 12]);
				},
			});
		});

		h('Chaining', ({ expr, equalValues }) => {
			expr({
				p: 'Functions can be chained to perform multiple operations in sequence. The pipe operator `>>` passes the left value into the right stage as its argument. The argument is bound to `$`.chaining',
				src: `
a = {
	add4 = fn(a:int) => a + 4 
	times2 = fn(a:int) => a * 2 
	add4times2 = { $ >> add4 >> times2 }
	next(10 >> add4times2)
}`,
				ast: '(root (def :a (fn @sequence (def :add4 (fn @lambda (parameter :a typeident) (next (+ :a 4)))) (def :times2 (fn @lambda (parameter :a typeident) (next (* :a 2)))) (def :add4times2 (fn @sequence (>> $ :add4 :times2))) (next (>> 10 :add4times2)))))',
				test: fn => {
					equalValues(fn(), [28]);
				},
			});
		});
	});

	h('Assignment', ({ expr }) => {
		expr({ src: "a = 'hello'", ast: "(def :a 'hello')" });
		expr({ src: 'a = 0', ast: '(def :a 0)' });
		expr({ src: 'a = true', ast: '(def :a :true)' });
		expr({
			src: "var a = 'hello'",
			ast: "(def :a @variable 'hello')",
		});
		expr({ src: 'var a = 1', ast: '(def :a @variable 1)' });
		expr({ src: 'a = 2', ast: '(def :a 2)' });
	});

	h('Statements', ({ h }) => {
		h('loop', ({ expr, equalValues }) => {
			expr({
				p: 'loop',
				src: `var i=0 next(loop { i++<2 } >> { i })`,
				ast: '(def :i @variable 0) (next (>> (loop (< (++ :i @variable) 2)) (fn @sequence :i @variable)))',
				test: fn => {
					equalValues(fn(), [1, 2]);
				},
			});
			expr({
				p: 'loop - 0 to 5',
				src: `var x=0 loop { x++ < 5  } >> {} next(x)`,
				ast: '(def :x @variable 0) (>> (loop (< (++ :x @variable) 5)) fn @sequence) (next :x @variable)',
				test: r => {
					equalValues(r(), [6]);
				},
			});
		});
	});
});

/*

	s.test('Parser - Expressions', it => {

		it.should('parse bigint', a => {
			match(
				a,
				'170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727',
				'(root 170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727)',
			);
		});

		it.should('parse type definition', a => {
			match(
				a,
				`
				type A [ 
					start: number,
					end: number,
					line: number,
					source: string
				]
			`,
				'(root (type :A (data ())))',
			);
		});
	});

	s.test('baselines', a => {

		baseline('main - empty', 'main{}', '(root main)', '', (a, fn) =>
			a.equal(fn, undefined),
		);

		baselineExpr(
			'value >> fn',
			'1 >> @.out',
			'(>> 1 (. @ :out))',
			'(function*(){const _=1,__=__std.out;if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [1]);
			},
		);

		baselineExpr(
			'value >> block',
			'1 >> { $ + 1 }',
			'(>> 1 (fn @sequence (+ $ 1)))',
			'(function*(){const _=1,__=function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [2]);
			},
		);

		baselineExpr(
			'value >> block(2)',
			'1 >> { $ + 1, $ + 2 }',
			'(>> 1 (fn @sequence (, (+ $ 1) (+ $ 2))))',
			'(function*(){const _=1,__=function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=$+2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [2, 3]);
			},
		);

		baselineExpr(
			'value >> block(2) >> fn',
			'1 >> { $ + 1, $ + 2 } >> @.out',
			'(>> 1 (fn @sequence (, (+ $ 1) (+ $ 2))) (. @ :out))',
			'(function*(){const _=1,__=function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=$+2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [2, 3]);
			},
		);

		baselineExpr(
			'call >> block',
			'{1,2}() >> { $ + 1 }',
			'(>> (call (fn @sequence (, 1 2)) ?) (fn @sequence (+ $ 1)))',
			'(function*(){const _=function*($){{const _$=1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}}(),__=function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [2, 3]);
			},
		);
		baselineExpr(
			'call >> block >> fn',
			'{1,2}() >> { $ + 1 } >> @.out',
			'(>> (call (fn @sequence (, 1 2)) ?) (fn @sequence (+ $ 1)) (. @ :out))',
			'(function*(){const _=function*($){{const _$=1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}}(),__=function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};if(_ instanceof Iterator)for(const _0 of _){yield* __(_0)}else yield* __(_)})()',
			(a, fn) => {
				a.equalValues(fn, [2, 3]);
			},
		);
		baselineExpr(
			'sequence',
			'{ 1, 2 }()',
			'(call (fn @sequence (, 1 2)) ?)',
			'function*($){{const _$=1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}}()',
			(a, fn) => {
				a.equalValues(fn, [1, 2]);
			},
		);

		/*
		baseline(
			'assignment - swap',
			`main {
				var a = 2
				var b = 1
				a, b = b, a
				return [a,b]
			}`,
			`(root (main (def :a @variable 2) (def :b @variable 1) (= (, :a :b) (, :b :a)) (return (data (, :a :b)))))`,
			`let a=2;let b=1;{const __0=b;const __1=a;a=__0;b=__1;}return [a,b]`,
			(a, r) => a.equalValues(r(), [1, 2]),
		);




		baseline(
			'sequence call',
			'a = { 123 } b = { a() }',
			'(root (def :a (fn @sequence 123)) (def :b (fn @sequence (call :a ?))))',
			'const a=function*($){{const _$=123;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}};const b=function*($){{const _$=a();if(_$ instanceof Iterator)(yield* _$);else (yield _$)}}',
			(a: TestApi, r) => {
				a.assert(typeof r === 'function');
				a.equalValues(r(), [123]);
			},
			';return b',
		);
		baselineError(
			'<= operator',
			'true <= -1',
			'(fn @sequence (<= :true -1))',
			[`Operator "<=" cannot be applied to types "boolean" and "int".`],
		);
		baselineError(
			'* operator',
			'fn1=fn():int => 1\nfn1() * true',
			'(fn @sequence (def :fn1 (fn @lambda typeident (next 1))) (* (call :fn1 ?) :true))',
			[`Operator "*" cannot be applied to types "int" and "boolean".`],
		);
		baselineError(
			'call - parameter check',
			'fn1=fn(a:int):int => 1\nfn1(true)',
			'(fn @sequence (def :fn1 (fn @lambda (parameter :a typeident) typeident (next 1))) (call :fn1 :true))',
			[
				`Argument of type "boolean' is not assignable to parameter of type "int".`,
			],
		);


		*/
