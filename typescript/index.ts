import {
	ScannerApi,
	matchers,
	type Position,
	type Scanner,
	type Token,
} from '../sdk/index.js';

export type HighlightKind =
	| 'comment'
	| 'identifier'
	| 'keyword'
	| 'literal'
	| 'number'
	| 'operator'
	| 'punctuation'
	| 'regex'
	| 'string'
	| 'template'
	| 'type';

export type HighlightToken = Token<HighlightKind | 'eof'>;

const keywords = new Set(
	'abstract accessor as assert asserts async await break case catch class const constructor continue debugger declare default delete do else enum export extends finally for from function get global if implements import in infer instanceof interface is keyof let module namespace new of out override package private protected public readonly require return satisfies set static super switch this throw try type typeof unique using var while with yield'.split(
		' ',
	),
);
const typeKeywords = new Set(
	'any bigint boolean never number object string symbol unknown void'.split(' '),
);
const literals = new Set(['false', 'null', 'true', 'undefined']);
const regexKeywords = new Set([
	'await',
	'case',
	'delete',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield',
]);
const operators = new Set([
	'>>>=',
	'===',
	'!==',
	'>>>',
	'**=',
	'&&=',
	'||=',
	'??=',
	'<<=',
	'>>=',
	'=>',
	'++',
	'--',
	'**',
	'&&',
	'||',
	'??',
	'?.',
	'==',
	'!=',
	'<=',
	'>=',
	'+=',
	'-=',
	'*=',
	'/=',
	'%=',
	'&=',
	'|=',
	'^=',
	'<<',
	'>>',
	'+',
	'-',
	'*',
	'/',
	'%',
	'&',
	'|',
	'^',
	'!',
	'~',
	'?',
	'=',
	'<',
	'>',
]);
const punctuation = new Set('{}[](),;:.@');
const identifierStart = (ch: string) =>
	ch === '$' || ch === '_' || matchers.alpha(ch);
const identifierPart = (ch: string) =>
	identifierStart(ch) || matchers.digit(ch);

function escaped(index: number, source: string) {
	let slashes = 0;
	while (index > 0 && source[--index] === '\\') slashes++;
	return slashes % 2 === 1;
}

export const scan: Scanner<HighlightToken> = source => {
	const api = ScannerApi({ source });
	const {
		backtrack: apiBacktrack,
		current,
		eof,
		matchEnclosed,
		matchWhile,
		skipWhitespace,
		tk,
	} = api;
	const commentContexts = new Map<number, string | undefined>();
	let previous: HighlightToken | undefined;
	let backtrackedValue: string | undefined;

	function previousValue() {
		return (
			backtrackedValue ??
			(previous ? source.slice(previous.start, previous.end) : undefined)
		);
	}

	function token<Kind extends HighlightKind>(kind: Kind, consumed: number) {
		const result = tk(kind, consumed);
		if (kind === 'comment') commentContexts.set(result.end, previousValue());
		else {
			previous = result;
			backtrackedValue = undefined;
		}
		return result;
	}

	function identifier() {
		const consumed = matchWhile(identifierPart);
		const result: HighlightToken = tk('identifier', consumed);
		const word = source.slice(result.start, result.end);
		result.kind = literals.has(word)
			? 'literal'
			: typeKeywords.has(word)
				? 'type'
				: keywords.has(word)
					? 'keyword'
					: 'identifier';
		backtrackedValue = undefined;
		return (previous = result);
	}

	function number() {
		let consumed = 0;
		const radix = current(1).toLowerCase();
		if (current() === '0' && (radix === 'b' || radix === 'o' || radix === 'x')) {
			const digit =
				radix === 'b'
					? matchers.binaryDigit
					: radix === 'o'
						? matchers.octalDigit
						: matchers.hexDigit;
			consumed = matchWhile(ch => digit(ch) || ch === '_', 2);
		} else {
			consumed = matchWhile(ch => matchers.digit(ch) || ch === '_');
			if (current(consumed) === '.')
				consumed = matchWhile(
					ch => matchers.digit(ch) || ch === '_',
					consumed + 1,
				);
			if (/[eE]/.test(current(consumed))) {
				consumed++;
				if (/[+-]/.test(current(consumed))) consumed++;
				consumed = matchWhile(
					ch => matchers.digit(ch) || ch === '_',
					consumed,
				);
			}
		}
		if (current(consumed) === 'n') consumed++;
		return token('number', consumed);
	}

	function enclosed(kind: 'string' | 'template', quote: string) {
		const consumed = matchEnclosed(
			ch =>
				ch !== quote && (kind === 'template' || !matchers.lineBreak(ch)),
			escaped,
		);
		return token(kind, current(consumed) === quote ? consumed + 1 : consumed);
	}

	function blockComment() {
		let offset = 2;
		const consumed = matchEnclosed(ch => {
			const closing = ch === '*' && current(offset + 1) === '/';
			offset++;
			return !closing;
		}, undefined, 2);
		return token('comment', eof(consumed + 1) ? consumed : consumed + 2);
	}

	function canStartRegex() {
		const value = previousValue();
		if (value === undefined) return true;
		return (
			operators.has(value) && value !== '++' && value !== '--' ||
			'([{,;:'.includes(value) ||
			regexKeywords.has(value)
		);
	}

	function regex() {
		let consumed = 1;
		let characterClass = false;
		let escapedCharacter = false;
		while (!eof(consumed)) {
			const ch = current(consumed);
			if (ch === '\n' || ch === '\r') return token('operator', 1);
			if (escapedCharacter) escapedCharacter = false;
			else if (ch === '\\') escapedCharacter = true;
			else {
				if (ch === '[') characterClass = true;
				else if (ch === ']') characterClass = false;
				else if (ch === '/' && !characterClass) {
					consumed = matchWhile(identifierPart, consumed + 1);
					return token('regex', consumed);
				}
			}
			consumed++;
		}
		return token('operator', 1);
	}

	function next(): HighlightToken {
		skipWhitespace();
		if (eof()) return tk('eof', 0);
		const ch = current();
		if (identifierStart(ch)) return identifier();
		if (matchers.digit(ch) || ch === '.' && matchers.digit(current(1)))
			return number();
		if (ch === '"' || ch === "'") return enclosed('string', ch);
		if (ch === '`') return enclosed('template', ch);
		if (ch === '/' && current(1) === '/')
			return token('comment', matchWhile(matchers.notLineBreak, 2));
		if (ch === '/' && current(1) === '*') return blockComment();
		if (ch === '/' && canStartRegex()) return regex();
		const operator = ch + current(1) + current(2) + current(3);
		for (let length = 4; length > 0; length--)
			if (operators.has(operator.slice(0, length)))
				return token('operator', length);
		return token(punctuation.has(ch) ? 'punctuation' : 'operator', 1);
	}

	function backtrack(position: Position) {
		let line = position.line;
		for (let index = position.start; index < position.end; index++)
			if (source.charAt(index) === '\n') line++;
		apiBacktrack({
			start: position.start,
			end: position.end,
			line,
			source: position.source,
		});
		previous = undefined;
		backtrackedValue = commentContexts.has(position.end)
			? commentContexts.get(position.end)
			: source.slice(position.start, position.end);
	}

	return { next, backtrack };
};
