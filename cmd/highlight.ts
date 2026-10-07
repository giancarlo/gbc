import { createHighlighter, text } from '@cxl/gbc.sdk';
import { keywords, scan } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordWords = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set(['(', ')', '{', '}', ';', ',', '...']);

export const highlight = createHighlighter(scan, token => {
	if (punctuation.has(token.kind)) return 'punctuation';
	switch (token.kind) {
		case 'comment':
			return 'comment';
		case 'newline':
			return 'text';
		case 'word': {
			const value = text(token);
			if (keywordWords.has(value)) return 'keyword';
			if (value.startsWith('"') || value.startsWith("'")) return 'string';
			if (/^\d+(\.\d+)?$/.test(value)) return 'number';
			return 'identifier';
		}
		default:
			return 'operator';
	}
});
