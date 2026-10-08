import {
	tokenize,
	type HighlightKind,
	type HighlightToken,
} from '@cxl/gbc.sdk';
import { scannerBlock, scannerInline } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';

export function* highlight(source: string): Generator<HighlightToken, void> {
	let offset = 0;
	let line = 0;
	function lineAt(start: number) {
		for (; offset < start; offset++)
			if (source.charAt(offset) === '\n') line++;
		return line;
	}

	for (const token of tokenize(scannerBlock, source)) {
		if (token.kind === 'tokenizer-error') {
			yield { ...token, kind: 'error', line: lineAt(token.start) };
			continue;
		}
		let kind: HighlightKind = 'text';
		switch (token.kind) {
			case 'block':
			case 'tabsBlock':
				kind = 'code';
				break;
			case 'heading':
			case 'setext':
				kind = 'heading';
				break;
			case 'li':
			case 'ol':
				kind = 'list';
				break;
			case 'blockquote':
				kind = 'blockquote';
				break;
			case 'hr':
				kind = 'separator';
				break;
			case 'linkdef':
				kind = 'link';
				break;
			case 'html':
				kind = 'tag';
				break;
			default:
				break;
		}
		if (
			token.kind !== 'text' && token.kind !== 'heading' &&
			token.kind !== 'setext' && token.kind !== 'li' &&
			token.kind !== 'ol' && token.kind !== 'blockquote'
		) {
			yield { ...token, kind, line: lineAt(token.start) };
			continue;
		}
		const start = token.start + token.textStart;
		const end = token.kind === 'heading' || token.kind === 'setext'
			? token.start + token.textEnd
			: token.end;
		if (start > token.start)
			yield { ...token, kind, end: start, line: lineAt(token.start) };
		for (const inline of tokenize(scannerInline, source.slice(start, end))) {
			let inlineKind: HighlightKind = kind === 'heading' ? kind : 'text';
			switch (inline.kind) {
				case 'tokenizer-error':
					inlineKind = 'error';
					break;
				case 'code':
				case 'tabsBlock':
					inlineKind = 'code';
					break;
				case 'delim':
					inlineKind = inline.count > 1 ? 'strong' : 'emphasis';
					break;
				case 'a':
				case 'img':
				case 'autolink':
					inlineKind = 'link';
					break;
				case 'html':
					inlineKind = 'tag';
					break;
				default:
					break;
			}
			yield {
				kind: inlineKind,
				start: start + inline.start,
				end: start + inline.end,
				line: lineAt(start + inline.start),
				source,
			};
		}
		if (end < token.end)
			yield { ...token, kind, start: end, line: lineAt(end) };
	}
}
