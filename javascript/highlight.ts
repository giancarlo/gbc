import { classifyIdentifier, createJavaScriptHighlighter } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
export const highlight = createJavaScriptHighlighter(classifyIdentifier);
