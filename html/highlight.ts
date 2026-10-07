import { createHighlighter } from '@cxl/gbc.sdk';
import { scanner } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
export const highlight = createHighlighter(scanner, token => {
	switch (token.kind) {
		case 'attrName':
			return 'attribute';
		case 'tagName':
			return 'tag';
		case 'comment':
		case 'string':
			return token.kind;
		case 'equals':
			return 'operator';
		case 'openTag':
		case 'gt':
		case 'slash':
			return 'punctuation';
		default:
			return 'text';
	}
});
