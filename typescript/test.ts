import { highlight } from './highlight.js';
import { spec } from '@cxl/spec';
import { text, tokenize } from '@cxl/gbc.sdk';
import { scan } from './index.js';

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
	it.test('public highlighting contract', it => {
		it.test('normalizes categories and omits EOF', a => {
			a.equalValues(
				[...highlight('const value: number = 42;')].map(token => token.highlight),
				['keyword', 'identifier', 'punctuation', 'type', 'operator', 'number', 'punctuation'],
			);
			a.equalValues([...highlight('')], []);
		});
		it.test('preserves original source positions and independent calls', a => {
			const source = 'first\nsecond';
			const tokens = [...highlight(source)];
			a.equalValues(
				tokens
					.filter(token => token.highlight === 'identifier' || token.highlight === 'text')
					.map(token => [source.slice(token.start, token.end), token.line]),
				 [['first', 0], ['second', 1]],
			);
			a.equal(tokens.every(token => token.source === source), true);
			a.equalValues([...highlight(source)], tokens);
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
			['template', '`hello ${name}`', 2],
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
		a.benchmark(() => [...highlight(benchmarkSource)].length, {
			warmup: 50,
			sampleTime: 20,
			samples: 10,
			maxRegression: 15,
		}),
	);
});
