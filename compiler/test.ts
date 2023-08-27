import { TestApi, spec } from '@cxl/spec';
import { Flags, Program } from './index.js';
import { BaseNode, ParentNode, nodeText } from '@cxl/compiler';
import { printNode as _print } from '@cxl/compiler/debug.js';

function nodeId(node: BaseNode<string>) {
	switch (node.kind) {
		case 'string':
		case 'number':
			return nodeText(node);
		case 'ident':
			return `:${nodeText(node)}`;
		default:
			return node.kind;
	}
}

function nodeFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag].toLowerCase());
	}
	return ' ' + result.join(' ');
}

function ast(node: BaseNode<string> | ParentNode<string>): string {
	const flags = 'flags' in node ? nodeFlags(node.flags as number) : '';
	const id = nodeId(node) + flags;

	return 'children' in node && node.children?.length
		? `(${id} ${node.children.map(ast).join(' ')})`
		: id;
}

/*function verifyBounds(a: TestApi, node: BaseNode<string> | ParentNode<string>) {
	if ('children' in node) {
		const c1 = node.children?.[0];
		const c2 = node.children?.[node.children.length - 1] || c1;

		if (c1 && c2) {
			a.equal(
				node.start,
				c1.start,
				`Node ${node.kind} should begin at ${c1.start}`,
			);
			a.equal(
				node.end,
				c2.end,
				`Node ${node.kind} should end at ${c2.end}`,
			);
		}

		node.children?.forEach(n => verifyBounds(a, n));
	}
}*/

export default spec('compiler', s => {
	s.test('Parser', it => {
		const program = Program();

		function match(a: TestApi, src: string, out: string) {
			const r = program.parser.parse(src);
			if (r.errors?.length) {
				a.log(r.errors);
				throw new Error('Parsing failed');
			}
			//verifyBounds(a, r.root);
			a.equal(ast(r.root), out);
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
			match(a, '# Comment 1\n#Comment 2\nmain{}', '(root main)');
			match(a, '# Comment\nmain{}\n# Comment 2', '(root main)');
		});

		it.should('parse assignment', a => {
			match(a, "a1 = 'hello'", "(root (= :a1 'hello'))");
			match(a, 'a1 = b1', '(root (= :a1 :b1))');
			match(a, 'a = b = c', '(root (= :a (= :b :c)))');
			match(a, 'a1, a2 = b1, b2', '(root (= (, :a1 :a2) (, :b1 :b2)))');
		});

		it.should('parse variable assignment', a => {
			match(a, 'var x = 0', '(root (= @variable :x 0))');
		});

		it.should('parse ternary ? operator', a => {
			match(a, 'a = b ? c : d', '(root (= :a (? :b :c :d)))');
		});
	});

	s.test('Program', it => {
		it.should('Compile "Hello World"', a => {
			const program = Program();
			const src = `main { 'Hello World!' >> std.out }`;
			const sf = program.sourceFile(src);
			a.equal(
				ast(sf.root),
				"(root (main (>> 'Hello World!' (. :std :out))))",
			);
		});
	});
});
