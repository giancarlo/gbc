import {
	createHighlighter, enrichHighlightToken, highlightSegments, shiftHighlightBuffer,
	type HighlightBuffer, type HighlightKind, type HighlightOptions, type HighlightWindow,
} from '@cxl/gbc.sdk';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';

const keywords = new Set('break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var'.split(' '));
const literals = new Set(['true', 'false', 'nil', 'iota']);
const types = new Set('any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr'.split(' '));
const identifier = /[_\p{L}][_\p{L}\p{Nd}]*/uy;
const digits = String.raw`\d(?:_?\d)*`;
const hex = String.raw`[\da-fA-F](?:_?[\da-fA-F])*`;
const exponent = `[eE][+-]?${digits}`;
const number = new RegExp(`(?:0[xX]_?(?:${hex}(?:\\.(?:${hex})?)?|\\.${hex})[pP][+-]?${digits}|0[xX]_?${hex}|0[bB]_?[01](?:_?[01])*|0[oO]_?[0-7](?:_?[0-7])*|(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:${exponent})?)i?`, 'y');
const operator = /<<=|>>=|&\^=|<<|>>|&\^|&&|\|\||<-|\+\+|--|:=|[+\-*/%&|^!=<>]=|[+\-*/%&|^!<>=~]/y;

interface GoState {
	buffer: HighlightBuffer;
	mode: 'code' | 'slash' | 'comment' | 'block' | 'string';
	quote: string;
	previous: string;
	escape: boolean;
}

function boundary(state: GoState, ch: string): boolean {
	if (state.mode === 'slash') {
		state.mode = ch === '/' ? 'comment' : ch === '*' ? 'block' : 'code';
		if (state.mode !== 'code') { state.previous = ''; return false; }
	}
	if (state.mode === 'comment') {
		if (ch === '\n') state.mode = 'code';
	} else if (state.mode === 'block') {
		if (state.previous === '*' && ch === '/') { state.mode = 'code'; state.previous = ''; }
		else state.previous = ch;
	} else if (state.mode === 'string') {
		if (state.quote === '`') {
			if (ch === '`') state.mode = 'code';
		} else if (ch === '\n' || ch === '\r') { state.mode = 'code'; state.escape = false; }
		else if (state.escape) state.escape = false;
		else if (ch === '\\') state.escape = true;
		else if (ch === state.quote) state.mode = 'code';
	} else if (ch === '/') state.mode = 'slash';
	else if ('"\'`'.includes(ch)) { state.mode = 'string'; state.quote = ch; }
	return ch === '\n' && state.mode === 'code';
}

function match(pattern: RegExp, source: string, index: number) {
	pattern.lastIndex = index;
	return pattern.exec(source)?.[0];
}

function stringEnd(source: string, index: number, quote: string) {
	while (index < source.length) {
		const ch = source.charAt(index);
		if (quote !== '`' && (ch === '\n' || ch === '\r')) break;
		index++;
		if (ch === quote) return { index, closed: true };
		if (quote !== '`' && ch === '\\' && index < source.length && !'\r\n'.includes(source.charAt(index))) index++;
	}
	return { index, closed: false };
}

function lexeme(source: string, index: number): [HighlightKind, number] {
	const numeric = match(number, source, index);
	if (numeric) return ['number', numeric.length];
	const name = match(identifier, source, index);
	if (name) return [literals.has(name) ? 'literal' : keywords.has(name) ? 'keyword' : types.has(name) ? 'type' : 'identifier', name.length];
	const op = match(operator, source, index);
	if (op) return ['operator', op.length];
	if (source.startsWith('...', index)) return ['punctuation', 3];
	const ch = source.charAt(index);
	if ('()[]{}:;,.'.includes(ch)) return ['punctuation', 1];
	return ['error', String.fromCodePoint(source.codePointAt(index) ?? 0).length];
}

function* scan(window: HighlightWindow) {
	const source = window.text;
	let index = 0;
	let line = window.line;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (' \t\r\n'.includes(ch) || (window.start + index === 0 && ch === '\uFEFF')) {
			if (ch === '\n') line++;
			index++;
			continue;
		}
		const start = index;
		const startLine = line;
		let kind: HighlightKind;
		if (source.startsWith('//', index)) {
			while (index < source.length && source.charAt(index) !== '\n') index++;
			kind = 'comment';
		} else if (source.startsWith('/*', index)) {
			const end = source.indexOf('*/', index + 2);
			index = end < 0 ? source.length : end + 2;
			kind = end < 0 ? 'error' : 'comment';
		} else if ('"\'`'.includes(ch)) {
			const result = stringEnd(source, index + 1, ch);
			index = result.index;
			kind = result.closed ? 'string' : 'error';
		} else {
			const token = lexeme(source, index);
			kind = token[0]; index += token[1];
		}
		for (let pos = start; pos < index; pos++) if (source.charAt(pos) === '\n') line++;
		const token = enrichHighlightToken(Object.assign(window.position(window.start + start, window.start + index, startLine), { kind }), kind);
		if (kind === 'punctuation') {
			token.foldStart = Number('([{'.includes(ch));
			token.foldEnd = Number(')]}'.includes(ch));
		} else if ((kind === 'string' || kind === 'comment') && line > startLine) token.foldStart = token.foldEnd = 1;
		yield token;
	}
}

export const highlight = (_options?: HighlightOptions) => createHighlighter((): GoState => ({
	buffer: { start: 0, line: 0, fragment: undefined }, mode: 'code', quote: '', previous: '', escape: false,
}), function* (window, previous) {
	const state = { ...previous };
	const segments = highlightSegments(window, state.buffer, ch => boundary(state, ch), true);
	for (;;) {
		const next = segments.next();
		if (next.done) { state.buffer = next.value; return { state, committed: state.buffer.start }; }
		yield* scan(next.value);
	}
}, (state, shift) => ({ ...state, buffer: shiftHighlightBuffer(state.buffer, shift) }));
