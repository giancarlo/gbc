import { matchers } from '@cxl/gbc.sdk';
import type { ScannerKind } from './index.js';

export type Lexeme = { start: number; end: number; line: number } & (
	| { kind: ScannerKind; message?: never }
	| { kind: 'tokenizer-error'; message: string }
);

type NumberState = 'start' | 'minus' | 'zero' | 'integer' | 'dot' | 'fraction' | 'exp' | 'sign' | 'exponent' | 'invalid';

export interface JsonScannerState {
	kind: 'string' | 'atom' | undefined;
	start: number;
	line: number;
	escape: boolean;
	unicode: number;
	valid: boolean;
	number: NumberState;
	literal: 'true' | 'false' | 'null' | undefined;
}

export const whitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
const punctuation = (ch: string): ch is '{' | '}' | '[' | ']' | ':' | ',' => '{}[]:,'.includes(ch);

export function initialScannerState(): JsonScannerState {
	return { kind: undefined, start: 0, line: 0, escape: false, unicode: 0, valid: true, number: 'start', literal: undefined };
}

function number(state: NumberState, ch: string): NumberState {
	const digit = matchers.digit(ch);
	switch (state) {
		case 'start':
			if (ch === '-') return 'minus';
			return number('minus', ch);
		case 'minus': return ch === '0' ? 'zero' : ch >= '1' && ch <= '9' ? 'integer' : 'invalid';
		case 'zero': case 'integer':
			if (ch === '.') return 'dot';
			if (ch === 'e' || ch === 'E') return 'exp';
			return state === 'integer' && digit ? 'integer' : 'invalid';
		case 'dot': return digit ? 'fraction' : 'invalid';
		case 'fraction':
			if (ch === 'e' || ch === 'E') return 'exp';
			return digit ? 'fraction' : 'invalid';
		case 'exp':
			if (ch === '+' || ch === '-') return 'sign';
			return digit ? 'exponent' : 'invalid';
		case 'sign': case 'exponent': return digit ? 'exponent' : 'invalid';
		case 'invalid': return 'invalid';
	}
}

export function* scanWindow(text: string, start: number, line: number, final: boolean, previous: Readonly<JsonScannerState>): Generator<Lexeme, JsonScannerState> {
	const state = { ...previous };

	function error(message: string, end: number): Lexeme {
		state.kind = undefined;
		return { kind: 'tokenizer-error', start: state.start, end, line: state.line, message };
	}

	function atom(end: number): Lexeme {
		state.kind = undefined;
		if (state.valid && state.literal?.length === end - state.start)
			return { kind: state.literal, start: state.start, end, line: state.line };
		if (state.number === 'zero' || state.number === 'integer' || state.number === 'fraction' || state.number === 'exponent')
			return { kind: 'number', start: state.start, end, line: state.line };
		return error('Invalid JSON token', end);
	}

	function string(ch: string, offset: number): Lexeme | undefined {
		if (state.unicode) {
			if (matchers.hexDigit(ch)) {
				state.unicode--;
				return;
			}
			state.valid = false;
			state.unicode = 0;
		}
		if (ch < ' ') return error(state.escape ? 'Invalid escape' : 'Unescaped control character', offset);
		if (state.escape) {
			state.escape = false;
			if (ch === 'u') state.unicode = 4;
			else if (!'"\\/bfnrt'.includes(ch)) state.valid = false;
		} else if (ch === '\\') state.escape = true;
		else if (ch === '"') {
			if (!state.valid) return error('Invalid string', offset + 1);
			state.kind = undefined;
			return { kind: 'string', start: state.start, end: offset + 1, line: state.line };
		}
	}

	for (let index = 0; index < text.length;) {
		const ch = text.charAt(index);
		const offset = start + index;
		if (state.kind === 'atom') {
			if (whitespace(ch) || punctuation(ch)) yield atom(offset);
			else {
				state.number = number(state.number, ch);
				state.valid &&= state.literal?.charAt(offset - state.start) === ch;
				index++;
			}
		} else if (state.kind === 'string') {
			const token = string(ch, offset);
			if (token) yield token;
			if (ch >= ' ') index++;
		} else if (whitespace(ch)) {
			if (ch === '\n') line++;
			index++;
		} else if (punctuation(ch)) {
			yield { kind: ch, start: offset, end: offset + 1, line };
			index++;
		} else {
			state.kind = ch === '"' ? 'string' : 'atom';
			state.start = offset;
			state.line = line;
			state.escape = false;
			state.unicode = 0;
			state.valid = true;
			state.number = 'start';
			state.literal = ch === 't' ? 'true' : ch === 'f' ? 'false' : ch === 'n' ? 'null' : undefined;
			if (state.kind === 'string') index++;
		}
	}
	if (final && state.kind)
		yield state.kind === 'atom' ? atom(start + text.length) : error('Unterminated string', start + text.length);
	return state;
}
