import { createHighlighter, foldToken, text } from '@cxl/gbc.sdk';
import { keywords, scan } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordWords = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set(['(', ')', '{', '}', ';', ',', '...']);

const highlightTokens = createHighlighter(scan, token => {
	if (punctuation.has(token.kind)) return 'punctuation';
	switch (token.kind) {
		case 'comment':
			return 'comment';
		case 'newline':
			return 'text';
		case 'word': {
			const value = text(token);
			if (keywordWords.has(value)) return 'keyword';
			if (value.startsWith('"') || value.startsWith("'")) return 'string';
			if (/^\d+(\.\d+)?$/.test(value)) return 'number';
			return 'identifier';
		}
		default:
			return 'operator';
	}
});

const separators = new Set(['newline', ';', '&', '|', '&&', '||']);
const redirects = new Set(['>', '>>', '<', '<>', '>|', '<<', '<<-', '<&', '>&']);

export function* highlight(source: string): ReturnType<typeof highlightTokens> {
	let commandStart = true;
	let redirectTarget = false;
	for (const token of highlightTokens(source)) {
		[token.foldStart, token.foldEnd] = foldToken(token);
		const kind = token.kind;
		if (separators.has(kind) || kind === '(' || kind === '{') {
			commandStart = true;
			redirectTarget = false;
		} else if (redirects.has(kind)) redirectTarget = true;
		else if (kind === 'word') {
			const value = text(token);
			if (redirectTarget) redirectTarget = false;
			else if (commandStart && !(/^\d+$/.test(value) && /[<>]/.test(source.charAt(token.end)))) {
				if (value === 'if' || value === 'for') token.foldStart = 1;
				else if (value === 'fi' || value === 'done') token.foldEnd = 1;
				commandStart = value === 'if' || value === 'then' || value === 'elif' ||
					value === 'else' || value === 'do' || /^[A-Za-z_]\w*=/.test(value);
			}
		} else if (kind === ')' || kind === '}') commandStart = false;
		yield token;
	}
}
