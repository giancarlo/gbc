import { highlight } from './highlight.js';
import { TestApi, spec } from '@cxl/spec';
import { scanner } from './index.js';

const benchmarkSource = (`<ul><li>${'<div>'.repeat(100)}${'</div>'.repeat(100)}</ul>`).repeat(5);

export default spec('html', (a: TestApi) => {
	a.test('retains native context and stable folds across checkpoint windows', a => {
		const value = '<ul>\n<li>a\n<li>b\n</ul><p>text<div>next</div>';
		const source = highlightSource(value);
		const expected = drain(highlight.resume({ source })).tokens;
		const prefix = drain(highlight.resume({ source, end: Math.floor(value.length / 2) }));
		const snapshot = JSON.stringify(prefix.tokens);
		const suffix = drain(highlight.resume({ source }, prefix.checkpoint));
		a.equalValues([...prefix.tokens, ...suffix.tokens], expected);
		a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens, suffix.tokens);
		a.equal(JSON.stringify(prefix.tokens), snapshot);
		let result = drain(highlight.resume({ source, end: 0 }));
		const tokens = [...result.tokens];
		for (let end = 1; end <= value.length; end++) {
			result = drain(highlight.resume({ source, end }, result.checkpoint));
			tokens.push(...result.tokens);
		}
		a.equalValues(tokens, expected);
		a.equal(result.checkpoint.committed, value.length);
		a.equal(result.checkpoint.done, true);
	});

	a.should('highlight deeply nested markup', a => a.benchmark(() => [...highlight.resume({ source: highlightSource(benchmarkSource) })].length, {
		warmup: 50,
		sampleTime: 20,
		samples: 10,
		maxRegression: 15,
	}));
	a.test('public highlighting contract', it => {
		it.test('closes each list item before opening its sibling', a => {
			const starts: number[] = [];
			const regions: [number, number][] = [];
			for (const token of highlight.resume({ source: highlightSource('<ul>\n<li>a\n<li>b\n</ul>') })) {
				for (let i = 0; i < token.foldStart; i++) starts.push(token.line);
				for (let i = 0; i < token.foldEnd; i++) regions.push([starts.pop() ?? -1, token.line]);
			}
			a.equalValues(regions, [[1, 2], [2, 3], [0, 3]]);
			a.equalValues(starts, []);
		});
		it.test('marks fold boundaries without folding literal delimiters', a => {
			const cases: [string, [string, number, number][]][] = [
				[
					'<DIV title=">">\n<span>text</span><br><img/><custom />\n</DIV>',
					[
						['>', 1, 0],
						['>', 1, 0],
						['>', 0, 1],
						['>', 0, 1],
					],
				],
				['<!-- a\nb -->', [['<!-- a\nb -->', 1, 1]]],
				['<div', []],
				['<!DOCTYPE html><?xml version="1.0"?><br><hr/><input></br>', []],
				['<div>\n<br>\n</div>', [['>', 1, 0], ['>', 0, 1]]],
				['<ul>\n<li>a\n<li>b\n</ul>', [['>', 1, 0], ['>', 1, 0], ['li', 0, 1], ['>', 1, 0], ['>', 0, 2]]],
				['<ul><li>outer<ul><li>inner</ul><li>next</ul>', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 0, 2], ['li', 0, 1], ['>', 1, 0], ['>', 0, 2]]],
				['<dl><dt>term<dd>definition<dt>next</dl>', [['>', 1, 0], ['>', 1, 0], ['dd', 0, 1], ['>', 1, 0], ['dt', 0, 1], ['>', 1, 0], ['>', 0, 2]]],
				['<div><p>first<p>second<hr></div>', [['>', 1, 0], ['>', 1, 0], ['p', 0, 1], ['>', 1, 0], ['hr', 0, 1], ['>', 0, 1]]],
				['<select><optgroup><option>a<option>b<optgroup><option>c</select>', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['option', 0, 1], ['>', 1, 0], ['optgroup', 0, 2], ['>', 1, 0], ['>', 1, 0], ['>', 0, 3]]],
				['<table><tbody><tr><td>a<td>b<tr><th>c</table>', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['td', 0, 1], ['>', 1, 0], ['tr', 0, 2], ['>', 1, 0], ['>', 1, 0], ['>', 0, 4]]],
				['<html><body><p>text', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['text', 0, 3]]],
				['<div><p>text', [['>', 1, 0], ['>', 1, 0], ['text', 0, 1]]],
				['<div></span></div></div>', [['>', 1, 0], ['>', 0, 1]]],
				['<div><constructor><p>text</p></constructor></div>', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 0, 1], ['>', 0, 1], ['>', 0, 1]]],
				['<ruby>text<rt>a<rp>b<rt>c</ruby>', [['>', 1, 0], ['>', 1, 0], ['rp', 0, 1], ['>', 1, 0], ['rt', 0, 1], ['>', 1, 0], ['>', 0, 2]]],
				['<table><thead><tr><th>a<tbody><tr><td>b<tfoot><tr><td>c</table>', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['tbody', 0, 3], ['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['tfoot', 0, 3], ['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 0, 4]]],
				['<html><head><title>title</title><body><p>text', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 0, 1], ['body', 0, 1], ['>', 1, 0], ['>', 1, 0], ['text', 0, 3]]],
				['<html><head><title>title</title><p>text', [['>', 1, 0], ['>', 1, 0], ['>', 1, 0], ['>', 0, 1], ['p', 0, 1], ['>', 1, 0], ['text', 0, 2]]],
			];
			for (const [source, expected] of cases) {
				const tokens = [...highlight.resume({ source: highlightSource(source) })];
				a.equalValues(
					tokens.filter(token => token.foldStart || token.foldEnd)
						.map(token => [source.slice(token.start, token.end), token.foldStart, token.foldEnd]),
					expected,
				);
				const iterator = highlight.resume({ source: highlightSource(source) });
				const first = iterator.next();
				if (!first.done) {
					const snapshot = { ...first.value };
					const other = highlight.resume({ source: highlightSource(source) });
					other.next();
					a.equalValues([first.value, ...iterator], tokens);
					a.equalValues(first.value, snapshot);
					a.equalValues([...other], tokens.slice(1));
				}
				a.equalValues([...highlight.resume({ source: highlightSource(source) })], tokens);
			}
		});
		it.test('normalizes categories and omits EOF', a => {
			a.equalValues(
				[...highlight.resume({ source: highlightSource('<div id="x">hi</div>') })].map(token => token.highlight),
				['punctuation', 'tag', 'attribute', 'operator', 'string', 'punctuation', 'text', 'punctuation', 'punctuation', 'tag', 'punctuation'],
			);
			a.equalValues([...highlight.resume({ source: highlightSource('') })], []);
		});
		it.test('preserves original source positions and independent calls', a => {
			const source = 'first\nsecond';
			const tokens = [...highlight.resume({ source: highlightSource(source) })];
			a.equalValues(
				tokens
					.filter(token => token.highlight === 'identifier' || token.highlight === 'text')
					.map(token => [source.slice(token.start, token.end), token.line]),
				 [['first\nsecond', 0]],
			);
			a.equal(tokens.every(token => token.source === source), true);
			a.equalValues([...highlight.resume({ source: highlightSource(source) })], tokens);
		});
	});

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
			a.equal(token.end, 16, 'should consume full comment');
			a.equal(s.next().kind, 'eof', 'should find eof after comment');
		});

		it.test(
			'should parse unterminated comment as comment token to end',
			a => {
				const s = scanner('<!-- not closed');
				const token = s.next();
				a.equal(token.kind, 'comment');
				a.equal(token.end, 15, 'should consume to input end');
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
			a.equal(tok3.end, 15, 'should handle escaped quotes');
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

	a.test('scanner.next() negative and error-prone input cases', it => {
		it.test('should treat unknown characters as text', a => {
			const s = scanner('?!@');
			const t = s.next();
			a.equal(t.kind, 'text');
			a.equal(t.end, 3, 'Unknown characters are lumped as text');
		});

		it.test(
			'should handle tag name starting in the middle of text as text',
			a => {
				const s = scanner('fooBar');
				const t = s.next();
				a.equal(t.kind, 'text', 'Letters not after < or / or space');
				a.equal(t.end, 6);
			},
		);

		it.test('should treat lone > as gt', a => {
			const s = scanner('>');
			const t = s.next();
			a.equal(t.kind, 'gt');
		});

		it.test('should allow backtrack to previous state', a => {
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

function highlightSource(value: string) {
	return { id: {}, version: 1, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}
