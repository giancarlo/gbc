import { ScannerApi, matchers, stringEscape } from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords = [
	'done',
	'export',
	'import',
	'loop',
	'main',
	'next',
	'type',
	'fn',
	'var',
	'macro',
] as const;

const {
	alpha,
	digitUnderscore: digit,
	hexDigitUnderscore: hexDigit,
	binaryDigitUnderscore: binaryDigit,
	ident,
} = matchers;

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
				if (la === 'x') {
					const consumed = matchWhile(hexDigit, 2);
					if (consumed === 2 || ident(current(consumed)))
						throw error('Expected hexadecimal digit', consumed + 1);
					return tk('number', consumed);
				}
				if (la === 'b') {
					const consumed = matchWhile(binaryDigit, 2);
					if (consumed === 2 || ident(current(consumed)))
						throw error('Expected binary digit', consumed + 1);
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
				let consumed = matchWhile(digit, 1);
				if (consumed && current(consumed) === '.') {
					const decimals = matchWhile(digit, ++consumed);
					if (decimals === consumed)
						throw error('Expected digit', consumed);
					consumed = decimals;
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
