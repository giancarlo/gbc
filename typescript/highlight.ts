import { createJavaScriptHighlighter, type JavaScriptHighlightOptions } from '@cxl/gbc.javascript';
import { classifyIdentifier } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';
export type { JavaScriptHighlightOptions } from '@cxl/gbc.javascript';

export const highlight = (options?: JavaScriptHighlightOptions) => createJavaScriptHighlighter(classifyIdentifier, options);
