import { spec } from '@cxl/spec';
import { text, tokenize } from '../sdk/index.js';
import { scan } from './index.js';

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
});
