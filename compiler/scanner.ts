import { ScannerApi, matchers, stringEscape } from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords = [
	'break',
	'done',
	'export',
	'external',
	'import',
	'is',
	'loop',
	'main',
	'next',
	'type',
	'fn',
	'var',
] as const;

const { alpha, digit, hexDigit, binaryDigit, ident } = matchers;

const identFirst = (ch: string) => alpha(ch);
const notIdent = (ch: string) => !ident(ch);
const notEol = (ch: string) => ch !== '\n';

const stringCh = (ch: string) => ch !== "'"; // && ch !== '{';
/*const stringEscape = (ch: string, cur: string) =>
	(cur === "'" && ch === '\\') || (cur === '{' && ch !== '$');*/

export function scan(source: string) {
	const {
		current,
		eof,
		tk,
		matchWhile,
		createTrieMatcher,
		error,
		skipWhitespace,
		backtrack,
		matchEnclosed,
	} = ScannerApi({ source });

	const keywordMatcher = createTrieMatcher(keywords, notIdent);

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

	function next() {
		skipWhitespace();

		if (eof()) return tk('eof', 0);

		const ch = current();
		const la = current(1);

		/* eslint no-fallthrough: off */
		switch (ch) {
			// 2-char operators
			case '=':
				return la === '='
					? tk('==', 2)
					: la === '>'
						? tk('=>', 2)
						: tk('=', 1);
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
					: la === '<'
						? tk('<<', 2)
						: la === ':'
							? tk('<:', 2)
							: tk('<', 1);
			case '!':
				return la === '=' ? tk('!=', 2) : tk('!', 1);
			case '+':
				return la === '+' ? tk('++', 2) : tk('+', 1);
			case '-':
				return la === '-' ? tk('--', 2) : tk('-', 1);
			case ':':
				return la === '>' ? tk(':>', 2) : tk(':', 1);
			// 1-char operators
			case '{':
			case '}':
			case '.':
			case ',':
			case '?':
			case '*':
			case '/':
			case '~':
			case '(':
			case ')':
			case '^':
			case '$':
			case '@':
			case '[':
			case ']':
				return tk(ch, 1);
			case "'": {
				let n = matchEnclosed(stringCh, stringEscape);
				const end = current(n);
				if (end === '') throw error('Unterminated string', n);
				else if (end === "'") n += 1;
				// We have an embedded expression
				else n -= 1;

				return tk('string', n);
			}
			case '#': {
				const n = matchWhile(notEol, 1);
				return tk('comment', n);
			}

			// Number
			case '0':
				if (la === 'x' || la === 'b') {
					const isRadixDigit = la === 'x' ? hexDigit : binaryDigit;
					const label =
						la === 'x' ? 'hexadecimal digit' : 'binary digit';
					// Allow a single leading `_` after the radix prefix.
					let start = 2;
					if (current(start) === '_') start++;
					const consumed = digitRun(isRadixDigit, start);
					if (consumed === 0 || ident(current(consumed)))
						throw error(`Expected ${label}`, (consumed || 2) + 1);
					return tk('number', consumed);
				}
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9': {
				let consumed = digitRun(digit, 0);
				if (consumed === 0)
					throw error('Expected digit', 1);
				if (current(consumed) === '.') {
					const decimals = digitRun(digit, consumed + 1);
					if (decimals === 0)
						throw error('Expected digit', consumed + 1);
					consumed = decimals;
				}
				if (current(consumed) === 'e' || current(consumed) === 'E') {
					let n = consumed + 1;
					if (current(n) === '+' || current(n) === '-') n++;
					const exp = digitRun(digit, n);
					if (exp === 0) throw error('Expected digit', n + 1);
					consumed = exp;
				}
				if (ident(current(consumed)))
					throw error('Expected digit', consumed + 1);

				return tk('number', consumed);
			}
			default: {
				// Keywords
				const keywordToken = keywordMatcher();
				if (keywordToken) return keywordToken;

				// Identifiers
				if (identFirst(ch)) return tk('ident', matchWhile(ident, 1));

				throw error(`Invalid character "${ch}"`, 1);
			}
		}
	}

	return { next, backtrack };
}
