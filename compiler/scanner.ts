import { ScannerApi, matchers, stringEscape } from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords = [
	'break',
	'done',
	'export',
	'extend',
	'external',
	'loop',
	'main',
	'next',
	'own',
	'type',
	'var',
] as const;

const { alpha, digit, hexDigit, binaryDigit, ident } = matchers;

const identFirst = (ch: string) => alpha(ch);
const notIdent = (ch: string) => !ident(ch);
const notEol = (ch: string) => ch !== '\n';

const stringCh = (ch: string) => ch !== "'" && ch !== '$';

export function scan(source: string) {
	const {
		current,
		eof,
		tk,
		matchWhile,
		createTrieMatcher,
		error,
		skipWhitespace,
		backtrack: apiBacktrack,
		matchEnclosed,
	} = ScannerApi({ source });

	const keywordMatcher = createTrieMatcher(keywords, notIdent);

	const braceStack: number[] = [];
	const braceLog: {
		end: number;
		kind: 'push' | 'pop' | 'inc' | 'dec';
		val: number;
	}[] = [];

	function bumpTop(delta: number) {
		const i = braceStack.length - 1;
		const d = braceStack[i];
		if (d !== undefined) braceStack[i] = d + delta;
	}

	/**
	 * Match a digit run with `_` allowed only as a separator between digits.
	 * Starting position must be a digit. Returns the new consumed count,
	 * or 0 if invalid (no leading digit, or a stray `_`).
	 */
	function digitRun(isDigit: (ch: string) => boolean, consumed = 0) {
		if (!isDigit(current(consumed))) return 0;
		let n = consumed + 1;
		while (!eof(n)) {
			const ch = current(n);
			if (isDigit(ch)) n++;
			else if (ch === '_') {
				if (!isDigit(current(n + 1))) return 0;
				n += 2;
			} else break;
		}
		return n;
	}

	function scanRadixNumber(la: string) {
		const isRadixDigit = la === 'x' ? hexDigit : binaryDigit;
		const label = la === 'x' ? 'hexadecimal digit' : 'binary digit';
		let start = 2;
		if (current(start) === '_') start++;
		const consumed = digitRun(isRadixDigit, start);
		if (consumed === 0 || ident(current(consumed)))
			throw error(`Expected ${label}`, (consumed || 2) + 1);
		return tk('number', consumed);
	}

	function scanDecimalNumber() {
		let consumed = digitRun(digit, 0);
		if (consumed === 0) throw error('Expected digit', 1);
		let float = false;
		// A number right after a member `.` is a positional index, not a
		// float — `.0` must not merge into it, so `d.1.0` reads as `(d.1).0`.
		const memberIndex = current(-1) === '.';
		if (!memberIndex && current(consumed) === '.') {
			const decimals = digitRun(digit, consumed + 1);
			if (decimals === 0)
				throw error('Expected digit', consumed + 1);
			consumed = decimals;
			float = true;
		}
		if (
			!memberIndex &&
			(current(consumed) === 'e' || current(consumed) === 'E')
		) {
			let n = consumed + 1;
			if (current(n) === '+' || current(n) === '-') n++;
			const exp = digitRun(digit, n);
			if (exp === 0) throw error('Expected digit', n + 1);
			consumed = exp;
			float = true;
		}
		if (ident(current(consumed)))
			throw error('Expected digit', consumed + 1);
		return tk(float ? 'float' : 'number', consumed);
	}

	function scanTwoCharOp(
		ch: '=' | '|' | '&' | '>' | '<' | '!' | ':',
		la: string,
	) {
		switch (ch) {
			case '=':
				return la === '=' ? tk('==', 2) : tk('=', 1);
			case '|':
				return la === '|' ? tk('||', 2) : tk('|', 1);
			case '&':
				return la === '&' ? tk('&&', 2) : tk('&', 1);
			case '>':
				return la === '='
					? tk('>=', 2)
					: la === '>'
						? tk('>>', 2)
						: tk('>', 1);
			case '<':
				return la === '='
					? tk('<=', 2)
					: la === ':'
						? tk('<:', 2)
						: tk('<', 1);
			case '!':
				return la === '=' ? tk('!=', 2) : tk('!', 1);
			case ':':
				return la === '>' ? tk(':>', 2) : tk(':', 1);
		}
	}

	function scanStr(fromQuote: boolean) {
		let n = 1;
		for (;;) {
			n = matchEnclosed(stringCh, stringEscape, n);
			const c = current(n);
			if (c === '') throw error('Unterminated string', n);
			if (c === "'") return tk(fromQuote ? 'string' : 'strtail', n + 1);
			if (current(n + 1) === '{') {
				braceStack.push(0);
				return tk(fromQuote ? 'strhead' : 'strmid', n + 2);
			}
			n += 1;
		}
	}

	function scanCloseBrace() {
		if (braceStack.length && braceStack[braceStack.length - 1] === 0) {
			const val = braceStack.pop() ?? 0;
			const t = scanStr(false);
			braceLog.push({ end: t.end, kind: 'pop', val });
			if (t.kind === 'strmid')
				braceLog.push({ end: t.end, kind: 'push', val: 0 });
			return t;
		}
		const t = tk('}', 1);
		if (braceStack.length) {
			bumpTop(-1);
			braceLog.push({ end: t.end, kind: 'dec', val: 0 });
		}
		return t;
	}

	function next() {
		skipWhitespace();

		if (eof()) return tk('eof', 0);

		const ch = current();
		const la = current(1);

		/* eslint no-fallthrough: off */
		switch (ch) {
			case '=':
			case '|':
			case '&':
			case '>':
			case '<':
			case '!':
			case ':':
				return scanTwoCharOp(ch, la);
			case '{': {
				const t = tk('{', 1);
				if (braceStack.length) {
					bumpTop(1);
					braceLog.push({ end: t.end, kind: 'inc', val: 0 });
				}
				return t;
			}
			case '}':
				return scanCloseBrace();
			case '.':
			case ',':
			case '?':
			case '*':
			case '/':
			case '%':
			case '~':
			case '(':
			case ')':
			case '^':
			case '$':
			case '@':
			case '[':
			case ']':
			case ';':
			case '+':
			case '-':
				return tk(ch, 1);
			case "'": {
				const t = scanStr(true);
				if (t.kind === 'strhead')
					braceLog.push({ end: t.end, kind: 'push', val: 0 });
				return t;
			}
			case '#': {
				// `#` is the directive sigil, not a comment marker — only
				// registered directives exist; free prose is a scan error.
				if (
					current(1) === 't' &&
					current(2) === 'e' &&
					current(3) === 's' &&
					current(4) === 't' &&
					notIdent(current(5))
				)
					return tk('#test', 5);
				const MAP = 'importmap';
				let isMap = true;
				for (let i = 0; i < MAP.length; i++)
					if (current(1 + i) !== MAP[i]) {
						isMap = false;
						break;
					}
				if (isMap && notIdent(current(1 + MAP.length)))
					return tk('#importmap', 1 + MAP.length);
				throw error(
					'`#` starts a directive, and free-text comments do not exist — known directives: #test, #importmap',
					matchWhile(notEol, 1),
				);
			}
			case '0':
				return la === 'x' || la === 'b'
					? scanRadixNumber(la)
					: scanDecimalNumber();
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9':
				return scanDecimalNumber();
			default: {
				const keywordToken = keywordMatcher();
				if (keywordToken) return keywordToken;
				if (identFirst(ch)) return tk('ident', matchWhile(ident, 1));
				throw error(`Invalid character "${ch}"`, 1);
			}
		}
	}

	function backtrack(pos: Parameters<typeof apiBacktrack>[0]) {
		apiBacktrack(pos);
		for (;;) {
			const op = braceLog[braceLog.length - 1];
			if (!op || op.end <= pos.end) break;
			braceLog.pop();
			if (op.kind === 'push') braceStack.pop();
			else if (op.kind === 'pop') braceStack.push(op.val);
			else if (op.kind === 'inc') bumpTop(-1);
			else bumpTop(1);
		}
	}

	return { next, backtrack };
}
