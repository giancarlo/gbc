import { type Scanner, type Token } from '@cxl/gbc.sdk';
import {
	createScanner,
	type ScannerKind as JavaScriptScannerKind,
	keywords as javaScriptKeywords,
	literals as javaScriptLiterals,
} from '@cxl/gbc.javascript';

export type ScannerKind = JavaScriptScannerKind | 'type';
export type ScannerToken = Token<ScannerKind | 'eof'>;
export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';

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

export const scan: Scanner<ScannerToken> = createScanner(word =>
	literals.has(word)
		? 'literal'
		: typeKeywords.has(word)
			? 'type'
			: keywords.has(word)
				? 'keyword'
				: 'identifier',
);
