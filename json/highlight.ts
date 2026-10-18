import {
	CompilerError, createHighlighter, createResumableHighlighter,
	enrichHighlightToken, foldToken,
	type HighlightKind, type HighlightState, type HighlightToken,
	type HighlightWindow, type TokenizerError,
} from '@cxl/gbc.sdk';
import { scan, type ScannerToken } from './index.js';
import { initialScannerState, scanWindow, whitespace, type JsonScannerState, type Lexeme } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const legacy = createHighlighter(scan, token => {
	switch (token.kind) {
		case 'string':
			return /^[ \t\r\n]*:/.test(token.source.slice(token.end)) ? 'attribute' : 'string';
		case 'number': return 'number';
		case 'true': case 'false': case 'null': return 'literal';
		case 'eof': return 'text';
		default: return 'punctuation';
	}
}, foldToken);

interface JsonState {
	scanner: JsonScannerState;
	pending: Lexeme | undefined;
}

type JsonHighlightToken = (ScannerToken | TokenizerError) & HighlightToken;

function* resume(window: HighlightWindow, previous: Readonly<JsonState>): Generator<JsonHighlightToken, HighlightState<JsonState>> {
	let pending = previous.pending;
	let index = 0;
	const iterator = scanWindow(window.text, window.start, window.line, window.final, previous.scanner);

	function emit(token: Lexeme, highlight: HighlightKind): JsonHighlightToken {
		const position = window.position(token.start, token.end, token.line);
		const result = token.kind === 'tokenizer-error'
			? enrichHighlightToken(Object.assign(position, {
				kind: token.kind, error: new CompilerError(token.message, window.position(token.start, token.end, token.line)),
			}), 'error')
			: enrichHighlightToken(Object.assign(position, { kind: token.kind }), highlight);
		if (token.kind === '{' || token.kind === '[') result.foldStart = 1;
		else if (token.kind === '}' || token.kind === ']') result.foldEnd = 1;
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
		const next = iterator.next();
		if (next.done) return {
			state: { scanner: next.value, pending },
			committed: pending?.start ?? (next.value.kind ? next.value.start : window.start + window.text.length),
		};
		const token = next.value;
		index = token.end - window.start;
		if (token.kind === 'string') pending = token;
		else yield emit(token, token.kind === 'number' ? 'number' :
			token.kind === 'true' || token.kind === 'false' || token.kind === 'null' ? 'literal' : 'punctuation');
	}
}

export const highlight = createResumableHighlighter(legacy, (): JsonState => ({
	scanner: initialScannerState(), pending: undefined,
}), resume);
