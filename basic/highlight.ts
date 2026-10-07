import { createHighlighter } from '@cxl/gbc.sdk';
import { keywords, scan } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordKinds: ReadonlySet<string> = new Set(keywords);
const wordOperators = new Set('and or xor eqv imp not mod'.split(' '));
const punctuation: ReadonlySet<string> = new Set(['(', ')', ',', ';', ':']);

export const highlight = createHighlighter(scan, token => {
	const kind = token.kind;
	if (wordOperators.has(kind)) return 'operator';
	if (keywordKinds.has(kind)) return 'keyword';
	if (punctuation.has(kind)) return 'punctuation';
	switch (kind) {
		case 'ident':
			return 'identifier';
		case 'number':
		case 'label':
		case 'string':
		case 'comment':
			return kind;
		case 'eol':
			return 'text';
		default:
			return 'operator';
	}
});
