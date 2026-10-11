import { createHighlighter, foldToken } from '@cxl/gbc.sdk';
import { scan } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
export const highlight = createHighlighter(scan, token => {
	switch (token.kind) {
		case 'string':
			return /^[ \t\r\n]*:/.test(token.source.slice(token.end)) ? 'attribute' : 'string';
		case 'number': return 'number';
		case 'true': case 'false': case 'null': return 'literal';
		case 'eof': return 'text';
		default: return 'punctuation';
	}
}, foldToken);
