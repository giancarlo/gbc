///<amd-module name="@cxl/gbc.compiler/scanner.js"/>
import { CompilerError, Token } from '@cxl/gbc.sdk';

export type ScannerToken = ReturnType<ReturnType<typeof scan>>;
export type Kind = ScannerToken['kind'];

const digit = /[\d_]/,
	hexDigit = /[\da-fA-F_]/,
	binaryDigit = /[01_]/,
	notIdent = /[^\w_]/,
	identFirst = /[a-zA-Z_]/,
	ident = /[\w_]/;

export function scan(source: string) {
	const length = source.length;
	let index = 0;
	let line = 0;
	let endLine = 0;

	function tk<Kind extends string>(kind: Kind, consume: number): Token<Kind> {
		return {
			kind,
			start: index,
			end: (index += consume),
			line,
			source,
		};
	}

	function matchWhile(regex: RegExp, consumed = 0) {
		while (
			index + consumed < length &&
			regex.test(source[index + consumed])
		)
			consumed++;
		return consumed;
	}

	function matchString(s: string, end?: RegExp, consumed = 0) {
		const start = index + consumed;

		for (let i = 0; i < s.length; i++)
			if (source[start + i] !== s[i]) return 0;

		if (
			end &&
			source[start + s.length] &&
			!end.test(source[start + s.length])
		)
			return 0;

		return consumed + s.length;
	}

	function error(message: string, consumed = 0, start = index) {
		index += consumed;
		return new CompilerError(message, {
			start,
			end: index,
			line,
			source,
		});
	}

	function skipWhitespace() {
		for (let ch = source[index]; index < length; ch = source[++index]) {
			if (ch === '\n') endLine++;
			else if (ch !== '\r' && ch !== ' ' && ch !== '\t') break;
		}
	}

	function next() {
		skipWhitespace();
		line = endLine;

		if (index >= length) return tk('eof', 0);

		const ch = source[index];
		const la = source[index + 1];

		/* eslint no-fallthrough: off */
		switch (ch) {
			// 2-char operators
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
					: la === '<'
					? tk('<<', 2)
					: tk('<', 1);
			case '!':
				return la === '=' ? tk('!=', 2) : tk('!', 1);
			// 1-char operators
			case '{':
			case '}':
			case '.':
			case ',':
			case '?':
			case ':':
			case '*':
			case '/':
			case '~':
			case '(':
			case ')':
			case '+':
			case '-':
			case '^':
			case '$':
			case '[':
			case ']':
				return tk(ch, 1);
			case "'": {
				let n = 1;
				while (
					index + n < length &&
					(source[index + n] !== "'" ||
						source[index + n - 1] === '\\')
				) {
					if (source[index + n] === '\n') endLine++;
					n++;
				}

				if (source[index + n] !== "'")
					throw error('Unterminated string', n);

				return tk('string', n + 1);
			}
			case '#': {
				let n = 1;
				while (index + n < length && source[index + n] !== '\n') n++;
				return tk('comment', n);
			}

			// Number
			case '0':
				if (la === 'x') {
					const consumed = matchWhile(hexDigit, 2);
					if (
						consumed === 2 ||
						ident.test(source.charAt(index + consumed))
					)
						throw error('Expected hexadecimal digit', consumed + 1);
					return tk('number', consumed);
				}
				if (la === 'b') {
					const consumed = matchWhile(binaryDigit, 2);
					if (
						consumed === 2 ||
						ident.test(source.charAt(index + consumed))
					)
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
				if (consumed && source[index + consumed] === '.') {
					const decimals = matchWhile(digit, ++consumed);
					if (decimals === consumed)
						throw error('Expected digit', consumed);
					consumed = decimals;
				}
				if (ident.test(source.charAt(index + consumed)))
					throw error('Expected digit', consumed + 1);

				return tk('number', consumed);
			}

			// Keywords
			case 'd':
				if (matchString('one', notIdent, 1)) return tk('done', 4);
			case 'e':
				if (matchString('xport', notIdent, 1)) return tk('export', 6);
			case 'm':
				if (matchString('ain', notIdent, 1)) return tk('main', 4);
			case 't':
				if (matchString('ype', notIdent, 1)) return tk('type', 4);
			case 'v':
				if (matchString('ar', notIdent, 1)) return tk('var', 3);
			default:
				// Identifiers
				if (identFirst.test(ch))
					return tk('ident', matchWhile(ident, 1));

				throw error(`Invalid character "${ch}"`, 1);
		}
	}

	return next;
}
