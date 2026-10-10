import { createHighlighter, foldToken, type HighlightToken } from '@cxl/gbc.sdk';
import { keywords, scan } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordKinds: ReadonlySet<string> = new Set(keywords);
const wordOperators = new Set('and or xor eqv imp not mod'.split(' '));
const punctuation: ReadonlySet<string> = new Set(['(', ')', ',', ';', ':']);

const highlightTokens = createHighlighter(scan, token => {
	const kind = token.kind;
	if (wordOperators.has(kind)) return 'operator';
	if (keywordKinds.has(kind)) return 'keyword';
	if (punctuation.has(kind)) return 'punctuation';
	switch (kind) {
		case 'ident':
			return 'identifier';
		case 'number':
		case 'label':
		case 'string':
		case 'comment':
			return kind;
		case 'eol':
			return 'text';
		default:
			return 'operator';
	}
});

const blockStarts = new Set(['for', 'do', 'while', 'sub', 'function', 'select', 'type']);
const blockEnds = new Set(['if', 'sub', 'function', 'select', 'type']);

export function* highlight(source: string): ReturnType<typeof highlightTokens> {
	let previous = '';
	let blockIf = false;
	for (const token of highlightTokens(source)) {
		[token.foldStart, token.foldEnd] = foldToken(token);
		const kind = token.kind;
		if (kind === 'eol' || kind === ':') blockIf = false;
		else if (kind === 'if') blockIf = previous !== 'end';
		else if (kind === 'elseif') blockIf = false;
		else if (kind === 'then') {
			const rest = source.slice(token.end).split(/[\r\n]/, 1)[0]?.trim();
			if (blockIf && (!rest || /^(?:'|rem(?:\s|$))/i.test(rest))) token.foldStart = 1;
			blockIf = false;
		} else if (
			blockStarts.has(kind) && previous !== 'end' && previous !== 'exit' &&
			previous !== 'declare' && !(kind === 'while' && (previous === 'do' || previous === 'loop'))
		) token.foldStart = 1;
		token.foldEnd += closingFolds(token);
		previous = kind;
		yield token;
	}
}

function closingFolds(token: HighlightToken): number {
	switch (token.kind) {
		case 'end': {
			const suffix = /^[ \t]+([a-z]+)/i.exec(token.source.slice(token.end))?.[1]?.toLowerCase();
			return suffix && blockEnds.has(suffix) ? 1 : 0;
		}
		case 'next':
			return 1 + (token.source.slice(token.end).split(/[\r\n:']|\brem\b/i, 1)[0]?.match(/,/g)?.length ?? 0);
		case 'loop':
		case 'wend':
			return 1;
		default:
			return 0;
	}
}
