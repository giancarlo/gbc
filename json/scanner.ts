import { matchers, type Position } from '@cxl/gbc.sdk';
import type { ScannerKind } from './index.js';

export const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export type Lexeme = Position & (
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

export function scanWindow(text: string, start: number, line: number, final: boolean, previous: Readonly<JsonScannerState>) {
	let { kind, start: tokenStart, line: tokenLine, escape, unicode, valid, number: numberState, literal } = previous;
	let index = 0;
	const stringEnd = /["\\]|[^\u0020-\uffff]/g;
	const atomEnd = /[ \t\r\n{}[\]:,]/g;

	function error(message: string, end: number): Lexeme {
		kind = undefined;
		return { kind: 'tokenizer-error', start: tokenStart, end, line: tokenLine, source: text, message };
	}

	function atom(end: number): Lexeme {
		kind = undefined;
		if (valid && literal?.length === end - tokenStart)
			return { kind: literal, start: tokenStart, end, line: tokenLine, source: text };
		if (numberState === 'zero' || numberState === 'integer' || numberState === 'fraction' || numberState === 'exponent')
			return { kind: 'number', start: tokenStart, end, line: tokenLine, source: text };
		return error('Invalid JSON token', end);
	}

	function string(ch: string, offset: number): Lexeme | undefined {
		if (unicode) {
			if (matchers.hexDigit(ch)) {
				unicode--;
				return;
			}
			valid = false;
			unicode = 0;
		}
		if (ch < ' ') return error(escape ? 'Invalid escape' : 'Unescaped control character', offset);
		if (escape) {
			escape = false;
			if (ch === 'u') unicode = 4;
			else if (!'"\\/bfnrt'.includes(ch)) valid = false;
		} else if (ch === '\\') escape = true;
		else if (ch === '"') {
			if (!valid) return error('Invalid string', offset + 1);
			kind = undefined;
			return { kind: 'string', start: tokenStart, end: offset + 1, line: tokenLine, source: text };
		}
	}

	function stringRun() {
		if (!escape && !unicode) {
			stringEnd.lastIndex = index;
			index = stringEnd.exec(text)?.index ?? text.length;
			if (index === text.length) return;
		}
		const current = text.charAt(index);
		const token = string(current, start + index);
		if (current >= ' ') index++;
		return token;
	}

	function completeAtom(): Lexeme | undefined {
		atomEnd.lastIndex = index;
		const end = atomEnd.exec(text)?.index ?? text.length;
		if (end === text.length && !final) return;
		tokenStart = start + index;
		tokenLine = line;
		const word = text.slice(index, end);
		index = end;
		if (word === 'true' || word === 'false' || word === 'null')
			return { kind: word, start: tokenStart, end: start + end, line, source: text };
		if (matchers.digit(word.charAt(word.length - 1)) && numberPattern.test(word))
			return { kind: 'number', start: tokenStart, end: start + end, line, source: text };
		return error('Invalid JSON token', start + end);
	}

	function begin(ch: string, offset: number) {
		kind = ch === '"' ? 'string' : 'atom';
		tokenStart = offset;
		tokenLine = line;
		escape = false;
		unicode = 0;
		valid = true;
		numberState = 'start';
		literal = ch === 't' ? 'true' : ch === 'f' ? 'false' : ch === 'n' ? 'null' : undefined;
		if (kind === 'string') index++;
	}

	function next(): Lexeme | undefined {
		while (index < text.length) {
			const ch = text.charAt(index);
			const offset = start + index;
			if (kind === 'atom') {
				if (whitespace(ch) || punctuation(ch)) return atom(offset);
				else {
					if (numberState !== 'invalid') numberState = number(numberState, ch);
					valid &&= literal?.charAt(offset - tokenStart) === ch;
					index++;
				}
			} else if (kind === 'string') {
				const token = stringRun();
				if (token) return token;
			} else if (whitespace(ch)) {
				do {
					if (text.charAt(index) === '\n') line++;
					index++;
				} while (index < text.length && whitespace(text.charAt(index)));
			} else if (punctuation(ch)) {
				index++;
				return { kind: ch, start: offset, end: offset + 1, line, source: text };
			} else {
				if (ch !== '"') {
					const token = completeAtom();
					if (token) return token;
				}
				begin(ch, offset);
			}
		}
		if (final && kind)
			return kind === 'atom' ? atom(start + text.length) : error('Unterminated string', start + text.length);
	}
	return { next, get state(): JsonScannerState {
		return { kind, start: tokenStart, line: tokenLine, escape, unicode, valid, number: numberState, literal };
	} };
}
