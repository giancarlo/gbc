import { TestApi, spec } from '@cxl/spec';
import { Node, ParserApi, parseExpression } from './parser-expression.js';
import { scan, text } from './scanner.js';

function nodeId(node: Node) {
	switch (node.kind) {
		case 'string':
		case 'number':
			return text(node);
		case 'ident':
			return `:${text(node)}`;
		default:
			return node.kind;
	}
}

function ast(node: Node): string {
	const id = nodeId(node);

	return 'children' in node && node.children?.length
		? `(${id} ${node.children.map(a => (a ? ast(a) : '?')).join(' ')})`
		: id;
}

export default spec('compiler', s => {
	s.test('Parser', it => {
		const api = ParserApi(scan);
		const parse = (source: string) => {
			api.start(source);
			const expr = parseExpression(api);
			return {
				root: {
					kind: 'root',
					start: 0,
					end: source.length,
					line: 0,
					source,
					children: api.parseUntilKind(expr, 'eof'),
				} as const,
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

		it.should('parse strings', a => {
			match(a, `'hello \\'world\\''`, `(root 'hello \\'world\\'')`);
			match(a, `'foo\nbar'`, `(root 'foo\nbar')`);
		});

		it.should('parse integers', a => {
			match(a, '42 4_2 0600 0_600', '(root 42 4_2 0600 0_600)');
		});

		it.should('parse hex number', a => {
			match(
				a,
				`0xBadFace 0xBad_Face 0x_67_7a_2f_cc_40_c6`,
				'(root 0xBadFace 0xBad_Face 0x_67_7a_2f_cc_40_c6)',
			);
		});

		it.should('parse binary number', a => {
			match(
				a,
				`0b101010110101010 0b_0001101010_101`,
				'(root 0b101010110101010 0b_0001101010_101)',
			);
		});

		it.should('parse bigint', a => {
			match(
				a,
				'170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727',
				'(root 170141183460469231731687303715884105727 170_141183_460469_231731_687303_715884_105727)',
			);
		});

		it.should('parse floats', a => {
			match(a, '72.40 072.40 2.71828', '(root 72.40 072.40 2.71828)');
		});

		it.should('parse comments', a => {
			match(a, '# Single Line Comment', 'root');
			match(a, '# Line Comment 1\n  # Line Comment 2', 'root');
			match(a, '# Comment 1\n#Comment 2\n123', '(root 123)');
			match(a, '# Comment\n123\n# Comment 2', '(root 123)');
		});

		it.should('parse assignment', a => {
			match(a, "a1 = 'hello'", "(root (= :a1 'hello'))");
			match(a, 'a1 = b1', '(root (= :a1 :b1))');
			match(a, 'a = b = c', '(root (= :a (= :b :c)))');
			match(a, 'a1, a2 = b1, b2', '(root (= (, :a1 :a2) (, :b1 :b2)))');
		});

		/*it.should('parse variable assignment', a => {
			match(a, 'var x = 0', '(root (= @variable :x 0))');
		});*/

		it.should('parse ternary ? operator', a => {
			match(a, 'a = b ? c : d', '(root (= :a (? :b :c :d)))');
		});
	});
});
