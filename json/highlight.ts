import {
	CompilerError, createHighlighter, enrichHighlightToken,
	type HighlightKind, type HighlightState, type HighlightToken,
	type HighlightWindow, type Position, type TokenizerError,
} from '@cxl/gbc.sdk';
import type { ScannerToken } from './index.js';
import { initialScannerState, scanWindow, whitespace, type JsonScannerState, type Lexeme } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
interface JsonState {
	scanner: JsonScannerState;
	pending: Omit<Position, 'source'> | undefined;
}

type JsonHighlightToken = (ScannerToken | TokenizerError) & HighlightToken;

function* resume(window: HighlightWindow, previous: Readonly<JsonState>): Generator<JsonHighlightToken, HighlightState<JsonState>> {
	let pending: Lexeme | undefined = previous.pending ? Object.assign(window.position(
		previous.pending.start, previous.pending.end, previous.pending.line,
	), { kind: 'string' as const }) : undefined;
	let index = 0;
	const scanner = scanWindow(window.text, window.start, window.line, window.final, previous.scanner);

	function emit(token: Lexeme, highlight: HighlightKind): JsonHighlightToken {
		if (token.kind === 'tokenizer-error') return Object.assign(window.position(token.start, token.end, token.line), {
			kind: token.kind, error: new CompilerError(token.message, window.position(token.start, token.end, token.line)),
			highlight: 'error' as const, foldStart: 0, foldEnd: 0,
		});
		const result = enrichHighlightToken(token, highlight);
		if (token.kind === '{' || token.kind === '[') result.foldStart = 1;
		else if (token.kind === '}' || token.kind === ']') result.foldEnd = 1;
		if (window.start || !window.final) window.position(token.start, token.end, token.line, result);
		return result;
	}

	for (;;) {
		if (pending) {
			while (index < window.text.length && whitespace(window.text.charAt(index))) index++;
			if (index < window.text.length || window.final) {
				yield emit(pending, window.text.charAt(index) === ':' ? 'attribute' : 'string');
				pending = undefined;
			}
		}
		const token = scanner.next();
		if (!token) {
			const state = scanner.state;
			return {
				state: { scanner: state, pending: pending ? { start: pending.start, end: pending.end, line: pending.line } : undefined },
				committed: pending?.start ?? (state.kind ? state.start : window.start + window.text.length),
			};
		}
		index = token.end - window.start;
		if (token.kind === 'string') pending = token;
		else yield emit(token, token.kind === 'number' ? 'number' :
			token.kind === 'true' || token.kind === 'false' || token.kind === 'null' ? 'literal' : 'punctuation');
	}
}

export const highlight = createHighlighter((): JsonState => ({
	scanner: initialScannerState(), pending: undefined,
}), resume, (state, shift) => ({
	scanner: state.scanner.kind ? { ...state.scanner, start: state.scanner.start + shift.offset, line: state.scanner.line + shift.line } : initialScannerState(),
	pending: state.pending ? { start: state.pending.start + shift.offset, end: state.pending.end + shift.offset, line: state.pending.line + shift.line } : undefined,
}));
