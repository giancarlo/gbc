import { spec } from '@cxl/spec';
import { highlight as createHighlight, type HighlightToken } from './highlight.js';
import { scanner } from './index.js';

const highlight = createHighlight();
const sourceOf = (value: string, id = {}, version = 1) => ({ id, version, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value });

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}

export default spec('xml', a => {
	a.test('uses SDK categories and source positions', a => {
		const value = '<ns:root xml:lang="en">\n<item.name _id=\'x\'/>text</ns:root>';
		const tokens = [...highlight.resume({ source: sourceOf(value) })];
		a.equalValues(tokens.map(token => token.highlight), [
			'punctuation', 'tag', 'attribute', 'operator', 'string', 'punctuation',
			'punctuation', 'tag', 'attribute', 'operator', 'string', 'punctuation', 'punctuation',
			'text', 'punctuation', 'punctuation', 'tag', 'punctuation',
		]);
		a.equalValues(tokens.filter(token => token.highlight === 'tag').map(token => value.slice(token.start, token.end)), ['ns:root', 'item.name', 'ns:root']);
		for (const token of tokens) {
			a.equal(token.source, value);
			a.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
		}
		a.equalValues([...highlight.resume({ source: sourceOf('') })], []);
	});

	a.test('folds explicit XML elements without HTML rules', a => {
		const cases: [string, [number, number][]][] = [
			['<br><li><li></li></li></br>', [[1, 0], [1, 0], [1, 0], [0, 1], [0, 1], [0, 1]]],
			['<Root></root></Root>', [[1, 0], [0, 1]]],
			['<p><p>', [[1, 0], [1, 0]]],
			['<root><item/><br /></root>', [[1, 0], [0, 1]]],
			['<!-- a\nb --><![CDATA[a\n<b>]]>', [[1, 1], [1, 1]]],
		];
		for (const [value, expected] of cases)
			a.equalValues([...highlight.resume({ source: sourceOf(value) })].filter(token => token.foldStart || token.foldEnd).map(token => [token.foldStart, token.foldEnd]), expected);
	});

	a.test('keeps declarations, processing instructions and CDATA opaque', a => {
		for (const [value, kind] of [
			['<?xml version="1.0"?>', 'directive'],
			['<?target a > b <tag> " ?>', 'directive'],
			['<!DOCTYPE root [<!ELEMENT root (#PCDATA)><!ENTITY x ">">]>', 'directive'],
			['<![CDATA[<tag attr="x"> / = >]]>', 'string'],
			['<!-- <tag> -->', 'comment'],
		] as const) {
			const tokens = [...highlight.resume({ source: sourceOf(value + '<root/>') })];
			a.equal(tokens[0]?.highlight, kind);
			a.equal(tokens[0]?.start, 0);
			a.equal(tokens[0]?.end, value.length);
			a.equalValues(tokens.filter(token => token.highlight === 'tag').map(token => token.source.slice(token.start, token.end)), ['root']);
			a.equal(tokens.some(token => token.foldStart || token.foldEnd), false);
		}
	});

	a.test('treats XML quotes and text literally', a => {
		const value = '<_root attr="path\\">" / = > &amp;\n</_root>';
		const tokens = [...highlight.resume({ source: sourceOf(value) })];
		a.equalValues(tokens.filter(token => token.highlight === 'string').map(token => value.slice(token.start, token.end)), ['"path\\"']);
		a.equalValues(tokens.filter(token => token.highlight === 'text').map(token => value.slice(token.start, token.end)), ['" / = > &amp;\n']);
		const s = scanner('<élément attr.name="value"/>');
		const tag = s.next();
		const name = s.next();
		s.backtrack(name);
		a.equal(tag.kind, 'openTag');
		a.equalValues(s.next(), name);
		a.equal(s.next().kind, 'attrName');
	});

	a.test('preserves checkpoints through incomplete and edited markup', a => {
		for (const value of [
			'<?xml version="1.0"?><root><!-- a\nb --><![CDATA[<x>\n]]><br></br></root>',
			'<!DOCTYPE root [<!ELEMENT root (#PCDATA)>]><root/>',
			'<?target data > " <x> ?>tail',
			'<root attr="path\\">" / > =</root>',
			'<root', '<root attr="unfinished', '<![CDATA[<x>', '<?xml version=', '<!-- unfinished', '<!DOCTYPE root [',
		]) {
			const source = sourceOf(value);
			const expected = [...highlight.resume({ source })];
			let result = drain(highlight.resume({ source, end: 0 }));
			const tokens: HighlightToken[] = [...result.tokens];
			for (let end = 1; end <= value.length; end++) {
				result = drain(highlight.resume({ source, end }, result.checkpoint));
				tokens.push(...result.tokens);
			}
			a.equalValues(tokens, expected);
			a.equal(result.checkpoint.done, true);
			a.equal(result.checkpoint.committed, value.length);
			for (let end = 0; end < value.length; end++) {
				const prefix = drain(highlight.resume({ source, end }));
				const snapshot = JSON.stringify(prefix.tokens);
				const suffix = drain(highlight.resume({ source }, prefix.checkpoint));
				a.equalValues([...prefix.tokens, ...suffix.tokens], expected);
				a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens, suffix.tokens);
				a.equal(JSON.stringify(prefix.tokens), snapshot);
				const edited = sourceOf(value.slice(0, end) + '<next/>', source.id, 2);
				const rest = drain(highlight.resume({ source: edited, edit: { previousVersion: 1, start: end } }, prefix.checkpoint));
				a.equalValues([...prefix.tokens, ...rest.tokens].map(({ source, ...token }) => token), [...highlight.resume({ source: edited })].map(({ source, ...token }) => token));
			}
		}
	});
});
