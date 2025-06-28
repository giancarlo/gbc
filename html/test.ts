import { TestApi, spec } from '@cxl/spec';
import { scanner } from './index.js';

export default spec('html', (a: TestApi) => {
	a.test('scanner.next() basic token.kinds', it => {
		it.test('should return eof on empty input', a => {
			const s = scanner('');
			const result = s.next();
			a.equal(result.kind, 'eof');
		});

		it.test('should recognize open and close HTML tags', a => {
			const s = scanner('<div></div>');
			a.equal(s.next().kind, 'openTag', 'should find openTag: <');
			a.equal(s.next().kind, 'tagName', 'should find tagName: div');
			a.equal(s.next().kind, 'gt', 'should find gt: >');
			a.equal(s.next().kind, 'openTag', 'should find openTag: <');
			a.equal(s.next().kind, 'slash', 'should find slash: /');
			a.equal(s.next().kind, 'tagName', 'should find tagName: div');
			a.equal(s.next().kind, 'gt', 'should find gt: >');
			a.equal(s.next().kind, 'eof', 'should find end of input');
		});

		it.test('should parse comment blocks', a => {
			const s = scanner('<!-- comment -->');
			const token = s.next();
			a.equal(token.kind, 'comment');
			a.equal(token.end, 15, 'should consume full comment');
			a.equal(s.next().kind, 'eof', 'should find eof after comment');
		});

		it.test(
			'should parse unterminated comment as comment token to end',
			a => {
				const s = scanner('<!-- not closed');
				const token = s.next();
				a.equal(token.kind, 'comment');
				a.equal(token.end, 16, 'should consume to input end');
				a.equal(s.next().kind, 'eof', 'should find eof after comment');
			},
		);

		it.test('should recognize tag and attribute names', a => {
			const s = scanner('<tag attr=');
			a.equal(s.next().kind, 'openTag');
			a.equal(s.next().kind, 'tagName');
			a.equal(s.next().kind, 'attrName');
			a.equal(s.next().kind, 'equals');
		});

		it.test('should tokenize strings with double and single quotes', a => {
			const s1 = scanner('"foo"');
			const tok1 = s1.next();
			a.equal(tok1.kind, 'string');
			a.equal(tok1.end, 5, 'should include quotes');

			const s2 = scanner("'bar'");
			const tok2 = s2.next();
			a.equal(tok2.kind, 'string');
			a.equal(tok2.end, 5);

			const s3 = scanner('"with \\" quote"');
			const tok3 = s3.next();
			a.equal(tok3.kind, 'string');
			a.equal(tok3.end, 14, 'should handle escaped quotes');
		});

		it.test('should parse plain text between tags', a => {
			const s = scanner('Hello <b>world</b>');
			const t1 = s.next();
			a.equal(t1.kind, 'text');
			a.equal(t1.end, 6, "Should have length until '<'");
			a.equal(s.next().kind, 'openTag');
			a.equal(s.next().kind, 'tagName');
			a.equal(s.next().kind, 'gt');
		});

		it.test('should recognize special characters: slash and equals', a => {
			const s = scanner('/=');
			a.equal(s.next().kind, 'slash');
			a.equal(s.next().kind, 'equals');
		});

		it.test(
			'should handle mix of tags, attributes, and string values',
			a => {
				const s = scanner('<input.kind="text" disabled>');
				// < input.kind = "text" disabled >
				a.equal(s.next().kind, 'openTag'); // <
				a.equal(s.next().kind, 'tagName'); // input
				a.equal(s.next().kind, 'attrName'); //.kind
				a.equal(s.next().kind, 'equals'); // =
				a.equal(s.next().kind, 'string'); // "text"
				a.equal(s.next().kind, 'attrName'); // disabled
				a.equal(s.next().kind, 'gt'); // >
			},
		);
	});

	a.test('scanner.next() negative and error-prone input cases', () => {
		a.test('should treat unknown characters as text', a => {
			const s = scanner('?!@');
			const t = s.next();
			a.equal(t.kind, 'text');
			a.equal(t.end, 3, 'Unknown characters are lumped as text');
		});

		a.test(
			'should handle tag name starting in the middle of text as text',
			a => {
				const s = scanner('fooBar');
				const t = s.next();
				a.equal(t.kind, 'text', 'Letters not after < or / or space');
				a.equal(t.end, 6);
			},
		);

		a.test('should treat lone > as gt', a => {
			const s = scanner('>');
			const t = s.next();
			a.equal(t.kind, 'gt');
		});

		a.test('should allow backtrack to previous state', a => {
			const s = scanner('<foo>');
			s.next(); // <
			const t2 = s.next(); // foo
			s.backtrack(t2);
			const t2b = s.next();
			a.equal(
				t2.kind,
				t2b.kind,
				'Type after backtrack should be same as before',
			);
			a.equal(t2.end, t2b.end, 'Length after backtrack should match');
		});
	});

	a.test('should tokenize attribute-like text after whitespace', a => {
		const s = scanner('<div attr1 attr2="val">');
		a.equal(s.next().kind, 'openTag');
		a.equal(s.next().kind, 'tagName');
		a.equal(s.next().kind, 'attrName', 'attr1');
		a.equal(s.next().kind, 'attrName', 'attr2');
		a.equal(s.next().kind, 'equals');
		a.equal(s.next().kind, 'string');
		a.equal(s.next().kind, 'gt');
	});
});
