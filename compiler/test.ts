import { TestApi, spec } from '@cxl/spec';
import { each, Token, ParserApi, formatError, text } from '@cxl/gbc.sdk';

import { Program } from './program.js';
import { SymbolTable } from './symbol-table.js';
import { scan } from './scanner.js';
import { Flags, Node } from './parser.js';
import { parseExpression } from './parser-expression.js';
import { RUNTIME } from './compiler.js';

function nodeId(node: Node) {
	switch (node.kind) {
		case 'string':
			return text(node);
		case 'number':
			return node.value;
		case 'ident':
			return `:${text(node)}`;
		default:
			return node.kind;
	}
}

function nodeFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag].toLowerCase());
	}
	return result.length ? ' ' + result.join(' ') : '';
}

function ast(node: Node): string {
	const flags = 'flags' in node ? nodeFlags(node.flags as number) : '';
	const id = nodeId(node) + flags;

	return 'children' in node && node.children?.length
		? `(${id} ${node.children.map(n => (n ? ast(n) : '?')).join(' ')})`
		: id;
}

export default spec('compiler', s => {
	s.test('Scanner', it => {
		function match(
			a: TestApi,
			src: string,
			...expect: Partial<Token<string>>[]
		) {
			const next = scan(src);
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

	s.test('Parser - Expressions', it => {
		const st = SymbolTable();
		const api = ParserApi(scan);
		st.setSymbols(
			{ name: 'a', kind: 'variable' },
			{ name: 'b', kind: 'variable' },
			{ name: 'c', kind: 'variable' },
			{ name: 'd', kind: 'variable' },
			{ name: 'e', kind: 'variable' },
			{ name: 'f', kind: 'variable' },
			{ name: 'scan', kind: 'function' },
			{ name: 'true', kind: 'literal' },
			{ name: 'false', kind: 'literal' },
		);
		const parse = (src: string) => {
			api.start(src);
			const scope = st.push();
			const expr = parseExpression(api, st);
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

		function match(a: TestApi, src: string, out: string) {
			const r = parse(src);
			if (r.errors?.length) {
				a.log(r.errors);
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
			match(a, '# Single Line Comment', 'root');
			match(a, '# Line Comment 1\n  # Line Comment 2', 'root');
			const c1 = match(
				a,
				'# Comment 1\n#Comment 2\na = 10',
				'(root (= :a 10))',
			);
			a.equal(c1[0].line, 2);

			const c2 = match(a, '# Comment\n123\n# Comment 2', '(root 123)');
			a.equal(c2[0].line, 1);
		});

		it.should('parse assignment', a => {
			match(a, "a = 'hello'", "(root (= :a 'hello'))");
			match(a, 'a = b', '(root (= :a :b))');
			match(a, 'a = b = c', '(root (= :a (= :b :c)))');
			match(a, 'a, b = c, d', '(root (= (, :a :b) (, :c :d)))');
			match(
				a,
				'a, b, c = d, e, f',
				'(root (= (, :a :b :c) (, :d :e :f)))',
			);
		});

		it.should('parse function assignment', a => {
			match(
				a,
				`scan = fn(a: string) { }`,
				'(root (= :scan ({ (parameter :a :string))))',
			);
			match(
				a,
				`scan = fn(:string) { }`,
				'(root (= :scan ({ (parameter ? :string))))',
			);
		});

		it.should('parse variable assignment', a => {
			match(a, 'a = 0', '(root (= :a 0))');
		});

		it.should('parse ternary ? operator', a => {
			match(a, 'a = b ? c : d', '(root (= :a (? :b :c :d)))');
		});

		it.should('parse infix operators', a => {
			match(a, 'a > 0 || b > 0', '(root (|| (> :a 0) (> :b 0)))');
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
				'(true || false) && false)',
				'(root (&& (|| :true :false) :false))',
			);
			match(
				a,
				'(10 + (10 * 2.4) / (10))',
				'(root (+ 10 (/ (* 10 2.4) 10)))',
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
		function baseline(
			testName: string,
			src: string,
			astText: string,
			output: string,
			test?: (a: TestApi, fn: Function) => void,
			extra = '',
		) {
			a.test(testName, a => {
				const program = Program();
				const sf = program.parser(src);
				if (sf.errors.length) {
					sf.errors.forEach(e => a.log(formatError(e)));
					throw 'Errors found';
				}
				a.equal(ast(sf.root), astText);
				const code = program.compileAst(sf.root);
				a.equal(code, RUNTIME + output);
				const fn = new Function(code + extra);
				test?.(a, fn);
			});
		}

		baseline(
			'bitwise',
			`main [ ~0, 1 << (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
			`(root (main (data (, -1 (<< 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))))`,
			`return [-1,1<<32-1,240|204^170&253]`,
			(a, r) => a.equalValues(r(), [-1, 1 << (32 - 1), 0xf4]),
		);

		baseline(
			'ternary',
			'main true ? 1 : 0',
			'(root (main (? :true 1 0)))',
			'return true ? 1 : 0',
			(a, r) => a.equal(r(), 1),
		);

		baseline(
			'function call',
			'a = { 123 } main a()',
			'(root (def :a ({ 123)) (main (call :a ?)))',
			'const a=()=>{return 123};return a()',
			(a, r) => a.equal(r(), 123),
		);
		baseline(
			'$ variable',
			'main 10.4 >> { $ + 2 } >> { $ * 3 }',
			'(root (main (>> (>> 10.4 ({ (+ $ 2))) ({ (* $ 3)))))',
			'return (($)=>{return $*3})((($)=>{return $+2})(10.4))',
			(a, r) => a.equal(r(), (10.4 + 2) * 3),
		);
		baseline(
			'hello world',
			`main { 'Hello World!' >> std.out }`,
			"(root (main (>> 'Hello World!' (macro :std :out))))",
			`return console.log('Hello World!')`,
		);
		/*baseline(
			'loop - 0 to 5',
			`main { loop >> { $ < 5 ? done } >> std.out }`,
			"(root (main (>> (>> :loop ({ (? (< $ 5) done))) (macro :std :out))))",
			`return console.log('Hello World!')`,
		);*/
		baseline(
			'ackermann',
			`
ackermann = fn(m: number, n:number) {
	m == 0 ? n + 1 :
		(n == 0 ? ackermann(m - 1, 1) : ackermann(m - 1, ackermann(m, n - 1)))
}
		`,
			`(root (def :ackermann ({ (parameter :m :number) (parameter :n :number) (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1))))))))))`,
			'const ackermann=(m,n)=>{return m==0 ? n+1 : n==0 ? ackermann(m-1,1) : ackermann(m-1,ackermann(m,n-1))};',
			(a, n) => {
				const ack = n();
				a.equal(ack(1, 3), 5);
				a.equal(ack(2, 3), 9);
				a.equal(ack(3, 3), 61);
				a.equal(ack(1, 5), 7);
				a.equal(ack(2, 5), 13);
				a.equal(ack(3, 5), 253);
			},
			'return ackermann;',
		);
	});
});
