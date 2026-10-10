import {
	tokenize,
	enrichHighlightToken,
	foldToken,
	type HighlightKind,
	type HighlightToken,
	type TokenizerError,
} from '@cxl/gbc.sdk';
import { scannerBlock, scannerInline } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';

export function* highlight(source: string): Generator<HighlightToken, void> {
	let offset = 0;
	let line = 0;
	let pending: HighlightToken | undefined;
	let foldStart = 0;
	let indented = false;
	const sections: number[] = [];
	function lineAt(start: number) {
		for (; offset < start; offset++)
			if (source.charAt(offset) === '\n') line++;
		return line;
	}

	for (const token of tokenize(scannerBlock, source)) {
		if (token.kind === 'tabsBlock' && !indented) {
			indented = true;
			foldStart = 1;
		} else if (indented && token.kind !== 'tabsBlock' && token.kind !== 'eol') {
			if (pending) pending.foldEnd++;
			indented = false;
		}
		if (token.kind === 'heading' || token.kind === 'setext') {
			while (sections.length && (sections.at(-1) ?? 0) >= token.level) {
				sections.pop();
				if (pending) pending.foldEnd++;
			}
			sections.push(token.level);
			foldStart = 1;
		}
		for (const result of highlightBlock(token, lineAt)) {
			[result.foldStart, result.foldEnd] = foldToken(result);
			result.foldStart += foldStart;
			foldStart = 0;
			const previous = pending;
			pending = result;
			if (previous) yield previous;
		}
	}
	if (pending) {
		pending.foldEnd += sections.length + Number(indented);
		yield pending;
	}
}

function* highlightBlock(
	token: ReturnType<ReturnType<typeof scannerBlock>['next']> | TokenizerError,
	lineAt: (start: number) => number,
): Generator<HighlightToken, void> {
	const source = token.source;
	if (token.kind === 'tokenizer-error') {
		token.line = lineAt(token.start);
		yield enrichHighlightToken(token, 'error');
		return;
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
		token.line = lineAt(token.start);
		yield enrichHighlightToken(token, kind);
		return;
	}
	const start = token.start + token.textStart;
	const end = token.kind === 'heading' || token.kind === 'setext'
		? token.start + token.textEnd
		: token.end;
	if (start > token.start)
		yield { ...token, highlight: kind, foldStart: 0, foldEnd: 0, end: start, line: lineAt(token.start) };
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
			kind: inline.kind,
			highlight: inlineKind,
			foldStart: 0,
			foldEnd: 0,
			start: start + inline.start,
			end: start + inline.end,
			line: lineAt(start + inline.start),
			source,
		};
	}
	if (end < token.end)
		yield { ...token, highlight: kind, foldStart: 0, foldEnd: 0, start: end, line: lineAt(end) };
}
