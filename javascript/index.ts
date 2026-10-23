import {
	ScannerApi,
	createHighlighter,
	shiftHighlightBuffer,
	each,
	type HighlightWindow,
	type HighlightOptions,
	type Highlighter,
	highlightTokens,
	highlightSegments,
	foldToken,
	type HighlightBuffer,
	type HighlightToken,
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

export interface JavaScriptHighlightOptions extends HighlightOptions {
	jsx?: boolean;
}

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

function templateBrace(templates: number[], ch: string) {
	if (!templates.length) return false;
	const depth = templates[templates.length - 1];
	if (depth === undefined) return false;
	if (ch === '{') templates[templates.length - 1] = depth + 1;
	else if (ch === '}') {
		templates[templates.length - 1] = depth - 1;
		return depth === 0;
	}
	return false;
}

export const createScanner = <ExtraKind extends string = never>(
	classifyIdentifier: (word: string) => IdentifierHighlightKind | ExtraKind,
	context?: boolean,
	capturePrevious = false,
	templateContext?: number[],
): Scanner<
	Token<LexicalHighlightKind | IdentifierHighlightKind | ExtraKind | 'eof'>
> => source => {
	const templates = templateContext ?? [];
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
	const templateContexts = new Map<number, number[]>();
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
		if (templates.length || kind === 'template') templateContexts.set(result.end, [...templates]);
		return result;
	}

	function identifier() {
		const consumed = matchWhile(identifierPart);
		const result: ScannedToken = tk('identifier', consumed);
		const word = source.slice(result.start, result.end);
		result.kind = classifyIdentifier(word);
		if (templates.length) templateContexts.set(result.end, [...templates]);
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

	function enclosed(quote: string) {
		const consumed = matchEnclosed(
			ch =>
				ch !== quote && !matchers.lineBreak(ch),
			escaped,
		);
		return token('string', current(consumed) === quote ? consumed + 1 : consumed);
	}

	function template(offset: number) {
		let lines = 0;
		while (!eof(offset)) {
			const ch = current(offset);
			if (ch === '\n') lines++;
			if (ch === '\\') {
				if (current(offset + 1) === '\n') lines++;
				offset += eof(offset + 1) ? 1 : 2;
				continue;
			}
			if (ch === '`') { templates.pop(); offset++; break; }
			if (ch === '$' && current(offset + 1) === '{') break;
			offset++;
		}
		if (!offset) {
			templates[templates.length - 1] = 0;
			return token('punctuation', 2);
		}
		const result = token('template', offset);
		if (lines) apiBacktrack({ ...result, line: result.line + lines });
		return result;
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
		if (templates.length && templates[templates.length - 1] === -1 && !eof()) return template(0);
		skipWhitespace();
		if (eof()) return tk('eof', 0);
		const ch = current();
		if (identifierStart(ch)) return identifier();
		if (matchers.digit(ch) || ch === '.' && matchers.digit(current(1)))
			return number();
		if (ch === '"' || ch === "'") return enclosed(ch);
		if (ch === '`') { templates.push(-1); return template(1); }
		templateBrace(templates, ch);
		if (ch === '/' && current(1) === '/')
			return token('comment', matchWhile(matchers.notLineBreak, 2));
		if (ch === '/' && current(1) === '*') return blockComment();
		if (ch === '/' && canStartRegex()) return regex();
		if (punctuation.has(ch)) return token('punctuation', 1);
		const operator = ch + current(1) + current(2) + current(3);
		for (let length = operator.length; length > 0; length--)
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
		templates.splice(0, templates.length, ...(templateContexts.get(position.end) ?? []));
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
	templates: number[];
	dollar: boolean;
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
	const result = { ...previous, templates: [...previous.templates] };
	let current: JavaScriptLexicalState = result;
	while (current.fallback) {
		current.fallback = { ...current.fallback, templates: [...current.fallback.templates] };
		current = current.fallback;
	}
	return result;
}

function regexContext(value: string | undefined) {
	return value === undefined || operators.has(value) && value !== '++' && value !== '--' ||
		value === '${' || '([{,;:'.includes(value) || regexKeywords.has(value);
}

function enclosedBoundary(state: JavaScriptLexicalState, ch: string): boolean {
	if (state.mode === 'line') {
		if (ch !== '\n' && ch !== '\r') return false;
		state.mode = 'code';
		return ch === '\n' && !state.templates.length;
	}
	if (state.mode === 'block') {
		if (state.star && ch === '/') { state.mode = 'code'; state.star = false; }
		else state.star = ch === '*';
		return false;
	}
	if (state.mode === 'regex') return regexBoundary(state, ch);
	if (state.mode === 'template') return templateBoundary(state, ch);
	if (state.escape) state.escape = false;
	else if (ch === '\\') state.escape = true;
	else if (ch === state.quote || state.mode === 'string' && (ch === '\n' || ch === '\r')) {
		state.mode = 'code'; state.regexAllowed = false;
		return ch === '\n' && !state.templates.length;
	}
	return false;
}

function templateBoundary(state: JavaScriptLexicalState, ch: string): boolean {
	if (!state.escape && state.dollar && ch === '{') {
		state.templates[state.templates.length - 1] = 0;
		state.mode = 'code'; state.regexAllowed = true; state.dollar = false;
		return false;
	}
	state.dollar = !state.escape && ch === '$';
	if (state.escape) state.escape = false;
	else if (ch === '\\') state.escape = true;
	else if (ch === '`') {
		state.templates.pop(); state.mode = 'code'; state.regexAllowed = false;
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
						templates: [...state.templates], dollar: state.dollar,
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
				if (ch === '\n') return !state.templates.length;
				if (' \t\r'.includes(ch)) return false;
				if (identifierPart(ch)) { state.mode = 'word'; state.word = ch; }
				else if (ch === '/') state.mode = 'slash';
				else if (ch === '"' || ch === "'" || ch === '`') {
					state.quote = ch; state.escape = false; state.mode = ch === '`' ? 'template' : 'string';
					if (ch === '`') { state.templates.push(-1); state.dollar = false; }
				} else if (operators.has(ch)) { state.mode = 'operator'; state.word = ch; }
				else {
					if (templateBrace(state.templates, ch)) {
						state.mode = 'template'; state.escape = state.dollar = false;
					}
					state.regexAllowed = regexContext(ch);
				}
				return false;
		}
	}
}

type JsxContext =
	| { mode: 'code'; depth: number; regex: boolean; templates: number[] }
	| { mode: 'tag'; closing: boolean; name: boolean; types: number }
	| { mode: 'text' };

interface JsxState {
	contexts: JsxContext[];
	pending: string;
	start: number;
	line: number;
}

type JsxKind = 'tag' | 'attribute' | 'text' | 'jsx-open' | 'jsx-close';

function jsxStart(source: string, start: number, final: boolean): boolean | undefined {
	const value = source.slice(start + 1);
	if (value.startsWith('>')) return true;
	const name = /^[A-Za-z_$][\w$.:-]*/.exec(value)?.[0];
	if (!name) return !value && !final ? undefined : false;
	const rest = value.slice(name.length);
	if (!rest) return final ? true : undefined;
	if (rest.startsWith(',')) return false;
	if (/^\s+extends(?:\s|$)/.test(rest)) {
		const constraint = rest.trimStart().slice('extends'.length).trimStart();
		if (!constraint && !final) return undefined;
		return /^[=/>]/.test(constraint);
	}
	if (!final && /^\s+[\w$]*$/.test(rest)) return undefined;
	return /^[\s/<>]/.test(rest);
}

function* scanJsx<ExtraKind extends 'type'>(
	source: string,
	contexts: JsxContext[],
	classify: (word: string) => IdentifierHighlightKind | ExtraKind,
	final: boolean,
): Generator<Token<ScannerKind | ExtraKind | JsxKind>, number> {
	type JsxToken = Token<ScannerKind | ExtraKind | JsxKind>;
	let index = 0;
	function token(kind: ScannerKind | ExtraKind | JsxKind, end: number) {
		const result = { kind, source, start: index, end, line: 0 };
		index = end;
		return result;
	}
	function expression() {
		return { mode: 'code' as const, depth: 0, regex: true, templates: [] };
	}
	function finishTag() {
		contexts.pop();
		const parent = contexts.at(-1);
		if (parent?.mode === 'code') parent.regex = false;
	}
	function incomplete(next: JsxToken, regex: boolean) {
		return !final && (next.end === source.length || next.kind === 'operator' &&
			source.charAt(next.start) === '/' && regex && !/[\r\n]/.test(source.slice(next.start)));
	}
	function updateCode(context: Extract<JsxContext, { mode: 'code' }>, value: string) {
		if (value === '{' || value === '${') context.depth++;
		else if (value === '}') {
			if (!context.depth && contexts.length > 1) contexts.pop();
			else context.depth = Math.max(0, context.depth - 1);
		}
		context.regex = regexContext(value);
	}
	function* code(context: Extract<JsxContext, { mode: 'code' }>): Generator<JsxToken, boolean> {
		const offset = index;
		const templates = [...context.templates];
		const scanner = createScanner(classify, context.regex, false, templates)(source.slice(offset));
		while (context === contexts.at(-1)) {
			const scanned = scanner.next();
			if (scanned.kind === 'eof') { index = source.length; return true; }
			const next = { ...scanned, kind: scanned.kind, start: scanned.start + offset, end: scanned.end + offset, source };
			index = next.start;
			const value = source.slice(next.start, next.end);
			if (incomplete(next, context.regex)) return false;
			if (next.kind === 'operator' && value === '<' && context.regex) {
				const opening = jsxStart(source, index, final);
				if (opening === undefined) return false;
				if (opening) {
					contexts.push({ mode: 'tag', closing: false, name: true, types: 0 });
					next.kind = 'punctuation';
				}
			}
			if (templates.length || context.templates.length) context.templates = [...templates];
			if (next.kind === 'template') context.regex = false;
			else if (next.kind !== 'comment') updateCode(context, value);
			index = next.end;
			yield next;
		}
		return true;
	}
	function* text(): Generator<JsxToken, boolean> {
		const ch = source.charAt(index);
		if (ch === '<') {
			if (index + 1 === source.length && !final) return false;
			const closing = source.charAt(index + 1) === '/';
			if (closing) contexts.pop();
			contexts.push({ mode: 'tag', closing, name: true, types: 0 });
			yield token(closing ? 'jsx-close' : 'punctuation', index + (closing ? 2 : 1));
		} else if (ch === '{') {
			contexts.push(expression());
			yield token('punctuation', index + 1);
		} else {
			let end = index;
			while (end < source.length && source.charAt(end) !== '<' && source.charAt(end) !== '{') {
				if (source.charAt(end++) === '\n') break;
			}
			if (end === source.length && !final && source.charAt(end - 1) !== '\n') return false;
			yield token('text', end);
		}
		return true;
	}
	function* types(context: Extract<JsxContext, { mode: 'tag' }>): Generator<JsxToken, boolean> {
		const ch = source.charAt(index);
		if (ch === '<' || ch === '>') {
			context.types += ch === '<' ? 1 : -1;
			yield token('operator', index + 1);
		} else {
			const next = createScanner(classify)(source.slice(index)).next();
			if (!final && index + next.end === source.length) return false;
			yield token(next.kind === 'eof' ? 'text' : next.kind, index + next.end);
		}
		return true;
	}
	function* name(context: Extract<JsxContext, { mode: 'tag' }>): Generator<JsxToken, boolean> {
		const value = /^[\w$.:-]+/.exec(source.slice(index))?.[0];
		if (!final && index + (value?.length ?? 1) === source.length) return false;
		const kind = value ? context.name ? 'tag' : 'attribute' : source.charAt(index) === '=' ? 'operator' : 'punctuation';
		if (value) context.name = false;
		yield token(kind, index + (value?.length ?? 1));
		return true;
	}
	function* tag(context: Extract<JsxContext, { mode: 'tag' }>): Generator<JsxToken, boolean> {
		const ch = source.charAt(index);
		if (/\s/.test(ch)) { index++; return true; }
		if (context.types) return yield* types(context);
		if (ch === '>') {
			if (context.closing) finishTag();
			else contexts.splice(contexts.length - 1, 1, { mode: 'text' });
			yield token(context.closing ? 'punctuation' : 'jsx-open', index + 1);
		} else if (ch === '/' && source.charAt(index + 1) === '>') {
			finishTag();
			yield token('punctuation', index + 2);
		} else if (ch === '<') {
			context.types++;
			yield token('operator', index + 1);
		} else if (ch === '{') {
			contexts.push(expression());
			yield token('punctuation', index + 1);
		} else if (ch === '"' || ch === "'") {
			const closing = source.indexOf(ch, index + 1);
			if (closing < 0 && !final) return false;
			yield token('string', closing < 0 ? source.length : closing + 1);
		} else return yield* name(context);
		return true;
	}
	while (index < source.length) {
		const context = contexts.at(-1);
		if (!context) return index;
		const complete = yield* (context.mode === 'code' ? code(context) : context.mode === 'text' ? text() : tag(context));
		if (!complete) return index;
	}
	return index;
}

function createJsxHighlighter<ExtraKind extends 'type'>(classify: (word: string) => IdentifierHighlightKind | ExtraKind) {
	return createHighlighter((): JsxState => ({
		contexts: [{ mode: 'code', depth: 0, regex: true, templates: [] }], pending: '', start: 0, line: 0,
	}), function* (window, previous) {
		const state = { ...previous, contexts: previous.contexts.map(context => context.mode === 'code' ? { ...context, templates: [...context.templates] } : { ...context }) };
		const source = state.pending + window.text;
		let end = 0;
		function* tokens() {
			end = yield* scanJsx(source, state.contexts, classify, window.final);
		}
		yield* highlightTokens({ ...window, text: source, start: state.start, line: state.line }, tokens(),
			token => token.kind === 'jsx-open' || token.kind === 'jsx-close' ? 'punctuation' : token.kind,
			undefined, token => token.kind === 'jsx-open' ? [1, 0] : token.kind === 'jsx-close' ? [0, 1] : javaScriptFold(token));
		state.pending = source.slice(end);
		state.start += end;
		for (let index = 0; index < end; index++) if (source.charAt(index) === '\n') state.line++;
		return { state, committed: state.start };
	}, (state, shift) => ({ ...state, start: state.start + shift.offset, line: state.line + shift.line }));
}

function javaScriptFold(token: HighlightToken): readonly [number, number] {
	return token.highlight === 'punctuation' && token.end - token.start === 2 && token.source.slice(token.start, token.end) === '${'
		? [1, 0] : foldToken(token);
}

export function createJavaScriptHighlighter<ExtraKind extends 'type' = never>(
	classify: (word: string) => IdentifierHighlightKind | ExtraKind,
	options?: JavaScriptHighlightOptions,
): Highlighter {
	if (options?.jsx) return createJsxHighlighter(classify);
	const initial = (): JavaScriptHighlightState => ({
		buffer: { start: 0, line: 0, fragment: undefined }, mode: 'code', quote: '', escape: false,
		characterClass: false, star: false, word: '', regexAllowed: true, regex: true, fallback: undefined, templates: [], dollar: false,
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
			}, undefined, javaScriptFold);
			state.regexAllowed = state.regex;
		}
	}
	return createHighlighter(initial, (window, previous) => {
		if (window.final && !previous.buffer.fragment)
			return highlightTokens(window, each(createScanner(classify, previous.regex, window.start !== 0)(window.text).next),
				token => token.kind === 'eof' ? 'text' : token.kind,
				{ state: previous, committed: window.start + window.text.length }, javaScriptFold);
		return scan(window, previous);
	}, (state, shift) => ({ ...state, buffer: shiftHighlightBuffer(state.buffer, shift) }));
}
