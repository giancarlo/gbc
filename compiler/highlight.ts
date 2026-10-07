import { createHighlighter } from '@cxl/gbc.sdk';
import { keywords, scan } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordKinds: ReadonlySet<string> = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set('{}()[],;');

export const highlight = createHighlighter(scan, token => {
	const kind = token.kind;
	if (keywordKinds.has(kind)) return 'keyword';
	if (punctuation.has(kind)) return 'punctuation';
	switch (kind) {
		case 'ident':
			return 'identifier';
		case 'number':
		case 'float':
			return 'number';
		case 'string':
		case 'strhead':
		case 'strmid':
		case 'strtail':
			return 'string';
		case '#test':
		case '#importmap':
			return 'directive';
		default:
			return 'operator';
	}
});
