import { highlight as markupHighlight } from '@cxl/gbc.html/highlight';
import type { HighlightOptions } from '@cxl/gbc.sdk';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';

export const highlight = (options?: HighlightOptions): ReturnType<typeof markupHighlight> => markupHighlight({ ...options, xml: true });
