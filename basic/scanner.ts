import {
	createCaseInsensitiveTrie,
	matchers,
	ScannerApi,
} from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords = [
	'and',
	'any',
	'as',
	'beep',
	'bload',
	'bsave',
	'call',
	'case',
	'circle',
	'clear',
	'close',
	'cls',
	'color',
	'common',
	'const',
	'data',
	'declare',
	'def',
	'defdbl',
	'defint',
	'deflng',
	'defsng',
	'defstr',
	'defseg',
	'dim',
	'do',
	'draw',
	'else',
	'elseif',
	'end',
	'eqv',
	'erase',
	'error',
	'exit',
	'field',
	'for',
	'function',
	'get',
	'go',
	'gosub',
	'goto',
	'if',
	'imp',
	'input',
	'is',
	'let',
	'line',
	'locate',
	'lock',
	'loop',
	'lprint',
	'lset',
	'mod',
	'next',
	'not',
	'on',
	'open',
	'option',
	'or',
	'out',
	'paint',
	'palette',
	'pcopy',
	'play',
	'poke',
	'preset',
	'print',
	'pset',
	'put',
	'randomize',
	'read',
	'redim',
	'rem',
	'reset',
	'restore',
	'resume',
	'return',
	'rset',
	'run',
	'screen',
	'seek',
	'select',
	'shared',
	'shell',
	'sleep',
	'sound',
	'static',
	'step',
	'stop',
	'sub',
	'swap',
	'system',
	'then',
	'timer',
	'to',
	'type',
	'unlock',
	'until',
	'view',
	'wait',
	'wend',
	'while',
	'width',
	'window',
	'write',
	'xor',
] as const;

const keywordTrie = createCaseInsensitiveTrie(...keywords);
const {
	alpha,
	alnum,
	digit,
	hexDigit,
	horizontalSpace,
	lineBreak,
	notLineBreak,
	octalDigit,
} = matchers;
const identCh = (ch: string) => ch === '_' || alnum(ch);
const suffix = (ch: string) =>
	ch === '$' || ch === '%' || ch === '&' || ch === '!' || ch === '#' || ch === '@';
const notIdent = (ch: string) => !identCh(ch) && !suffix(ch);

