import { TestApi, spec } from '@cxl/spec';
import {
	CompilerError,
	each,
	Token,
	ParserApi,
	formatError,
} from '../sdk/index.js';

import { Program } from './program.js';
import {
	Symbol,
	ProgramSymbolTable,
	TypesSymbolTable,
} from './symbol-table.js';
import { scan } from './scanner.js';
import { parseExpression } from './parser-expression.js';
import { parseType } from './parser-type.js';
import { RUNTIME } from './compiler.js';
import { ast } from './debug.js';
import { checker } from './checker.js';
import type { Node } from './node.js';

export default spec('compiler', s => {
	s.test('Scanner', it => {
		function match(
			a: TestApi,
			src: string,
			...expect: Partial<Token<string>>[]
		) {
			const { next } = scan(src);
			let i = 0;
			for (const tk of each(next)) a.equalPartial(tk, expect[i++]);
		}

		it.should('scan keywords', a => {
			match(a, 'main', { kind: 'main', start: 0, end: 4 });
		});

		/*it.should('detect errors in numbers', a => {
			a.throws(() => match(a, '0x3h 10'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '0b12'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '  12f2'), {
				position: { start: 2, end: 5 },
			});
		});*/
	});

	s.test('Parser - Types', it => {
		const parse = (src: string) => {
			const st = ProgramSymbolTable();
			const tt = TypesSymbolTable();
			const api = ParserApi(scan);
			api.start(src);
			const scope = st.push();
			const typeParser = parseType(api, tt);
			const expr = parseExpression(api, st, typeParser);
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
		const parse = (src: string, symbols?: Record<string, Symbol>) => {
			const st = ProgramSymbolTable();
			const tt = TypesSymbolTable();
			if (symbols) st.setSymbols(symbols);
			const api = ParserApi(scan);
			api.start(src);
			const scope = st.push();
			const typeParser = parseType(api, tt);
			const expr = parseExpression(api, st, typeParser);
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
			symbols?: Record<string, Symbol>,
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
				'(root (def :scan (fn (parameter :a typeident))))',
			);
			/*match(
				a,
				`scan = fn(:string) { }`,
				'(root (def :scan ({ (parameter ? :string))))',
			);*/
		});

		it.should('parse ternary ? operator', a => {
			match(a, 'a = 1 ? 2 : 3', '(root (def :a (? 1 2 3)))');
		});

		it.should('parse assignment', a => {
			match(a, 'b = 10 a = b', '(root (= :b 10) (= :a :b))', {
				a: { name: 'a', kind: 'variable', flags: 0 },
				b: { name: 'b', kind: 'variable', flags: 0 },
			});
		});

		it.should('parse infix operators', a => {
			match(a, 'a > 0 || b > 0', '(root (|| (> :a 0) (> :b 0)))', {
				a: { name: 'a', kind: 'variable', flags: 0 },
				b: { name: 'b', kind: 'variable', flags: 0 },
			});
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
		/*it.should('parse data block with label', a => {
			match(
				a,
				`b = [ label = 'string', 2 ]`,
				`(root (def :b (data (, (propdef :label 'string') 2))))`,
			);
		});*/

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
		function printErrors(errors: CompilerError[]) {
			errors.forEach(e => a.log(formatError(e)));
		}
		function parse(src: string) {
			const program = Program();
			const result = program.compile(src);
			if (result.errors.length) {
				printErrors(result.errors);
				throw 'Errors found';
			}
			return { ...result, program };
		}
		function baseline<T>(
			testName: string,
			src: string,
			astText: string,
			output: string,
			test?: (a: TestApi, fn: T) => void,
			extra = '',
		) {
			a.test(testName, a => {
				const { ast: rootAst, output: code } = parse(src);
				a.equal(ast(rootAst), astText);
				a.equal(code.slice(RUNTIME.length), output);
				const fn = new Function(code + extra);
				test?.(a, fn());
			});
		}

		function validateExpr(first: Node) {
			if (first.kind !== 'def') return;
			const block = first.right;
			if (block.kind !== 'fn') return;
			return block;
		}

		function baselineExpr<T = unknown>(
			testName: string,
			src: string,
			astText: string,
			output: string,
			test?: (a: TestApi, fn: T) => void,
		) {
			a.test(testName, a => {
				const mainSrc = `__main={ ${src} }`;
				const { ast: rootAst, program } = parse(mainSrc);
				const expr = validateExpr(rootAst.children[0])?.children[0];
				if (!expr) throw 'Invalid AST';
				a.equal(ast(expr), astText);
				a.equal(expr.source.slice(expr.start, expr.end), src);
				const code = program.compileAst(expr);
				const outSrc = code.slice(RUNTIME.length);
				a.equal(outSrc, output);
				const fn = new Function(`return ${outSrc}`);
				test?.(a, fn());
			});
		}

		function baselineError(
			testName: string,
			src: string,
			astText: string,
			errors: string[],
		) {
			a.test(testName, a => {
				const program = Program();
				const out = program.compile(`__main={ ${src} }`);
				const expr = validateExpr(out.ast.children[0]);
				if (!expr?.children?.length) {
					printErrors(out.errors);
					throw 'Invalid AST';
				}
				a.equal(ast(expr), astText);
				a.equalValues(
					out.errors.map(e => e.message),
					errors,
				);
			});
		}

		baseline('main - empty', 'main{}', '(root main)', '');

		/*baselineExpr(
			'data - label',
			`[ label:'string', 2 ]`,
			`(data (, (propdef :label 'string') 2))`,
			`['string',2]`,
		);

		baselineExpr(
			'data - var label',
			`[ var label=1,2,3 ]`,
			`(data (, (propdef :label @variable 1) 2 3))`,
			`[1,2,3]`,
		);*/

		/*
		baselineExpr<(n: number) => Iterator<number>>(
			'lambda - multiple emit',
			'{ $+1, $+2 }',
			'({ (, (+ $ 1) (+ $ 2)))',
			'function*($){{const _$=$+1;if(_$ instanceof Iterator)(yield* _$);else (yield _$)};{const _$=$+2;if(_$ instanceof Iterator)(yield* _$);else (yield _$)}}',
			(a, fn) => {
				const iter = fn(2);
				a.equal(iter.next().value, 3);
				a.equal(iter.next().value, 4);
			},
		);

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
			'1 >> @.out',
			'(>> 1 (. @ :out))',
			'__std.out(1)',
		);

		/*
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
		baselineExpr(
			'sequence',
			'{ 1, 2 }()',
			'(call ({ (, 1 2)) ?)',
			'function*($){{const _$=1;if(_$ instanceof Iterator)yield*(_$);else yield _$};{const _$=2;if(_$ instanceof Iterator)yield*(_$);else yield _$}}()',
		);

		*/

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
			(a, r) => a.equalValues(r, [-1, 1 << (32 - 1), 0xf4]),
		);

		baselineExpr(
			'ternary',
			'true ? 1 : 0',
			'(? :true 1 0)',
			'true ? 1 : 0',
			(a, r) => a.equal(r, 1),
		);

		/*
		baseline(
			'function call',
			'a = { 123 } main { a() }',
			'(root (def :a ({ 123)) (main (call :a ?)))',
			'const a=()=>{return 123};return a()',
			(a, r) => a.equal(r(), 123),
			'return a'
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
			`'Hello World!' >> @.out`,
			"(>> 'Hello World!' (. @ :out))",
			`(function*(){const _='Hello World!';const __=function*($){__std.out($);yield($)};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){yield(_1)}}else for(const _1 of __('Hello World!')){yield(_1)}})()`,
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
		baseline<(n: number) => number>(
			'fibonacci',
			`fib = fn(n: int) => n <= 1 ? n : fib(n - 1) + fib(n - 2)`,
			'(root (def :fib (fn (parameter :n typeident) (next (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2))))))))',
			'const fib=(n)=>(n<=1 ? n : fib(n-1)+fib(n-2))',
			(a, fib) => {
				a.equal(fib(0), 0);
				a.equal(fib(1), 1);
				a.equal(fib(2), 1);
				a.equal(fib(3), 2);
				a.equal(fib(4), 3);
				a.equal(fib(5), 5);
				a.equal(fib(6), 8);
			},
			';return fib',
		);

		baseline<(n: number) => number>(
			'factorial',
			`
factorial = fn(n: int): int {
    next (n <= 1) ? 1 : n * factorial(n - 1)
}
			`,
			'(root (def :factorial (fn (parameter :n typeident) typeident (? (next (<= :n 1)) 1 (* :n (call :factorial (- :n 1)))))))',
			'const factorial=(n)=>{return(n<=1) ? 1 : n*factorial(n-1)}',
			(a, factorial) => {
				a.equal(factorial(0), 1);
				a.equal(factorial(1), 1);
				a.equal(factorial(2), 2);
				a.equal(factorial(3), 6);
				a.equal(factorial(4), 24);
				a.equal(factorial(5), 120);
			},
			';return factorial',
		);
		baseline<(a: number, b: number) => number>(
			'ackermann',
			`
ackermann = fn(m: int, n:int) {
	next(m == 0 ? n + 1 :
		(n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1)))))
}
		`,
			`(root (def :ackermann (fn (parameter :m typeident) (parameter :n typeident) (next (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1)))))))))))`,
			'const ackermann=(m,n)=>{return(m===0 ? n+1 : n===0 ? ackermann(m-1,1) : ackermann(m-1,ackermann(m,n-1)))}',
			(a, ack) => {
				a.equal(ack(1, 3), 5);
				a.equal(ack(2, 3), 9);
				a.equal(ack(3, 3), 61);
				a.equal(ack(1, 5), 7);
				a.equal(ack(2, 5), 13);
				a.equal(ack(3, 5), 253);
			},
			';return ackermann;',
		);
		/*baseline(
			'build',
			`
@cxl.build import buildCxl, tsBundle, minify;

buildCxl([
	target = 'package',
	outputDir = '../dist/compiler',
	tasks = [ tsBundle('tsconfig.json', 'index.bundle.js', true).pipe(minify()) ]
])
		`,
			'',
			'',
		);*/

		baselineError('<= operator', 'true <= -1', '(fn (<= :true -1))', [
			`Operator "<=" cannot be applied to types "boolean" and "int".`,
		]);
		baselineError(
			'* operator',
			'fn1=fn():int => 1\nfn1() * true',
			'(fn (def :fn1 (fn typeident (next 1))) (* (call :fn1 ?) :true))',
			[`Operator "*" cannot be applied to types "int" and "boolean".`],
		);
		baselineError(
			'call - parameter check',
			'fn1=fn(a:int):int => 1\nfn1(true)',
			'(fn (def :fn1 (fn (parameter :a typeident) typeident (next 1))) (call :fn1 :true))',
			[
				`Argument of type "boolean' is not assignable to parameter of type "int".`,
			],
		);

		/*

		baseline(
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
		);
		*/
	});
});
