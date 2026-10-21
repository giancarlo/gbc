import {
	createHighlighter, enrichHighlightToken, highlightSegments, shiftHighlightBuffer,
	type HighlightBuffer, type HighlightKind, type HighlightOptions, type HighlightWindow,
} from '@cxl/gbc.sdk';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';

const keywords = new Set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const literals = new Set(['True', 'False', 'None']);
const identifier = /[_\p{XID_Start}][_\p{XID_Continue}]*/uy;
const digits = String.raw`\d(?:_?\d)*`;
const decimal = `(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?[jJ]?`;
const number = new RegExp(`0[xX](?:_?[\\da-fA-F])+|0[bB](?:_?[01])+|0[oO](?:_?[0-7])+|${decimal}`, 'y');
const stringStart = /(?:br|rb|fr|rf|tr|rt|[rubft])?("""|'''|"|')/iy;
const operator = /(?:\*\*|\/\/|<<|>>|[+\-*/%@&|^])=|\*\*|\/\/|<<|>>|:=|==|!=|<=|>=|->|[+\-*/%@&|^~<>=]/y;

interface PythonState {
	buffer: HighlightBuffer;
	mode: 'code' | 'comment' | 'open' | 'single' | 'triple';
	quote: string;
	count: number;
	escape: boolean;
}

function boundary(state: PythonState, ch: string): boolean {
	if (state.mode === 'comment') {
		if (ch === '\n') state.mode = 'code';
	} else if (state.mode === 'open' && ch === state.quote) {
		if (++state.count === 3) { state.mode = 'triple'; state.count = 0; }
	} else {
		if (state.mode === 'open') state.mode = state.count === 2 ? 'code' : 'single';
		if (state.mode === 'code') {
			if (ch === '#') state.mode = 'comment';
			else if (ch === '"' || ch === "'") {
				state.mode = 'open'; state.quote = ch; state.count = 1;
			}
		} else if (state.escape) {
			if (ch !== '\r') state.escape = false;
		} else if (ch === '\\') {
			state.escape = true; state.count = 0;
		} else if (state.mode === 'single') {
			if (ch === state.quote || ch === '\n' || ch === '\r') state.mode = 'code';
		} else if (ch === state.quote) {
			if (++state.count === 3) { state.mode = 'code'; state.count = 0; }
		} else state.count = 0;
	}
	return ch === '\n' && state.mode === 'code';
}

function match(pattern: RegExp, source: string, index: number) {
	pattern.lastIndex = index;
	return pattern.exec(source);
}

function stringEnd(source: string, index: number, line: number, delimiter: string) {
	while (index < source.length) {
		if (source.startsWith(delimiter, index)) return { index: index + delimiter.length, line, closed: true };
		const ch = source.charAt(index);
		if (delimiter.length === 1 && (ch === '\n' || ch === '\r')) break;
		if (ch === '\n') line++;
		index++;
		if (ch === '\\' && index < source.length) {
			if (source.charAt(index) === '\r' && source.charAt(index + 1) === '\n') index++;
			if (source.charAt(index) === '\n') line++;
			index++;
		}
	}
	return { index, line, closed: false };
}

function lexeme(source: string, index: number): [HighlightKind, number] {
	const numeric = match(number, source, index);
	if (numeric) return ['number', numeric[0].length];
	const name = match(identifier, source, index)?.[0];
	if (name) return [literals.has(name) ? 'literal' : keywords.has(name) ? 'keyword' : 'identifier', name.length];
	const op = match(operator, source, index);
	if (op) return ['operator', op[0].length];
	if (source.startsWith('...', index)) return ['punctuation', 3];
	const ch = source.charAt(index);
	if ('()[]{}:;,.'.includes(ch)) return ['punctuation', 1];
	return [ch === '\\' && /^\r?\n/.test(source.slice(index + 1)) ? 'text' : 'error', 1];
}

function* scan(window: HighlightWindow) {
	const source = window.text;
	let index = 0;
	let line = window.line;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (/\s/.test(ch)) {
			if (ch === '\n') line++;
			index++;
			continue;
		}
		const start = index;
		const startLine = line;
		let kind: HighlightKind;
		const opening = match(stringStart, source, index);
		if (opening) {
			const result = stringEnd(source, index + opening[0].length, line, opening[1] ?? '"');
			index = result.index; line = result.line;
			kind = result.closed ? 'string' : 'error';
		} else if (ch === '#') {
			while (index < source.length && !'\r\n'.includes(source.charAt(index))) index++;
			kind = 'comment';
		} else {
			const token = lexeme(source, index);
			kind = token[0]; index += token[1];
		}
		const token = enrichHighlightToken(Object.assign(window.position(window.start + start, window.start + index, startLine), { kind }), kind);
		if (kind === 'punctuation') {
			token.foldStart = Number('([{'.includes(ch));
			token.foldEnd = Number(')]}'.includes(ch));
		} else if (kind === 'string' && line > startLine) token.foldStart = token.foldEnd = 1;
		yield token;
	}
}

export const highlight = (_options?: HighlightOptions) => createHighlighter((): PythonState => ({
	buffer: { start: 0, line: 0, fragment: undefined }, mode: 'code', quote: '', count: 0, escape: false,
}), function* (window, previous) {
	const state = { ...previous };
	const segments = highlightSegments(window, state.buffer, ch => boundary(state, ch), true);
	for (;;) {
		const next = segments.next();
		if (next.done) { state.buffer = next.value; return { state, committed: state.buffer.start }; }
		yield* scan(next.value);
	}
}, (state, shift) => ({ ...state, buffer: shiftHighlightBuffer(state.buffer, shift) }));