export function scan(source: string) {
	const api = ScannerApi({ source });
	const {
		backtrack: apiBacktrack,
		createTrieMatcher,
		current,
		eof,
		error,
		lineToken,
		matchEnclosed,
		matchWhile,
		skip,
		tk,
	} = api;
	const keyword = createTrieMatcher(keywordTrie, notIdent);
	let lineStart = true;

	function token<Kind extends string>(kind: Kind, consumed: number) {
		lineStart = false;
		return tk(kind, consumed);
	}

	function scanEol() {
		const consumed = current() === '\r' && current(1) === '\n' ? 2 : 1;
		lineStart = true;
		return lineToken('eol', consumed);
	}

	function continuationLength() {
		let n = 1;
		while (horizontalSpace(current(n))) n++;
		if (current(n) === '\r') n++;
		if (current(n) !== '\n') return 0;
		return n + 1;
	}

	function skipContinuation(consumed: number) {
		lineToken('continuation', consumed);
	}

	function scanString() {
		let n = 1;
		for (;;) {
			n = matchEnclosed(ch => ch !== '"' && !lineBreak(ch), undefined, n);
			if (current(n) !== '"') return token('string', n);
			if (current(n + 1) === '"') {
				n += 2;
				continue;
			}
			if (current(n - 1) === '\\') {
				let closing = n + 1;
				while (!eof(closing) && !lineBreak(current(closing))) {
					if (current(closing) === '"') break;
					closing++;
				}
				if (current(closing) === '"') {
					n++;
					continue;
				}
			}
			return token('string', n + 1);
		}
	}

	function digitRun(offset: number, isDigit: (ch: string) => boolean) {
		let n = offset;
		while (isDigit(current(n))) n++;
		return n;
	}

	function scanRadixNumber() {
		const radix = current(1).toLowerCase();
		const isDigit =
			radix === 'h' ? hexDigit : radix === 'o' ? octalDigit : matchers.binaryDigit;
		const label =
			radix === 'h' ? 'hexadecimal' : radix === 'o' ? 'octal' : 'binary';
		let n = digitRun(2, isDigit);
		if (n === 2) throw error(`Expected ${label} digit`, 2);
		if (current(n) === '&') n++;
		if (identCh(current(n)) || suffix(current(n)))
			throw error(`Invalid ${label} number`, n + 1);
		return token('number', n);
	}

	function scanDecimalNumber(fromDot: boolean) {
		let n = fromDot ? digitRun(1, digit) : digitRun(0, digit);
		if (fromDot && n === 1) return token('.', 1);
		if (!fromDot && current(n) === '.') n = digitRun(n + 1, digit);
		const exponent = current(n).toLowerCase();
		if (exponent === 'e' || exponent === 'd') {
			let end = n + 1;
			if (current(end) === '+' || current(end) === '-') end++;
			const digits = digitRun(end, digit);
			if (digits === end) throw error('Expected exponent digit', end);
			n = digits;
		}
		if (suffix(current(n))) n++;
		if (identCh(current(n)) || suffix(current(n)))
			throw error('Invalid decimal number', n + 1);
		return token('number', n);
	}

	function scanIdentifier() {
		let n = matchWhile(identCh, 1);
		if (suffix(current(n))) n++;
		return token('ident', n);
	}

	function isRemComment() {
		return (
			current().toLowerCase() === 'r' &&
			current(1).toLowerCase() === 'e' &&
			current(2).toLowerCase() === 'm' &&
			notIdent(current(3))
		);
	}

	function scanLeadingToken() {
		const ch = current();
		if (ch === "'") return token('comment', matchWhile(notLineBreak, 1));

		if (lineStart && (alpha(ch) || ch === '_')) {
			const n = matchWhile(identCh, 1);
			let value = '';
			for (let i = 0; i < n; i++) value += current(i);
			if (
				current(n) === ':' &&
				!keywords.some(keyword => keyword === value.toLowerCase())
			)
				return token('label', n + 1);
		}

		if (lineStart && digit(ch)) {
			const n = digitRun(0, digit);
			if (horizontalSpace(current(n)) || lineBreak(current(n)) || eof(n))
				return token('label', n);
		}

		if (isRemComment()) return token('comment', matchWhile(notLineBreak, 3));
	}

	function scanComparison(ch: string, la: string) {
		switch (ch) {
			case '<':
				return la === '=' ? token('<=', 2) : la === '>' ? token('<>', 2) : token('<', 1);
			case '>':
				return la === '=' ? token('>=', 2) : token('>', 1);
			case '=':
				return la === '>' ? token('=>', 2) : token('=', 1);
		}
	}

	function scanSingleCharacter(ch: string) {
		switch (ch) {
			case '+':
			case '-':
			case '*':
			case '/':
			case '\\':
			case '^':
			case '(':
			case ')':
			case '[':
			case ']':
			case '{':
			case '}':
			case ',':
			case ';':
			case ':':
			case '#':
				return token(ch, 1);
		}
	}

	function scanSymbol(ch: string, la: string) {
		const comparison = scanComparison(ch, la);
		if (comparison) return comparison;
		if (ch === '"') return scanString();
		if (ch === '&')
			return la === 'h' || la === 'H' || la === 'o' || la === 'O' || la === 'b' || la === 'B'
				? scanRadixNumber()
				: token('&', 1);
		if (ch === '.') return scanDecimalNumber(true);
		if (ch === '?') return token('print', 1);
		const single = scanSingleCharacter(ch);
		if (single) return single;
		if (ch === '$' && (alpha(la) || la === '_')) {
			let n = matchWhile(identCh, 2);
			if (suffix(current(n))) n++;
			return token('ident', n);
		}
	}

	function scanWord() {
		const keywordToken = keyword();
		if (keywordToken) {
			lineStart = false;
			return keywordToken;
		}
		return scanIdentifier();
	}

	function next() {
		for (;;) {
			const spaces = matchWhile(horizontalSpace);
			if (spaces) skip(spaces);
			if (eof()) return tk('eof', 0);
			if (lineBreak(current())) return scanEol();
			const continuation = current() === '_' ? continuationLength() : 0;
			if (!continuation) break;
			skipContinuation(continuation);
		}

		const ch = current();
		const la = current(1);
		const leading = scanLeadingToken();
		if (leading) return leading;
		const symbol = scanSymbol(ch, la);
		if (symbol) return symbol;
		if (digit(ch)) return scanDecimalNumber(false);
		if (alpha(ch) || ch === '_') return scanWord();

		throw error(`Invalid character "${ch}"`, 1);
	}

	function backtrack(pos: Parameters<typeof apiBacktrack>[0]) {
		apiBacktrack(pos);
		const start = source.lastIndexOf('\n', Math.max(0, pos.end - 1)) + 1;
		lineStart = source.slice(start, pos.end).trim().length === 0;
	}

	return { next, backtrack };
}
