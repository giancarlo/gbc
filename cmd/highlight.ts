import { createHighlighter, foldToken, text } from '@cxl/gbc.sdk';
import { keywords, scanHighlight } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordWords = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set(['(', ')', '{', '}', ';', ',', '...']);

const highlightTokens = createHighlighter(scanHighlight, token => {
	if (punctuation.has(token.kind)) return 'punctuation';
	switch (token.kind) {
		case 'comment':
			return 'comment';
		case 'heredoc':
			return 'string';
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
const commandPrefixes = new Set(['if', 'then', 'elif', 'else', 'do']);

export function* highlight(source: string): ReturnType<typeof highlightTokens> {
	let commandStart = true;
	let redirectTarget = false;
	let commandName = false;
	const parentheses: boolean[] = [];
	for (const token of highlightTokens(source)) {
		[token.foldStart, token.foldEnd] = foldToken(token);
		const kind = token.kind;
		if (kind === '(') {
			const signature = commandName && /^(?:$|\)|(?:\.\.\.[ \t\r\n]*)?[A-Za-z_]\w*\??[ \t\r\n]*:)/.test(source.slice(token.end).trimStart());
			const block = !signature && parentheses.at(-1) !== false;
			parentheses.push(block);
			token.foldStart = Number(block);
			commandStart = block;
			redirectTarget = commandName = false;
		} else if (kind === ')') {
			const block = parentheses.pop();
			token.foldEnd = Number(block === true);
			commandStart = block === false;
			commandName = false;
		} else if (parentheses.at(-1) === false) {
			yield token;
			continue;
		} else if (separators.has(kind) || kind === '{') {
			commandStart = true;
			redirectTarget = commandName = false;
		} else if (redirects.has(kind)) redirectTarget = true;
		else if (kind === 'word') {
			const value = text(token);
			commandName = false;
			if (redirectTarget) redirectTarget = false;
			else if (commandStart && !(/^\d+$/.test(value) && /[<>]/.test(source.charAt(token.end)))) {
				if (value === 'if' || value === 'for') token.foldStart = 1;
				else if (value === 'fi' || value === 'done') token.foldEnd = 1;
				commandStart = commandPrefixes.has(value) || /^[A-Za-z_]\w*=/.test(value);
				commandName = !commandStart;
			}
		} else if (kind === '}') commandStart = commandName = false;
		yield token;
	}
}
