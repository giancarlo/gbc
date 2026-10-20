import { tokenize, createHighlighter, shiftHighlightBuffer, highlightTokens, highlightSegments, foldToken, text, type HighlightOptions, type ScannerContext, type HighlightKind, type HighlightBuffer, type HighlightWindow } from '@cxl/gbc.sdk';
import { keywords, scanHighlight, highlightHereDocuments } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';
const keywordWords = new Set(keywords);
const punctuation: ReadonlySet<string> = new Set(['(', ')', '{', '}', ';', ',', '...']);

const classify = (token: ReturnType<ReturnType<typeof scanHighlight>['next']>): HighlightKind => {
	if (punctuation.has(token.kind)) return 'punctuation';
	switch (token.kind) {
		case 'comment':
			return 'comment';
		case 'heredoc':
			return 'string';
		case 'newline':
			return 'text';
		case 'word': {
			const value = text(token);
			if (keywordWords.has(value)) return 'keyword';
			if (value.startsWith('"') || value.startsWith("'")) return 'string';
			if (/^\d+(\.\d+)?$/.test(value)) return 'number';
			return 'identifier';
		}
		default:
			return 'operator';
	}
};

const separators = new Set(['newline', ';', '&', '|', '&&', '||']);
const redirects = new Set(['>', '>>', '<', '<>', '>|', '<<', '<<-', '<&', '>&']);
const commandPrefixes = new Set(['if', 'then', 'elif', 'else', 'do']);

interface ShellFrame {
	kind: string;
	escape: boolean;
	ansi: boolean;
	last: string;
}

interface ShellState {
	scanner: ScannerContext;
	buffer: HighlightBuffer;
	frames: ShellFrame[];
	escape: boolean;
	word: boolean;
	comment: boolean;
	last: string;
	probe: 'start' | 'dot' | 'dots' | 'rest' | 'name' | 'optional' | 'space' | undefined;
	header: string;
	line: string;
	documents: { delimiter: string; stripTabs: boolean }[];
	commandStart: boolean;
	redirectTarget: boolean;
	commandName: boolean;
	parentheses: boolean[];
}

function signatureProbe(state: ShellState, ch: string) {
	const mode = state.probe;
	if (mode === undefined) return;
	if (' \t\r\n'.includes(ch)) {
		if (mode === 'name' || mode === 'optional') state.probe = 'space';
		return;
	}
	if ((mode === 'start' || mode === 'rest') && /[A-Za-z_]/.test(ch)) state.probe = 'name';
	else if (mode === 'name' && /\w/.test(ch)) return;
	else if (mode === 'name' && ch === '?') state.probe = 'optional';
	else if (mode === 'start' && ch === '.') state.probe = 'dot';
	else if (mode === 'dot' && ch === '.') state.probe = 'dots';
	else if (mode === 'dots' && ch === '.') state.probe = 'rest';
	else state.probe = undefined;
}

function documentBoundary(state: ShellState, ch: string): boolean {
	const document = state.documents[0];
	if (!document) return false;
	if (ch === '\n') {
		if (state.line.replace(/\r$/, '') === document.delimiter) state.documents.shift();
		state.line = '';
		return state.documents.length === 0;
	}
	if (!(document.stripTabs && !state.line && ch === '\t') && state.line.length <= document.delimiter.length + 1) state.line += ch;
	return false;
}

function frameBoundary(state: ShellState, frame: ShellFrame, ch: string) {
	if (frame.escape) { frame.escape = false; frame.last = ''; return; }
	else if (ch === '\\' && (frame.kind !== "'" || frame.ansi)) frame.escape = true;
	else if (ch === frame.kind) state.frames.pop();
	else if (frame.kind === ')' || frame.kind === '}') {
		if (ch === '"' || ch === "'") state.frames.push({ kind: ch, escape: false, ansi: frame.last === '$', last: '' });
		else if (ch === (frame.kind === ')' ? '(' : '{')) state.frames.push({ kind: frame.kind, escape: false, ansi: false, last: '' });
	} else if (frame.kind === '"' && frame.last === '$' && ch === '(')
		state.frames.push({ kind: ')', escape: false, ansi: false, last: '' });
	frame.last = ch;
}

