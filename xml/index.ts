import { scanner as markupScanner } from '@cxl/gbc.html';

export const scanner = (source: string) => markupScanner(source, true);
