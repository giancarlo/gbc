import { highlight as createHighlight } from './highlight.js';
import { spec } from '@cxl/spec';
import { text, tokenize } from '@cxl/gbc.sdk';
import { scan } from './index.js';

const highlight = createHighlight();

const benchmarkSource = `export interface Point<T extends number> {
	readonly x: T;
	readonly y: T;
}
export const length = ({ x, y }: Point<number>) =>
	Math.sqrt(x ** 2 + y ** 2);
`.repeat(100);

const tokens = (source: string) =>
	[...tokenize(scan, source)].map(token => [
		token.kind,
		text(token),
		token.start,
		token.end,
		token.line,
	]);

export default spec('typescript', it => {
	it.test('highlights template interpolation as code', a => {
		const value = '`hello ${name + 1} ${true}`';
		const expected = [
			['template', '`hello '], ['punctuation', '${'], ['identifier', 'name'],
			['operator', '+'], ['number', '1'], ['punctuation', '}'],
			['template', ' '], ['punctuation', '${'], ['literal', 'true'],
			['punctuation', '}'], ['template', '`'],
		];
		a.equalValues(tokens(value).map(token => token.slice(0, 2)), expected);
		for (const jsx of [false, true]) {
			a.equalValues([...createHighlight({ jsx }).resume({ source: highlightSource(value) })]
				.map(token => [token.highlight, text(token)]), expected);
		}
	});

	it.test('classifies TypeScript expressions inside nested templates and TSX', a => {
		const value = '`outer ${value as string} ${`inner ${undefined satisfies unknown}`}`';
		for (const jsx of [false, true]) {
			const highlighter = createHighlight({ jsx });
			const input = jsx ? '<Box>{' + value + '}</Box>' : value;
			const source = highlightSource(input);
			const expected = [...highlighter.resume({ source })];
			a.equalValues(expected.filter(token => ['keyword', 'type', 'literal'].includes(token.highlight))
				.map(token => [token.highlight, text(token)]), [
				['keyword', 'as'], ['type', 'string'], ['literal', 'undefined'],
				['keyword', 'satisfies'], ['type', 'unknown'],
			]);
			for (let end = 0; end < input.length; end++) {
				const prefix = drain(highlighter.resume({ source, end }));
				a.equalValues([...prefix.tokens, ...highlighter.resume({ source }, prefix.checkpoint)], expected);
			}
		}
	});

	it.test('combines TypeScript classifications with opt-in JSX', a => {
		const options = { jsx: true };
		const tsx = createHighlight(options);
		const value = 'const render = <T,>(value: T): unknown => <Box enabled={true}>{value as string}</Box>;';
		const source = highlightSource(value);
		const expected = drain(tsx.resume({ source })).tokens;
		a.equalValues(expected.filter(token => ['tag', 'attribute', 'type', 'literal'].includes(token.highlight))
			.map(token => [token.highlight, text(token)]), [
			['type', 'unknown'], ['tag', 'Box'], ['attribute', 'enabled'], ['literal', 'true'], ['type', 'string'], ['tag', 'Box'],
		]);
		a.equal([...highlight.resume({ source })].some(token => token.highlight === 'tag'), false);
		for (let end = 0; end < value.length; end++) {
			const prefix = drain(tsx.resume({ source, end }));
			a.equalValues([...prefix.tokens, ...tsx.resume({ source }, prefix.checkpoint)], expected);
		}
	});

	it.test('handles generic components and constrained generic arrows in TSX', a => {
		const tsx = createHighlight({ jsx: true });
		const value = 'const render = <T extends object>(value: T) => <UI.Box<Result<string>> value={value as T} />;';
		const source = highlightSource(value);
		const expected = drain(tsx.resume({ source })).tokens;
		a.equalValues(expected.filter(token => token.highlight === 'tag').map(text), ['UI.Box']);
		a.equalValues(expected.filter(token => token.highlight === 'attribute').map(text), ['value']);
		a.equalValues(expected.filter(token => token.highlight === 'type').map(text), ['object', 'string']);
		for (let end = 0; end < value.length; end++) {
			const prefix = drain(tsx.resume({ source, end }));
			a.equalValues([...prefix.tokens, ...tsx.resume({ source }, prefix.checkpoint)], expected);
		}
	});

	it.test('retains native context and stable folds across checkpoint windows', a => {
		const value = 'interface Point {\n readonly x: number;\n}\nreturn /[a/b]+/g';
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
				['interface X { value: [number, string] }', [['{', 1, 0], ['[', 1, 0], [']', 0, 1], ['}', 0, 1]]],
				['type X = "{}"; // {\n/* a\nb */', [['/* a\nb */', 1, 1]]],
				['({', [['{', 1, 0]]],
				['function f(\nvalue: number\n) { return f(\nvalue\n); }', [['{', 1, 0], ['}', 0, 1]]],
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
				[...highlight.resume({ source: highlightSource('const value: number = 42;') })].map(token => token.highlight),
				['keyword', 'identifier', 'punctuation', 'type', 'operator', 'number', 'punctuation'],
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

	it.should('highlight TypeScript token categories and positions', a => {
		a.equalValues(tokens('const value: number = 0x2a + 0b10 + 0o7 + 1.5e2;'), [
			['keyword', 'const', 0, 5, 0],
			['identifier', 'value', 6, 11, 0],
			['punctuation', ':', 11, 12, 0],
			['type', 'number', 13, 19, 0],
			['operator', '=', 20, 21, 0],
			['number', '0x2a', 22, 26, 0],
			['operator', '+', 27, 28, 0],
			['number', '0b10', 29, 33, 0],
			['operator', '+', 34, 35, 0],
			['number', '0o7', 36, 39, 0],
			['operator', '+', 40, 41, 0],
			['number', '1.5e2', 42, 47, 0],
			['punctuation', ';', 47, 48, 0],
		]);
	});

	it.should('highlight multiline strings, literals, and comments', a => {
		const source = "'text' // note\n/* block\ncomment */ `hello ${name}` true";
		a.equalValues(tokens(source).map(token => [token[0], token[1], token[4]]), [
			['string', "'text'", 0],
			['comment', '// note', 0],
			['comment', '/* block\ncomment */', 1],
			['template', '`hello ', 2],
			['punctuation', '${', 2],
			['identifier', 'name', 2],
			['punctuation', '}', 2],
			['template', '`', 2],
			['literal', 'true', 2],
		]);
	});

	it.should('preserve TypeScript classification precedence', a => {
		a.equalValues(
			tokens('void undefined').map(token => [token[0], token[1]]),
			[
				['type', 'void'],
				['literal', 'undefined'],
			],
		);
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

		const multiline = scan('`first\nsecond` value');
		const template = multiline.next();
		a.equal(multiline.next().line, 1);
		multiline.backtrack(template);
		a.equal(multiline.next().line, 1);

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
