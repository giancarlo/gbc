import { tokenize, matchers, createHighlighter, shiftHighlightBuffer, highlightTokens, highlightSegments, foldToken, type ScannerContext, type HighlightKind, type HighlightToken, type HighlightBuffer } from '@cxl/gbc.sdk';
import { keywords, scan, type ScannerToken } from './scanner.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const keywordKinds: ReadonlySet<string> = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set('{}()[],;');

const classify = (token: ScannerToken): HighlightKind => {
	const kind = token.kind;
	if (keywordKinds.has(kind)) return 'keyword';
	if (punctuation.has(kind)) return 'punctuation';
	switch (kind) {
		case 'ident':
			return 'identifier';
		case 'number':
		case 'float':
			return 'number';
		case 'string':
		case 'strhead':
		case 'strmid':
		case 'strtail':
			return 'string';
		case '#test':
		case '#importmap':
			return 'directive';
		default:
			return 'operator';
	}
};

const fold = (token: ScannerToken & HighlightToken): readonly [number, number] => {
	switch (token.kind) {
		case 'strhead': return [1, 0];
		case 'strmid': return [1, 1];
		case 'strtail': return [0, 1];
		default: return foldToken(token);
	}
};

interface GbState {
	scanner: ScannerContext;
	buffer: HighlightBuffer;
	braces: number[];
	quote: boolean;
	directive: string | undefined;
	invalidDirective: boolean;
	slashes: number;
	dollar: boolean;
	context: number[];
	word: boolean;
	number: string | undefined;
	member: boolean;
	previousCharacter: string;
}

function directiveBoundary(state: GbState, ch: string): boolean | undefined {
	if (state.invalidDirective) {
		if (ch !== '\n') return false;
		state.invalidDirective = false;
		return true;
	}
	if (state.directive === undefined) {
		if (!state.quote && ch === '#') { state.directive = ''; return false; }
		return undefined;
	}
	if (matchers.ident(ch)) { state.directive = (state.directive + ch).slice(0, 16); return false; }
	state.invalidDirective = state.directive !== 'test' && state.directive !== 'importmap';
	state.directive = undefined;
	return state.invalidDirective ? directiveBoundary(state, ch) : undefined;
}

function consumesDelimiter(prefix: string, ch: string, member: boolean): boolean {
	for (const token of tokenize(source => scan(source, [], undefined, member ? '.' : ''), prefix + ch))
		if (token.end >= prefix.length) return token.end > prefix.length;
	return false;
}

function codeBoundary(state: GbState, ch: string): boolean | undefined {
	if (state.number !== undefined) {
		if (matchers.ident(ch) || '.+-'.includes(ch)) { state.number += ch; return false; }
		const consumed = consumesDelimiter(state.number, ch, state.member);
		state.number = undefined;
		if (consumed) return ch === '\n';
	}
	if (!state.quote) {
		if (state.word && matchers.ident(ch)) return false;
		state.word = false;
		if (matchers.alpha(ch) && state.directive === undefined && !state.invalidDirective) { state.word = true; return false; }
		if (matchers.digit(ch) && state.directive === undefined && !state.invalidDirective) {
			state.number = ch; state.member = state.previousCharacter === '.'; return false;
		}
	}

	return undefined;
}

function lexicalBoundary(state: GbState, ch: string): boolean {
	const code = codeBoundary(state, ch);
	if (code !== undefined) return code;
	const directive = directiveBoundary(state, ch);
	if (directive !== undefined) return directive;
	if (state.quote) {
		const escaped = state.slashes === 1;
		state.slashes = ch === '\\' ? Math.min(2, state.slashes + 1) : 0;
		if (!escaped && ch === "'") state.quote = false;
		else if (state.dollar && ch === '{') { state.braces.push(0); state.quote = false; }
		state.dollar = ch === '$' && !escaped;
	} else if (ch === "'") { state.quote = true; state.dollar = false; state.slashes = 0; }
	else if (ch === '{' && state.braces.length) state.braces[state.braces.length - 1] = (state.braces.at(-1) ?? 0) + 1;
	else if (ch === '}' && state.braces.length) {
		const depth = state.braces.pop() ?? 0;
		if (depth) state.braces.push(depth - 1);
		else state.quote = true;
	}
	return ch === '\n' && !state.quote;
}

export const highlight = createHighlighter((): GbState => ({
	scanner: { line: 0, endLine: 0 }, buffer: { start: 0, line: 0, fragment: undefined }, braces: [], quote: false, directive: undefined, invalidDirective: false, slashes: 0, dollar: false, context: [], word: false, number: undefined, member: false, previousCharacter: '',
}), function* (window, previous) {
	const state = { ...previous, scanner: { ...previous.scanner }, braces: [...previous.braces], context: [...previous.context] };
	const segments = highlightSegments(window, state.buffer, ch => {
		const result = lexicalBoundary(state, ch);
		state.previousCharacter = ch;
		return result;
	});
	for (;;) {
		const next = segments.next();
		if (next.done) {
			state.buffer = next.value;
			return { state, committed: state.buffer.start };
		}
		yield* highlightTokens(next.value, tokenize(source => scan(source, state.context, state.scanner), next.value.text), classify, undefined, fold, 0);
	}
}, (state, shift) => ({
	...state, buffer: shiftHighlightBuffer(state.buffer, shift),
	scanner: { line: state.scanner.line + shift.line, endLine: state.scanner.endLine + shift.line },
}));
