import {
	ScannerApi,
	createHighlighter,
	each,
	type HighlightWindow,
	highlightTokens,
	highlightSegments,
	foldToken,
	type HighlightBuffer,
	matchers,
	type Position,
	type Scanner,
	type Token,
} from '@cxl/gbc.sdk';

type LexicalHighlightKind =
	| 'comment'
	| 'number'
	| 'operator'
	| 'punctuation'
	| 'regex'
	| 'string'
	| 'template';

type IdentifierHighlightKind = 'identifier' | 'keyword' | 'literal';

export type ScannerKind = LexicalHighlightKind | IdentifierHighlightKind;

export type ScannerToken = Token<ScannerKind | 'eof'>;
export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';

export const keywords: ReadonlySet<string> = new Set(
	'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof using var void while with yield'.split(
		' ',
	),
);
export const literals: ReadonlySet<string> = new Set(['false', 'null', 'true']);
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

export const createScanner = <ExtraKind extends string = never>(
	classifyIdentifier: (word: string) => IdentifierHighlightKind | ExtraKind,
	context?: boolean,
	capturePrevious = false,
): Scanner<
	Token<LexicalHighlightKind | IdentifierHighlightKind | ExtraKind | 'eof'>
> => source => {
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
	type ScannedToken = Token<
		LexicalHighlightKind | IdentifierHighlightKind | ExtraKind | 'eof'
	>;
	let previous: ScannedToken | undefined;
	let backtrackedValue: string | undefined;

	function previousValue() {
		return backtrackedValue ?? (previous ? source.slice(previous.start, previous.end) : undefined);
	}

	function token<Kind extends LexicalHighlightKind>(kind: Kind, consumed: number) {
		const result = tk(kind, consumed);
		if (kind === 'comment') commentContexts.set(result.end, previousValue());
		else {
			previous = result;
			backtrackedValue = capturePrevious ? source.slice(result.start, result.end) : undefined;
		}
		return result;
	}

	function identifier() {
		const consumed = matchWhile(identifierPart);
		const result: ScannedToken = tk('identifier', consumed);
		const word = source.slice(result.start, result.end);
		result.kind = classifyIdentifier(word);
		previous = result;
		backtrackedValue = capturePrevious ? word : undefined;
		return result;
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
		return value === undefined ? context ?? true : regexContext(value);
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

	function next(): ScannedToken {
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
		if (punctuation.has(ch)) return token('punctuation', 1);
		const operator = ch + current(1) + current(2) + current(3);
		for (let length = 4; length > 0; length--)
			if (operators.has(operator.slice(0, length)))
				return token('operator', length);
		return token('operator', 1);
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

export function classifyIdentifier(word: string): IdentifierHighlightKind {
	return literals.has(word)
		? 'literal'
		: keywords.has(word)
			? 'keyword'
			: 'identifier';
}

export const scan = createScanner(classifyIdentifier);

interface JavaScriptLexicalState {
	fallback: JavaScriptLexicalState | undefined;
	mode: 'code' | 'word' | 'operator' | 'slash' | 'string' | 'template' | 'line' | 'block' | 'regex' | 'flags';
	quote: string;
	escape: boolean;
	characterClass: boolean;
	star: boolean;
	word: string;
	regexAllowed: boolean;
}

export interface JavaScriptHighlightState extends JavaScriptLexicalState {
	buffer: HighlightBuffer;
	regex: boolean;
}

function copyLexical(previous: Readonly<JavaScriptHighlightState>): JavaScriptHighlightState {
	const result = { ...previous };
	let current: JavaScriptLexicalState = result;
	while (current.fallback) {
		current.fallback = { ...current.fallback };
		current = current.fallback;
	}
	return result;
}

function regexContext(value: string | undefined) {
	return value === undefined || operators.has(value) && value !== '++' && value !== '--' ||
		'([{,;:'.includes(value) || regexKeywords.has(value);
}

function enclosedBoundary(state: JavaScriptLexicalState, ch: string): boolean {
	if (state.mode === 'line') {
		if (ch !== '\n' && ch !== '\r') return false;
		state.mode = 'code';
		return ch === '\n';
	}
	if (state.mode === 'block') {
		if (state.star && ch === '/') { state.mode = 'code'; state.star = false; }
		else state.star = ch === '*';
		return false;
	}
	if (state.mode === 'regex') return regexBoundary(state, ch);
	if (state.escape) state.escape = false;
	else if (ch === '\\') state.escape = true;
	else if (ch === state.quote || state.mode === 'string' && (ch === '\n' || ch === '\r')) {
		state.mode = 'code'; state.regexAllowed = false;
		return ch === '\n';
	}
	return false;
}

function regexBoundary(state: JavaScriptLexicalState, ch: string): boolean {
	const fallback = state.fallback;
	const ready = fallback ? boundary(fallback, ch) : false;
	if (ch === '\n' || ch === '\r') {
		if (fallback) Object.assign(state, fallback);
		else state.mode = 'code';
		return ready;
	}
	if (state.escape) state.escape = false;
	else if (ch === '\\') state.escape = true;
	else if (ch === '[') state.characterClass = true;
	else if (ch === ']') state.characterClass = false;
	else if (ch === '/' && !state.characterClass) { state.mode = 'flags'; state.regexAllowed = false; state.fallback = undefined; }
	return false;
}

function boundary(state: JavaScriptLexicalState, ch: string): boolean {
	for (;;) {
		switch (state.mode) {
			case 'word':
				if (identifierPart(ch)) { state.word = (state.word + ch).slice(0, 16); return false; }
				state.regexAllowed = regexContext(state.word);
				state.mode = 'code';
				continue;
			case 'operator':
				if (operators.has(state.word + ch)) { state.word += ch; return false; }
				state.regexAllowed = regexContext(state.word);
				state.mode = 'code';
				continue;
			case 'slash':
				if (ch === '/') { state.mode = 'line'; return false; }
				if (ch === '*') { state.mode = 'block'; state.star = false; return false; }
				if (state.regexAllowed) {
					state.fallback = {
						mode: 'operator', word: '/', fallback: undefined,
						quote: state.quote, escape: state.escape, characterClass: state.characterClass,
						star: state.star, regexAllowed: state.regexAllowed,
					};
					state.mode = 'regex'; state.characterClass = state.escape = false; continue;
				}
				state.mode = 'operator'; state.word = '/';
				continue;
			case 'line': case 'block': case 'string': case 'template': case 'regex':
				return enclosedBoundary(state, ch);
			case 'flags':
				if (identifierPart(ch)) return false;
				state.mode = 'code';
				continue;
			case 'code':
				if (ch === '\n') return true;
				if (' \t\r'.includes(ch)) return false;
				if (identifierPart(ch)) { state.mode = 'word'; state.word = ch; }
				else if (ch === '/') state.mode = 'slash';
				else if (ch === '"' || ch === "'" || ch === '`') {
					state.quote = ch; state.escape = false; state.mode = ch === '`' ? 'template' : 'string';
				} else if (operators.has(ch)) { state.mode = 'operator'; state.word = ch; }
				else state.regexAllowed = regexContext(ch);
				return false;
		}
	}
}

export function createJavaScriptHighlighter<ExtraKind extends 'type' = never>(
	classify: (word: string) => IdentifierHighlightKind | ExtraKind,
) {
	const initial = (): JavaScriptHighlightState => ({
		buffer: { start: 0, line: 0, fragment: undefined }, mode: 'code', quote: '', escape: false,
		characterClass: false, star: false, word: '', regexAllowed: true, regex: true, fallback: undefined,
	});
	function* scan(window: HighlightWindow, previous: Readonly<JavaScriptHighlightState>) {
		const state = copyLexical(previous);
		const segments = highlightSegments(window, state.buffer, ch => boundary(state, ch));
		for (;;) {
			const next = segments.next();
			if (next.done) {
				state.buffer = next.value;
				return { state, committed: state.buffer.start };
			}
			yield* highlightTokens(next.value, each(createScanner(classify, state.regex, next.value.start !== 0 || !next.value.final)(next.value.text).next), next.value.final ? token => token.kind === 'eof' ? 'text' : token.kind : token => {
				if (token.kind !== 'comment' && token.kind !== 'eof') state.regex = regexContext(token.source.slice(token.start, token.end));
				return token.kind === 'eof' ? 'text' : token.kind;
			}, undefined, foldToken);
			state.regexAllowed = state.regex;
		}
	}
	return createHighlighter(initial, (window, previous) => {
		if (window.final && !previous.buffer.fragment)
			return highlightTokens(window, each(createScanner(classify, previous.regex, window.start !== 0)(window.text).next),
				token => token.kind === 'eof' ? 'text' : token.kind,
				{ state: previous, committed: window.start + window.text.length }, foldToken);
		return scan(window, previous);
	});
}