function boundary(state: ShellState, ch: string): boolean {
	if (state.documents.length) return documentBoundary(state, ch);
	state.header += ch;
	const frame = state.frames.at(-1);
	if (frame) { frameBoundary(state, frame, ch); return false; }

	if (state.escape) { state.escape = false; state.last = ''; return false; }
	if (state.comment && ch !== '\n') return false;
	if (ch === '\n') {
		state.comment = false;
		state.word = false;
		state.last = '';
		signatureProbe(state, ch);
		if (state.probe !== undefined) return false;
		state.documents = highlightHereDocuments(state.header);
		state.header = '';
		return state.documents.length === 0;
	}
	wordBoundary(state, ch);
	return false;
}

function wordBoundary(state: ShellState, ch: string) {
	signatureProbe(state, ch);
	if (ch === '\\') { state.escape = true; state.word = true; }
	else if (ch === '#' && !state.word) state.comment = true;
	else if (ch === '"' || ch === "'" || ch === '`') {
		state.frames.push({ kind: ch, escape: false, ansi: state.last === '$', last: '' }); state.word = true;
	} else if (ch === '(' && '$<>'.includes(state.last) && state.last) {
		state.frames.push({ kind: ')', escape: false, ansi: false, last: '' }); state.word = true;
	}
	else if (ch === '{' && state.last === '$') state.frames.push({ kind: '}', escape: false, ansi: false, last: '' });
	else if (ch === '(') { state.probe = 'start'; state.word = false; }
	else state.word = !' \t\r();&|<>'.includes(ch) && (state.word || ch !== '{' && ch !== '}');
	state.last = ch;
}

export const highlight = (_options?: HighlightOptions) => createHighlighter((): ShellState => ({
	scanner: { line: 0, endLine: 0 }, buffer: { start: 0, line: 0, fragment: undefined }, frames: [], escape: false, word: false, comment: false,
	last: '', probe: undefined, header: '', line: '', documents: [],
	commandStart: true, redirectTarget: false, commandName: false, parentheses: [],
}), function* (window, previous) {
	const state = { ...previous, scanner: { ...previous.scanner }, frames: previous.frames.map(frame => ({ ...frame })), documents: [...previous.documents], parentheses: [...previous.parentheses] };
	const segments = highlightSegments(window, state.buffer, ch => boundary(state, ch));
	for (;;) {
		const next = segments.next();
		if (next.done) { state.buffer = next.value; return { state, committed: state.buffer.start }; }
		yield* highlightCommand(next.value, state);
	}
}, (state, shift) => ({
	...state, buffer: shiftHighlightBuffer(state.buffer, shift),
}));

function* highlightCommand(window: HighlightWindow, state: ShellState) {
	let { commandStart, redirectTarget, commandName } = state;
	const { parentheses } = state;
	const source = window.text;
	for (const token of highlightTokens(window, tokenize(source => scanHighlight(source, state.scanner), window.text), classify, undefined, foldToken, 0)) {
		if (token.kind === 'tokenizer-error') token.error.position.line = window.line + source.slice(0, token.error.position.start - window.start).split('\n').length - 1;
		const kind = token.kind;
		if (kind === '(') {
			const signature = commandName && /^(?:$|\)|(?:\.\.\.[ \t\r\n]*)?[A-Za-z_]\w*\??[ \t\r\n]*:)/.test(source.slice(token.end - window.start).trimStart());
			const block = !signature && parentheses.at(-1) !== false;
			parentheses.push(block);
			token.foldStart = Number(block);
			commandStart = block;
			redirectTarget = commandName = false;
		} else if (kind === ')') {
			const block = parentheses.pop();
			token.foldEnd = Number(block === true);
			commandStart = block === false;
			commandName = false;
		} else if (parentheses.at(-1) === false) {
			yield token;
			continue;
		} else if (separators.has(kind) || kind === '{') {
			commandStart = true;
			redirectTarget = commandName = false;
		} else if (redirects.has(kind)) redirectTarget = true;
		else if (kind === 'word') {
			const value = source.slice(token.start - window.start, token.end - window.start);
			commandName = false;
			if (redirectTarget) redirectTarget = false;
			else if (commandStart && !(/^\d+$/.test(value) && /[<>]/.test(source.charAt(token.end - window.start)))) {
				if (value === 'if' || value === 'for') token.foldStart = 1;
				else if (value === 'fi' || value === 'done') token.foldEnd = 1;
				commandStart = commandPrefixes.has(value) || /^[A-Za-z_]\w*=/.test(value);
				commandName = !commandStart;
			}
		} else if (kind === '}') commandStart = commandName = false;
		yield token;
	}
	Object.assign(state, { commandStart, redirectTarget, commandName });
}
