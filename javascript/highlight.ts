import { classifyIdentifier, createJavaScriptHighlighter, type JavaScriptHighlightOptions } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';
export type { JavaScriptHighlightOptions } from './index.js';

export const highlight = (options?: JavaScriptHighlightOptions) => createJavaScriptHighlighter(classifyIdentifier, options);
