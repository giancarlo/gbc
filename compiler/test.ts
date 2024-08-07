import { TestApi, spec } from '@cxl/spec';
import { each, Token, ParserApi, formatError } from '@cxl/gbc.sdk';

import { Program } from './program.js';
import {
	Symbol,
	ProgramSymbolTable,
	TypesSymbolTable,
} from './symbol-table.js';
import { scan } from './scanner.js';
import { parseExpression } from './parser-expression.js';
import { RUNTIME } from './compiler.js';
import { ast } from './debug.js';
import { checker } from './checker.js';

export default spec('compiler', s => {
	s.test('Scanner', it => {
		function match(
			a: TestApi,
			src: string,
			...expect: Partial<Token<string>>[]
		) {
			const { next } = scan(src);
			let i = 0;
			for (const tk of each(next)) a.equalValues(tk, expect[i++]);
		}

		it.should('scan keywords', a => {
			match(a, 'main', { kind: 'main', start: 0, end: 4 });
		});

		it.should('detect errors in numbers', a => {
			a.throws(() => match(a, '0x3h 10'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '0b12'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '  12f2'), {
				position: { start: 2, end: 5 },
			});
		});
	});

	s.test('Parser - Types', it => {
		const parse = (src: string) => {
			const st = ProgramSymbolTable();
			const tt = TypesSymbolTable();
			const api = ParserApi(scan);
			api.start(src);
			const scope = st.push();
			const expr = parseExpression(api, st, tt);
			const children = api.parseUntilKind(expr, 'eof');
			const result = {
				root: {
					...api.node('root'),
					children,
				},
				scope,
				errors: api.errors,
			};
			if (result.errors.length) {
				result.errors.forEach(e => it.log(formatError(e)));
				throw 'Parsing Errors';
			}
			checker(result).run();
			if (result.errors.length) {
				it.log(result.errors);
				throw 'Checker Errors';
			}
			st.pop(scope);
			return result;
		};

		it.should('parse variable types', a => {
			const { scope } = parse('a: int = 100');
			a.ok(scope.a);
			a.equal(scope.a.type?.name, 'int');
		});
	});

	s.test('Parser - Expressions', it => {
		const parse = (src: string, symbols?: Symbol[]) => {
			const st = ProgramSymbolTable();
			const tt = TypesSymbolTable();
			if (symbols) st.setSymbols(...symbols);
			const api = ParserApi(scan);
			api.start(src);
			const scope = st.push();
			const expr = parseExpression(api, st, tt);
			st.pop(scope);
			return {
				root: {
					...api.node('root'),
					children: api.parseUntilKind(expr, 'eof'),
				},
				scope,
				errors: api.errors,
			};
		};

		function match(
			a: TestApi,
			src: string,
			out: string,
			symbols?: Symbol[],
		) {
			const r = parse(src, symbols);
			if (r.errors?.length) {
				r.errors.forEach(e => a.log(formatError(e)));
				throw new Error('Parsing failed');
			}
			a.assert(r.root);
			a.equal(ast(r.root), out);
			return r.root.children;
		}

		function matchError(a: TestApi, src: string) {
			const r = parse(src);
			a.equal(r.errors?.length, 1);
		}

		it.should('parse strings', a => {
			match(a, `'hello \\'world\\''`, `(root 'hello \\'world\\'')`);
			match(a, `'foo\nbar'`, `(root 'foo\nbar')`);
			const c1 = match(
				a,
				`\n\n'multi\nline\nstring' 'more\nlines'`,
				`(root 'multi\nline\nstring' 'more\nlines')`,
			);
			a.equal(c1[0].line, 2);
			a.equal(c1[1].line, 4);
			matchError(a, `'Unterminated String`);
		});

		it.should('parse integers', a => {
			match(a, '42 4_2 0600 0_600', '(root 42 42 600 600)');
		});

		it.should('parse hex number', a => {
			match(
				a,
				`0xBadFace 0xBad_Face 0x_67_7a_2f_cc_40_c6`,
				'(root 195951310 195951310 113774485586118)',
			);
			matchError(a, '0x');
		});

		it.should('parse binary number', a => {
			match(a, `0b101010110101010 0b_0001101010_101`, '(root 21930 853)');
			matchError(a, '0b');
		});

		/*it.should('parse bigint', a => {
			match(
				a,
				'170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727',
				'(root 170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727)',
			);
		});*/

		it.should('parse floats', a => {
			match(a, '72.40 072.40 2.71828', '(root 72.4 72.4 2.71828)');
			matchError(a, '0.');
		});

		it.should('parse comments', a => {
			match(a, '# Single Line Comment', '(root comment)');
			match(
				a,
				'# Line Comment 1\n  # Line Comment 2',
				'(root comment comment)',
			);
			const c1 = match(
				a,
				'# Comment 1\n#Comment 2\na = 10',
				'(root comment comment (def :a 10))',
			);
			a.equal(c1[0].line, 0);
			a.equal(c1[2].line, 2);

			const c2 = match(
				a,
				'# Comment\n123\n# Comment 2',
				'(root comment 123 comment)',
			);
			a.equal(c2[1].line, 1);
		});

		it.should('parse definition', a => {
			match(a, "a = 'hello'", "(root (def :a 'hello'))");
			match(a, 'a = 0', '(root (def :a 0))');
			match(a, 'a = true', '(root (def :a :true))');
			/*match(a, 'a, b = c, d', '(root (= (, :a :b) (, :c :d)))');
			match(
				a,
				'a, b, c = d, e, f',
				'(root (= (, :a :b :c) (, :d :e :f)))',
			);*/
		});
		it.should('parse var definition', a => {
			match(a, "var a = 'hello'", "(root (def :a @variable 'hello'))");
			match(a, 'var a = 1', '(root (def :a @variable 1))');
			match(a, 'a = 2', '(root (def :a 2))');
			//match(a, 'var a, var b = c, d', '(root (= (, :a :b) (, :c :d)))');
		});

		it.should('parse function assignment', a => {
			match(
				a,
				`scan = fn(a: string) { }`,
				'(root (def :scan ({ (parameter :a :string))))',
			);
			match(
				a,
				`scan = fn(:string) { }`,
				'(root (def :scan ({ (parameter ? :string))))',
			);
		});

		it.should('parse ternary ? operator', a => {
			match(a, 'a = 1 ? 2 : 3', '(root (def :a (? 1 2 3)))');
		});

		it.should('parse assignment', a => {
			match(a, 'b = 10 a = b', '(root (= :b 10) (= :a :b))', [
				{ name: 'a', kind: 'variable', flags: 0 },
				{ name: 'b', kind: 'variable', flags: 0 },
			]);
		});

		it.should('parse infix operators', a => {
			match(a, 'a > 0 || b > 0', '(root (|| (> :a 0) (> :b 0)))', [
				{ name: 'a', kind: 'variable', flags: 0 },
				{ name: 'b', kind: 'variable', flags: 0 },
			]);
			match(
				a,
				'true || false && false',
				'(root (|| :true (&& :false :false)))',
			);
			match(a, 'false || 3 == 4', '(root (|| :false (== 3 4)))');
			match(a, '10 + 5.5 * 20', '(root (+ 10 (* 5.5 20)))');
		});

		it.should('parse prefix operators', a => {
			match(a, '-10, -10_000, -10.53_3', '(root (, -10 -10000 -10.533))');
			match(a, '~0b100100, ~0xff', '(root (, -37 -256))');
			match(
				a,
				'!false, !true, !!!!false',
				'(root (, (! :false) (! :true) (! (! (! (! :false))))))',
			);
		});

		it.should('parse groups', a => {
			match(
				a,
				'(true || false) && false',
				'(root (&& (|| :true :false) :false))',
			);
			match(
				a,
				'(10 + (10 * 2.4) / (10))',
				'(root (+ 10 (/ (* 10 2.4) 10)))',
			);
		});

		it.should('parse data block', a => {
			match(
				a,
				`a = [ 'string', 2, true, 4.5 ]`,
				`(root (def :a (data (, 'string' 2 :true 4.5))))`,
			);
		});
		it.should('parse data block with label', a => {
			match(
				a,
				`b = [ label = 'string', 2 ]`,
				`(root (def :b (data (, (propdef :label 'string') 2))))`,
			);
		});

		it.test('errors', a => {
			function testError(
				src: string,
				msg: string,
				start: number,
				end: number,
			) {
				a.test(src, a => {
					const sf = parse(src);
					a.ok(sf.errors.length, 'Expected error but none received');
					const error = sf.errors[0];
					a.equal(error.message, msg);
					a.equal(error.position.start, start, 'Start position');
					a.equal(error.position.end, end, 'End position');
				});
			}

			testError(
				`(true || false) && false)`,
				'Unexpected token ")"',
				24,
				25,
			);
		});
		/*it.should('parse type definition', a => {
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
		});*/
	});

	s.test('baselines', a => {
		function parse(src: string) {
			const program = Program();
			const sf = program.parse(src);
			if (sf.errors.length) {
				sf.errors.forEach(e => a.log(formatError(e)));
				throw 'Errors found';
			}
			return [program, sf] as const;
		}
		function baseline(
			testName: string,
			src: string,
			astText: string,
			output: string,
			test?: (a: TestApi, fn: Function) => void,
			extra = '',
		) {
			a.test(testName, a => {
				const [program, sf] = parse(src);
				a.equal(ast(sf.root), astText);

				const code = program.compileAst(sf.root);
				a.equal(code.slice(RUNTIME.length), output);
				const fn = new Function(code + extra);
				test?.(a, fn);
			});
		}
		function baselineExpr(
			testName: string,
			src: string,
			astText: string,
			output: string,
			test?: (a: TestApi, fn: Function) => void,
		) {
			a.test(testName, a => {
				const mainSrc = `__main={ ${src} }`;
				const [program, sf] = parse(mainSrc);
				const first = sf.root.children[0];
				if (first.kind !== 'def') throw 'Invalid AST';
				const block = first.right;
				if (block.kind !== '{') throw 'Invalid AST';
				const expr = block.children[0];
				a.equal(ast(expr), astText);
				a.equal(expr.source.slice(expr.start, expr.end), src);
				const code = program.compileAst(expr);
				const outSrc = code.slice(RUNTIME.length);
				a.equal(outSrc, output);
				const fn = new Function(`return ${outSrc}`);
				test?.(a, fn);
			});
		}

		baseline('main - empty', 'main{}', '(root main)', '');

		baselineExpr(
			'data - label',
			`[ label='string', 2 ]`,
			`(data (, (propdef :label 'string') 2))`,
			`['string',2]`,
		);

		baselineExpr(
			'data - var label',
			`[ var label=1,2,3 ]`,
			`(data (, (propdef :label @variable 1) 2 3))`,
			`[1,2,3]`,
		);

		baselineExpr(
			'lambda - multiple emit',
			'{ $+1, $+2 }',
			'({ (, (+ $ 1) (+ $ 2)))',
			'function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=$+2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}',
			(a, fn) => {
				const iter = fn()(2);
				a.equal(iter.next().value, 3);
				a.equal(iter.next().value, 4);
			},
		);

		/*
		baselineExpr(
			'assignment - sequence',
			`a, b = 2, 1`,
			`(def (, :a :b) (, 2 1))`,
			`const a=2;const b=1;`,
		);

		baselineExpr(
			'assignment - variable assignment',
			`var a, var b = 2, 1`,
			`(def (, :a @variable :b @variable) (, 2 1))`,
			`let a=2;let b=1;`,
		);
		*/
		baselineExpr(
			'value >> fn',
			'1 >> std.out',
			'(>> 1 (macro :std :out))',
			'(function*(){const _=1;const __=function*($){console.log($);yield($)};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __(1)){yield(_1)}})()',
		);

		baselineExpr(
			'value >> block',
			'1 >> { $ + 1 }',
			'(>> 1 ({ (+ $ 1)))',
			'(function*(){const _=1;const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __(1)){yield(_1)}})()',
		);

		baselineExpr(
			'value >> block(2)',
			'1 >> { $ + 1, $ + 2 }',
			'(>> 1 ({ (, (+ $ 1) (+ $ 2))))',
			'(function*(){const _=1;const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=$+2;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __(1)){yield(_1)}})()',
		);

		baselineExpr(
			'value >> block(2) >> fn',
			'1 >> { $ + 1, $ + 2 } >> std.out',
			'(>> 1 ({ (, (+ $ 1) (+ $ 2))) (macro :std :out))',
			'(function*(){const _=1;const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=$+2;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}}else for(const _1 of __(1)){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}})()',
		);

		baselineExpr(
			'value >> block >> fn',
			'1 >> { $ + 1 } >> std.out',
			'(>> 1 ({ (+ $ 1)) (macro :std :out))',
			'(function*(){const _=1;const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}}else for(const _1 of __(1)){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}})()',
		);
		baselineExpr(
			'sequence',
			'{ 1, 2 }()',
			'(call ({ (, 1 2)) ?)',
			'function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}()',
		);
		baselineExpr(
			'call >> block',
			'{1,2}() >> { $ + 1 }',
			'(>> (call ({ (, 1 2)) ?) ({ (+ $ 1)))',
			'(function*(){const _=function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}();const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __(function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}())){yield(_1)}})()',
		);
		baselineExpr(
			'call >> block >> fn',
			'{1,2}() >> { $ + 1 } >> std.out',
			'(>> (call ({ (, 1 2)) ?) ({ (+ $ 1)) (macro :std :out))',
			'(function*(){const _=function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}();const __=function*($){{const _$=$+1;if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}}else for(const _1 of __(function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}())){for(const _2 of (function*($){console.log($);yield($)})(_1)){yield(_2)}}})()',
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
			`sequence`,
			`main {
				var i=0
				1, 2, 3 >> { i = i + $ }
			}`,
			'(root (main (def :i @variable 0) (>> (, 1 2 3) ({ (= :i (+ :i $)))) (return :i)))',
			'',
		);*/

		baselineExpr(
			'bitwise',
			`[ ~0, 1 <: (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
			`(data (, -1 (<: 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))`,
			`[-1,1<<32-1,240|204^170&253]`,
			(a, r) => a.equalValues(r(), [-1, 1 << (32 - 1), 0xf4]),
		);

		baselineExpr(
			'ternary',
			'true ? 1 : 0',
			'(? :true 1 0)',
			'true ? 1 : 0',
			(a, r) => a.equal(r(), 1),
		);

		/*baseline(
			'function call',
			'a = { 123 } main { next a() }',
			'(root (def :a ({ 123)) (main (call :a ?)))',
			'const a=()=>{return 123};return a()',
			(a, r) => a.equal(r(), 123),
		);
		baselineExpr(
			'$ variable',
			'10.4 >> { $ + 2 } >> { $ * 3 }',
			'(>> (>> 10.4 ({ (+ $ 2))) ({ (* $ 3)))',
			'return (($)=>{return $*3})((($)=>{return $+2})(10.4))',
			(a, r) => a.equal(r(), (10.4 + 2) * 3),
		);
		*/
		baselineExpr(
			'hello world',
			`'Hello World!' >> std.out`,
			"(>> 'Hello World!' (macro :std :out))",
			`(function*(){const _='Hello World!';const __=function*($){console.log($);yield($)};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __('Hello World!')){yield(_1)}})()`,
		);
		/*baseline(
			'loop',
			`main { var i=0 loop { i++<2 } >> { i } >> std.out }`,
			'',
			'',
		);
		baseline(
			'loop - 0 to 5',
			`main { var x=0 loop { x++ == 5 ? done } return x }`,
			'(root (main (def :x @variable 0) (loop ({ (? (== (++ :x) 5) done))) (return :x)))',
			`let x=0;while((()=>{return x++==5 ? done : undefined})()!==done){}return x`,
			(a, r) => a.equal(r(), 6),
		);
		*/
		baseline(
			'fibonacci',
			`fib = { $ <= 1 ? $ : fib($ - 1) + fib($ - 2) }`,
			'(root (def :fib ({ (? (<= $ 1) $ (+ (call :fib (- $ 1)) (call :fib (- $ 2)))))))',
			'const fib=function*($){{const _$=$<=1 ? $ : fib($-1)+fib($-2);if(_$ instanceof Iterator)yield*(_$);else yield _$}}',
			(a, n) => {
				const fib = n();
				a.equal(fib(0).next().value, 0);
				a.equal(fib(1).next().value, 1);
				a.equal(fib(2).next().value, 1);
				a.equal(fib(3).next().value, 2);
				a.equal(fib(4).next().value, 3);
				a.equal(fib(5).next().value, 5);
				a.equal(fib(6).next().value, 8);
			},
			';return fib',
		);

		/*baseline(
			`repeat`,
			`repeat = fn(n) { var x=0 loop >> { n-->0 ? next(x++) : done } }`,
			'',
			'',
		);
		baseline(
			`while`,
			`while = fn(condition) { loop >> { condition() ? next : done } }`,
			'',
			'',
		);*/
		baseline(
			'ackermann',
			`
ackermann = fn(m: number, n:number) {
	(m == 0 ? n + 1 :
		(n == 0 ? ackermann(m - 1, 1) : (ackermann(m, n - 1) >> { ackermann(m - 1, $) })))
}
		`,
			`(root (def :ackermann ({ (parameter :m :number) (parameter :n :number) (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (>> (call :ackermann (, :m (- :n 1))) ({ (call :ackermann (, (- :m 1) $)))))))))`,
			'const ackermann=function*(m,n){{const _$=m===0 ? n+1 : n===0 ? ackermann(m-1,1) : (function*(){const _=ackermann(m,n-1);const __=function*($){{const _$=ackermann(m-1,$);if(_$ instanceof Iterator)yield*(_$);else yield _$}};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __(ackermann(m,n-1))){yield(_1)}})();if(_$ instanceof Iterator)yield*(_$);else yield _$}}',
			(a, n) => {
				const ack = n();
				a.equal(ack(1, 3).next().value, 5);
				a.equal(ack(2, 3).next().value, 9);
				a.equal(ack(3, 3).next().value, 61);
				a.equal(ack(1, 5).next().value, 7);
				a.equal(ack(2, 5).next().value, 13);
				a.equal(ack(3, 5).next().value, 253);
			},
			';return ackermann;',
		);
	});
});
