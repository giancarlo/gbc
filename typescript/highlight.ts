import type { HighlightOptions } from '@cxl/gbc.sdk';
import { createJavaScriptHighlighter } from '@cxl/gbc.javascript';
import { classifyIdentifier } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';

export const highlight = (_options?: HighlightOptions) => createJavaScriptHighlighter(classifyIdentifier);
