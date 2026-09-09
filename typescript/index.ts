import { type Scanner, type Token } from '../sdk/index.js';
import {
	createScanner,
	type HighlightKind as JavaScriptHighlightKind,
	keywords as javaScriptKeywords,
	literals as javaScriptLiterals,
} from '../javascript/index.js';

export type HighlightKind = JavaScriptHighlightKind | 'type';
export type HighlightToken = Token<HighlightKind | 'eof'>;

const keywords = new Set([
	...javaScriptKeywords,
	...'abstract accessor as assert asserts constructor declare enum global implements infer interface is keyof module namespace out override package private protected public readonly require satisfies type unique'.split(
		' ',
	),
]);
const typeKeywords = new Set(
	'any bigint boolean never number object string symbol unknown void'.split(' '),
);
const literals = new Set([...javaScriptLiterals, 'undefined']);

export const scan: Scanner<HighlightToken> = createScanner(word =>
	literals.has(word)
		? 'literal'
		: typeKeywords.has(word)
			? 'type'
			: keywords.has(word)
				? 'keyword'
				: 'identifier',
);
