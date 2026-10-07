import { createHighlighter } from '@cxl/gbc.sdk';
import { scan } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
export const highlight = createHighlighter(scan, token =>
	token.kind === 'eof' ? 'text' : token.kind,
);
