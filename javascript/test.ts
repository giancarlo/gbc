import { highlight as createHighlight } from './highlight.js';
import { spec } from '@cxl/spec';
import { text, tokenize } from '@cxl/gbc.sdk';
import { scan } from './index.js';

const highlight = createHighlight();

const benchmarkSource = `export class Point {
	constructor(x, y) {
		this.x = x;
		this.y = y;
	}
}
export const length = ({ x, y }) => Math.sqrt(x ** 2 + y ** 2);
`.repeat(100);

const tokens = (source: string) =>
	[...tokenize(scan, source)].map(token => [
		token.kind,
		text(token),
		token.start,
		token.end,
		token.line,
	]);

export default spec('javascript', it => {
	it.test('highlights JSX only when enabled', a => {
		const options = { jsx: true };
		const jsx = createHighlight(options);
		const value = 'const view = <Box data-id="x" disabled>Hello &amp; {name}<br /></Box>; view / 2;';
		const source = highlightSource(value);
		const tokens = [...jsx.resume({ source })];
		a.equalValues(tokens.filter(token => ['tag', 'attribute', 'text', 'string'].includes(token.highlight))
			.map(token => [token.highlight, text(token)]), [
			['tag', 'Box'], ['attribute', 'data-id'], ['string', '"x"'], ['attribute', 'disabled'],
			['text', 'Hello &amp; '], ['tag', 'br'], ['tag', 'Box'],
		]);
		a.equal(tokens.some(token => token.highlight === 'regex'), false);
		a.equal(tokens.reduce((sum, token) => sum + token.foldStart - token.foldEnd, 0), 0);
		a.equal([...highlight.resume({ source })].some(token => token.highlight === 'tag'), false);
		const disabled = { ...options, jsx: false };
		a.equalValues([...createHighlight(disabled).resume({ source })], [...highlight.resume({ source })]);
	});

	it.test('distinguishes JSX text and attribute strings from embedded JavaScript', a => {
		const jsx = createHighlight({ jsx: true });
		const value = '<><svg:path title="a\\">// text\n{ready ? <UI.Button extends = {null} value={{ name: "}", pattern: /[{}<>]/g }} /> : null}{/* note */}</svg:path></>';
		const tokens = [...jsx.resume({ source: highlightSource(value) })];
		a.equalValues(tokens.filter(token => token.highlight === 'tag').map(text), ['svg:path', 'UI.Button', 'svg:path']);
		a.equalValues(tokens.filter(token => token.highlight === 'attribute').map(text), ['title', 'extends', 'value']);
		a.equalValues(tokens.filter(token => token.highlight === 'text').map(text), ['// text\n']);
		a.equalValues(tokens.filter(token => token.highlight === 'regex').map(text), ['/[{}<>]/g']);
		a.equalValues(tokens.filter(token => token.highlight === 'comment').map(text), ['/* note */']);
		a.equalValues(tokens.filter(token => token.highlight === 'string').map(text), ['"a\\"', '"}"']);
		a.equal(tokens.reduce((sum, token) => sum + token.foldStart - token.foldEnd, 0), 0);
	});

	it.test('preserves JSX lexical contexts at every checkpoint boundary', a => {
		const options = { jsx: true };
		const jsx = createHighlight(options);
		const values = [
			'const view = <><UI.Button data-id="a\\">Hello &amp;\n{/* note */ ready ? <b>{items.map(x => <i>{x}</i>)}</b> : null}</UI.Button><input {...props} disabled /></>; view / 2;',
			'const view = <a value={{ text: "}", regex: /[{}<>]/g }} other={total / 2}>\n// text, not a comment\n{`text ${name}`}\n</a>;',
			'const value = left < right ? /a/.test(text) : total / count;\nconst view = <div>{/* multi\nline */ <span>{value}</span>}</div>;',
			'const view = <Box extends = {value} extends-other="x" />;',
			'const view = <Button title="unfinished', 'const view = <div>{', '<div>Hi </', '<div foo={/a',
		];
		for (const value of values) {
			const source = highlightSource(value);
			const expected = drain(jsx.resume({ source })).tokens;
			for (const token of expected) {
				a.equal(token.source, value);
				a.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
				a.equal(token.start >= 0 && token.end > token.start && token.end <= value.length, true);
			}
			for (let end = 0; end < value.length; end++) {
				const prefix = drain(jsx.resume({ source, end }));
				const snapshot = JSON.stringify(prefix.tokens);
				const suffix = drain(jsx.resume({ source }, prefix.checkpoint));
				a.equalValues([...prefix.tokens, ...suffix.tokens], expected);
				a.equalValues(drain(jsx.resume({ source }, prefix.checkpoint)).tokens, suffix.tokens);
				a.equal(JSON.stringify(prefix.tokens), snapshot);
			}
			let result = drain(jsx.resume({ source, end: 0 }));
			const tokens = [...result.tokens];
			for (let end = 1; end <= value.length; end++) {
				result = drain(jsx.resume({ source, end }, result.checkpoint));
				tokens.push(...result.tokens);
			}
			a.equalValues(tokens, expected);
			a.equal(result.checkpoint.committed, value.length);
		}
	});

	it.test('keeps JSX checkpoints independent and relocatable after edits', a => {
		const options = { jsx: true };
		const jsx = createHighlight(options);
		const value = 'const view = <Box>\n{ready ? <i>{name}</i> : null}\n</Box>;';
		const source = highlightSource(value);
		const end = value.indexOf('{name') + 3;
		const prefix = drain(jsx.resume({ source, end }));
		a.equal(prefix.checkpoint.committed > 0, true);
		const other = jsx.resume({ source });
		const first = other.next();
		if (!first.done) {
			const snapshot = { ...first.value };
			a.equalValues([...jsx.resume({ source })], [first.value, ...other]);
			a.equalValues(first.value, snapshot);
		}
		const cancelled = jsx.resume({ source }, prefix.checkpoint);
		cancelled.next();
		cancelled.return(prefix.checkpoint);
		a.equalValues([...prefix.tokens, ...jsx.resume({ source }, prefix.checkpoint)], [...jsx.resume({ source })]);
		const edited = { ...highlightSource(value.slice(0, end) + 'x' + value.slice(end)), id: source.id, version: 2 };
		a.equalValues([...jsx.resume({ source: edited, edit: { previousVersion: 1, start: end } }, prefix.checkpoint)],
			[...jsx.resume({ source: edited })].filter(token => token.start >= prefix.checkpoint.committed));
		const changed = { ...highlightSource('\n' + value), id: source.id, version: 2 };
		const shifted = jsx.rebase(prefix.checkpoint, changed, 1, 1);
		const fresh = drain(jsx.resume({ source: changed, end: end + 1 }));
		a.equal(jsx.equivalent(shifted, fresh.checkpoint), true);
		a.equalValues([...jsx.resume({ source: changed }, shifted)], [...jsx.resume({ source: changed })].filter(token => token.start >= shifted.committed));
		a.throws(() => drain(jsx.resume({ source: changed }, prefix.checkpoint)));
		a.throws(() => drain(createHighlight(options).resume({ source }, prefix.checkpoint)));
	});

	it.test('keeps trailing operators within the source', a => {
		for (const operator of ['=', '==', '===', '>', '>>', '>>>', '>>>=', '+', '+=', '??', '??=']) {
			const value = 'const x ' + operator;
			const tokens = [...highlight.resume({ source: highlightSource(value) })];
			a.equalValues(tokens.filter(token => token.kind === 'operator').map(token => [token.start, token.end]), [[8, value.length]]);
		}
	});

	it.test('retains native context and stable folds across checkpoint windows', a => {
		const value = 'return /* note\n */ /[a/b]+/gi;\n`template\ntext`';
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

	it.test('public highlighting contract', it => {
		it.test('marks fold boundaries without folding literal delimiters', a => {
			const cases: [string, [string, number, number][]][] = [
				['({x: [1]})', [['{', 1, 0], ['[', 1, 0], [']', 0, 1], ['}', 0, 1]]],
				['function f(\nvalue\n) { return f(\nvalue\n); }', [['{', 1, 0], ['}', 0, 1]]],
				[
					'"{[()]}"; /[{}]/; // {\n`line\n{value}`; /* a\nb */',
					[
						['`line\n{value}`', 1, 1],
						['/* a\nb */', 1, 1],
					],
				],
				['{ [', [['{', 1, 0], ['[', 1, 0]]],
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
				[...highlight.resume({ source: highlightSource('const value = 42; // note') })].map(token => token.highlight),
				['keyword', 'identifier', 'operator', 'number', 'punctuation', 'comment'],
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
				 [['first', 0], ['second', 1]],
			);
			a.equal(tokens.every(token => token.source === source), true);
			a.equalValues([...highlight.resume({ source: highlightSource(source) })], tokens);
		});
	});

	it.should('highlight JavaScript token categories and positions', a => {
		a.equalValues(tokens('const value = 0x2a + 0b10 + 0o7 + 1.5e2;'), [
			['keyword', 'const', 0, 5, 0],
			['identifier', 'value', 6, 11, 0],
			['operator', '=', 12, 13, 0],
			['number', '0x2a', 14, 18, 0],
			['operator', '+', 19, 20, 0],
			['number', '0b10', 21, 25, 0],
			['operator', '+', 26, 27, 0],
			['number', '0o7', 28, 31, 0],
			['operator', '+', 32, 33, 0],
			['number', '1.5e2', 34, 39, 0],
			['punctuation', ';', 39, 40, 0],
		]);
	});

	it.should('treat TypeScript-only words as identifiers', a => {
		a.equalValues(
			tokens('type readonly number satisfies undefined').map(token => [
				token[0],
				token[1],
			]),
			[
				['identifier', 'type'],
				['identifier', 'readonly'],
				['identifier', 'number'],
				['identifier', 'satisfies'],
				['identifier', 'undefined'],
			],
		);
	});

	it.should('highlight multiline strings, literals, and comments', a => {
		const source = "'text' // note\n/* block\ncomment */ `hello ${name}` true";
		a.equalValues(tokens(source).map(token => [token[0], token[1], token[4]]), [
			['string', "'text'", 0],
			['comment', '// note', 0],
			['comment', '/* block\ncomment */', 1],
			['template', '`hello ${name}`', 2],
			['literal', 'true', 2],
		]);
	});

	it.should('distinguish regular expressions from division', a => {
		a.equalValues(
			tokens('const pattern = /a[b\\/]c/gi; total / count; return /x+/;').map(
				token => [token[0], token[1]],
			),
			[
				['keyword', 'const'],
				['identifier', 'pattern'],
				['operator', '='],
				['regex', '/a[b\\/]c/gi'],
				['punctuation', ';'],
				['identifier', 'total'],
				['operator', '/'],
				['identifier', 'count'],
				['punctuation', ';'],
				['keyword', 'return'],
				['regex', '/x+/'],
				['punctuation', ';'],
			],
		);
	});

	it.should('restore lexical context when backtracking', a => {
		const scanner = scan('value / count / 2');
		const value = scanner.next();
		a.equal(text(scanner.next()), '/');
		scanner.backtrack(value);
		a.equal(text(scanner.next()), '/');

		const commented = scan('/* note */ /x/');
		const comment = commented.next();
		a.equal(commented.next().kind, 'regex');
		commented.backtrack(comment);
		a.equal(commented.next().kind, 'regex');
	});

	it.should('tokenize editor-sized source', a =>
		a.benchmark(() => [...tokenize(scan, benchmarkSource)].length, {
			warmup: 50,
			sampleTime: 20,
			samples: 10,
		}),
	);
	it.should('highlight editor-sized source', a =>
		a.benchmark(() => [...highlight.resume({ source: highlightSource(benchmarkSource) })].length, {
			warmup: 50,
			sampleTime: 20,
			samples: 10,
			maxRegression: 15,
		}),
	);
	it.should('highlight editor-sized JSX in checkpoint windows', async a => {
		const jsx = createHighlight({ jsx: true });
		const source = highlightSource('const view = <Panel title="hello">\n{items.map(item => <Row key={item.id}>{item.name}</Row>)}\n</Panel>;\n'.repeat(100));
		await a.benchmark(() => {
			let result = drain(jsx.resume({ source, end: 0 }));
			let count = 0;
			while (!result.checkpoint.done) {
				result = drain(jsx.resume({ source, end: Math.min(source.length, result.checkpoint.offset + 4096) }, result.checkpoint));
				count += result.tokens.length;
			}
			return count;
		}, { warmup: 50, sampleTime: 20, samples: 10, maxRegression: 15 });
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
