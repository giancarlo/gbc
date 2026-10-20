import { tokenize, createHighlighter, shiftHighlightBuffer, highlightTokens, highlightSegments, foldToken, type HighlightOptions, type ScannerContext, type HighlightKind, type HighlightBuffer, type HighlightWindow, type HighlightToken } from '@cxl/gbc.sdk';
import { keywords, scan, type ScannerToken } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';
const keywordKinds: ReadonlySet<string> = new Set(keywords);
const wordOperators = new Set('and or xor eqv imp not mod'.split(' '));
const punctuation: ReadonlySet<string> = new Set(['(', ')', ',', ';', ':']);

const classify = (token: ScannerToken): HighlightKind => {
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
};

const blockStarts = new Set(['for', 'do', 'while', 'sub', 'function', 'select', 'type']);
const blockEnds = new Set(['if', 'sub', 'function', 'select', 'type']);

interface BasicState {
	scanner: ScannerContext;
	buffer: HighlightBuffer;
	previous: string;
	blockIf: boolean;
	tail: string;
}

export const highlight = (_options?: HighlightOptions) => createHighlighter((): BasicState => ({
	scanner: { line: 0, endLine: 0 }, buffer: { start: 0, line: 0, fragment: undefined }, previous: '', blockIf: false, tail: '',
}), function* (window, previousState) {
	const state = { ...previousState, scanner: { ...previousState.scanner } };
	const segments = highlightSegments(window, state.buffer, ch => {
		if (ch === '\n') {
			const continued = state.tail === '_';
			state.tail = '';
			return !continued;
		}
		if (ch !== ' ' && ch !== '\t' && ch !== '\r') state.tail = ch;
		return false;
	});
	for (;;) {
		const next = segments.next();
		if (next.done) {
			state.buffer = next.value;
			return { state, committed: state.buffer.start };
		}
		yield* highlightLine(next.value, state);
	}
}, (state, shift) => ({
	...state, buffer: shiftHighlightBuffer(state.buffer, shift),
	scanner: { line: state.scanner.line + shift.line, endLine: state.scanner.endLine + shift.line },
}));

function* highlightLine(window: HighlightWindow, state: BasicState) {
	let { previous, blockIf } = state;
	const source = window.text;
	for (const token of highlightTokens(window, tokenize(source => scan(source, state.scanner), window.text), classify, undefined, foldToken, 0)) {
		const kind = token.kind;
		if (kind === 'eol' || kind === ':') blockIf = false;
		else if (kind === 'if') blockIf = previous !== 'end';
		else if (kind === 'elseif') blockIf = false;
		else if (kind === 'then') {
			const rest = source.slice(token.end - window.start).split(/[\r\n]/, 1)[0]?.trim();
			if (blockIf && (!rest || /^(?:'|rem(?:\s|$))/i.test(rest))) token.foldStart = 1;
			blockIf = false;
		} else if (
			blockStarts.has(kind) && previous !== 'end' && previous !== 'exit' &&
			previous !== 'declare' && !(kind === 'while' && (previous === 'do' || previous === 'loop'))
		) token.foldStart = 1;
		token.foldEnd += closingFolds(token, window);
		previous = kind;
		yield token;
	}
	state.previous = previous;
	state.blockIf = blockIf;
}

function closingFolds(token: HighlightToken, window: HighlightWindow): number {
	switch (token.kind) {
		case 'end': {
			const suffix = /^[ \t]+([a-z]+)/i.exec(window.text.slice(token.end - window.start))?.[1]?.toLowerCase();
			return suffix && blockEnds.has(suffix) ? 1 : 0;
		}
		case 'next':
			return 1 + (window.text.slice(token.end - window.start).split(/[\r\n:']|\brem\b/i, 1)[0]?.match(/,/g)?.length ?? 0);
		case 'loop':
		case 'wend':
			return 1;
		default:
			return 0;
	}
}
