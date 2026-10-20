import {
	tokenize,
	createHighlighter, shiftHighlightBuffer,
	highlightToken,
	highlightSegments,
	type HighlightWindow,
	type HighlightBuffer,
	enrichHighlightToken,
	foldToken,
	type HighlightKind,
	type HighlightToken,
	type TokenizerError,
	type Highlighter,
	type HighlightCheckpoint,
	type HighlightSource,
	type HighlightOptions,
	type LanguageResolver,
} from '@cxl/gbc.sdk';
import { scannerBlock, scannerInline } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';

interface EmbeddedFence {
	highlighter: Highlighter;
	checkpoint: HighlightCheckpoint<unknown> | undefined;
	start: number;
	line: number;
	version: string | number;
	folds: number;
}

interface MarkdownState {
	buffer: HighlightBuffer;
	text: string;
	start: number;
	line: number;
	mode: 'normal' | 'eol' | 'fence' | 'html' | 'link' | undefined;
	marker: string;
	closing: string;
	label: boolean;
	linkUrl: boolean;
	linkTitle: string;
	linkDone: boolean;
	pending: HighlightToken | undefined;
	indented: boolean;
	sections: number[];
	embedded: EmbeddedFence | undefined;
}

function blockMode(state: MarkdownState) {
	const end = state.text.indexOf('\n');
	const first = end < 0 ? state.text : state.text.slice(0, end + 1);
	state.mode = 'normal';
	state.marker = state.closing = '';
	state.label = false;
	state.linkUrl = state.linkDone = false;
	state.linkTitle = '';
	if (/^[ \t]*\n/.test(first)) state.mode = 'eol';
	else {
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(first);
		if (fence?.[1] && (fence[1][0] === '~' || !fence[2]?.includes('`'))) {
			state.mode = 'fence'; state.marker = fence[1];
		} else if (/^ {0,3}<(?:[!?]|\/?[A-Za-z])/.test(first) && !/^ {0,3}<[A-Za-z+-]+[:@]/.test(first)) {
			state.mode = 'html';
			if (/^ {0,3}<!--/.test(first)) state.closing = '-->';
			else if (/^ {0,3}<\?/.test(first)) state.closing = '?>';
			else if (/^ {0,3}<!/.test(first)) state.closing = '>';
			else if (/^ {0,3}<[a-z-]*(?:pre|script|style|textarea)[a-z-]*[ \t>\n/]/i.test(first)) state.closing = '</';
		} else if (/^ {0,3}\[/.test(first)) {
			state.mode = 'link';
			state.label = true;
			state.linkDone = linkReady(state, first.slice(first.indexOf('[') + 1));
		}
	}
	return state.mode;
}

function closingQuote(value: string, quote: string, start = 0) {
	for (let index = start; index < value.length; index++)
		if (value.charAt(index) === quote && (value.charAt(index - 1) !== '\\' || value.charAt(index - 2) === '\\')) return index;
	return -1;
}

function linkReady(state: MarkdownState, line: string): boolean {
	if (/^[ \t]*\n$/.test(line) && !state.label) return true;
	if (state.linkTitle) return closingQuote(line, state.linkTitle) >= 0;
	if (state.label) {
		const close = closingQuote(line, ']');
		if (close < 0) return false;
		if (line.charAt(close + 1) !== ':') return true;
		state.label = false;
		line = line.slice(close + 2);
	}
	const trimmed = line.replace(/^[ \t\n]+/, '');
	if (!trimmed) return false;
	let title = trimmed;
	if (!state.linkUrl) {
		state.linkUrl = true;
		title = /^(?:<[^>\n]*>|[^ \t\n]+)[ \t\n]+(.*)/s.exec(trimmed)?.[1] ?? '';
		if (!title) return false;
	}
	const quote = title.charAt(0);
	if (quote !== '(' && quote !== '"' && quote !== "'") return true;
	state.linkTitle = quote === '(' ? ')' : quote;
	return closingQuote(title, state.linkTitle, 1) >= 0;
}

function ready(state: MarkdownState, line: string): number {
	switch (state.mode) {
		case 'normal': return state.text.length - line.length;
		case 'eol': return /^[ \t]*\n$/.test(line) ? 0 : state.text.length - line.length;
		case 'fence': return closesFence(state.marker, line) ? 1 : 0;
		case 'html':
			if (state.closing === '</') return /<\/[a-z-]*(?:pre|script|style|textarea)[a-z-]*[ \t]*>/i.test(line) ? 1 : 0;
			return state.closing ? (line.includes(state.closing) ? 1 : 0) : (line === '\n' ? 1 : 0);
		case 'link': return state.linkDone || linkReady(state, line) ? 1 : 0;
		default: return 0;
	}
}

export function highlight(options?: HighlightOptions): Highlighter {
	const resolveLanguage = options?.resolveLanguage;
	return createHighlighter((): MarkdownState => ({
		buffer: { start: 0, line: 0, fragment: undefined }, text: '', start: 0, line: 0, mode: undefined,
		marker: '', closing: '', label: false, linkUrl: false, linkTitle: '', linkDone: false, pending: undefined, indented: false, sections: [], embedded: undefined,
	}), function* (window, previous) {
		const state = { ...previous, sections: [...previous.sections], embedded: previous.embedded ? { ...previous.embedded } : undefined };
		if (state.pending) state.pending = highlightToken(window, state.pending);
		const lines = highlightSegments(window, state.buffer, ch => ch === '\n', true);
		for (;;) {
			const next = lines.next();
			if (next.done) { state.buffer = next.value; break; }
			const line = next.value.text;
			if (state.embedded) {
				if (closesFence(state.marker, line)) {
					yield* embeddedBody(window, state, true);
					yield* appendToken(state, Object.assign(window.position(next.value.start, next.value.start + line.length, next.value.line), {
						kind: 'block', highlight: 'code' as const, foldStart: 0, foldEnd: state.embedded.folds + 1,
					}));
					state.embedded = undefined;
					state.mode = undefined;
				}
				state.start = next.value.start + line.length;
				state.line = next.value.line + Number(line.endsWith('\n'));
				continue;
			}
			const opening = state.mode !== 'fence';
			state.text += line;
			let limit = 0;
			if (state.mode === undefined) {
				const mode = blockMode(state);
				if (mode === 'html' && state.closing && state.closing !== '</' && line.includes(state.closing)) limit = 1;
			} else limit = ready(state, line);
			if (limit) yield* flush(window, state, limit);
			if (opening && state.mode === 'fence') yield* openFence(window, state, resolveLanguage);
		}
		yield* embeddedBody(window, state, window.final);
		if (window.final) {
			if (state.text) yield* flush(window, state, Infinity);
			if (state.pending) {
				state.pending.foldEnd += state.sections.length + Number(state.indented) + (state.embedded ? state.embedded.folds + 1 : 0);
				yield state.pending;
				state.pending = undefined;
			}
		}
		return { state, committed: window.final ? window.start + window.text.length : committedBoundary(state) };
	}, (state, shift) => ({
		...state, buffer: shiftHighlightBuffer(state.buffer, shift),
		pending: state.pending ? shift.position(state.pending) : undefined,
		start: state.start + shift.offset, line: state.line + shift.line,
		embedded: state.embedded ? { ...state.embedded, start: state.embedded.start + shift.offset, line: state.embedded.line + shift.line } : undefined,
	}), (left, right, equal) => {
		const { embedded: a, ...restA } = left;
		const { embedded: b, ...restB } = right;
		return equal(restA, restB) && (a && b
			? a.highlighter === b.highlighter && a.folds === b.folds && (a.checkpoint && b.checkpoint
				? a.highlighter.equivalent(a.checkpoint, b.checkpoint)
				: a.checkpoint === b.checkpoint)
			: a === b);
	});
}

function* openFence(window: HighlightWindow, state: MarkdownState, resolveLanguage?: LanguageResolver) {
	const name = state.text.slice(state.text.indexOf(state.marker) + state.marker.length).trim().split(/\s/)[0];
	const highlighter = name ? resolveLanguage?.(name) : undefined;
	if (!highlighter) return;
	if (state.indented && state.pending) state.pending.foldEnd++;
	state.indented = false;
	yield* appendToken(state, Object.assign(window.position(state.start, state.start + state.text.length, state.line), {
		kind: 'block', highlight: 'code' as const, foldStart: 1, foldEnd: 0,
	}));
	state.start += state.text.length;
	state.line += Number(state.text.endsWith('\n'));
	state.text = '';
	state.embedded = { highlighter, checkpoint: undefined, start: state.start, line: state.line, version: window.source.version, folds: 0 };
}

function committedBoundary(state: MarkdownState) {
	return Math.min(state.pending?.start ?? state.start,
		state.embedded ? state.embedded.start + (state.embedded.checkpoint?.committed ?? 0) : state.start);
}

function closesFence(marker: string, line: string) {
	const close = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/.exec(line)?.[1];
	return close !== undefined && close.length >= marker.length && close.charAt(0) === marker.charAt(0);
}

function* appendToken(state: MarkdownState, token: HighlightToken) {
	const previous = state.pending;
	state.pending = token;
	if (previous) yield previous;
}

function* embeddedBody(window: HighlightWindow, state: MarkdownState, final: boolean) {
	const embedded = state.embedded;
	if (!embedded) return;
	const { source } = window;
	const { start, line, checkpoint } = embedded;
	const end = state.start - start;
	if (!final && end === (checkpoint?.offset ?? 0)) return;
	let text: string | undefined;
	const length = final ? end : source.length - start;
	function read(from: number, to: number) {
		if (start + from >= 0) return source.read(start + from, start + to);
		return ' '.repeat(Math.min(to, -start) - from) + source.read(0, Math.max(0, start + to));
	}
	const body: HighlightSource = {
		id: source.id, version: source.version, length, read,
		text: () => text ??= read(0, length),
	};
	const scan = function* () {
		embedded.checkpoint = yield* embedded.highlighter.resume({
			source: body, end,
			edit: checkpoint && embedded.version !== source.version ? { previousVersion: embedded.version, start: checkpoint.offset } : undefined,
		}, checkpoint);
		embedded.version = source.version;
	};
	for (const child of scan()) {
		const token = highlightToken(window, child, start, line);
		token.foldEnd = Math.min(token.foldEnd, embedded.folds + token.foldStart);
		embedded.folds += token.foldStart - token.foldEnd;
		yield* appendToken(state, token);
	}
}

function* flush(window: HighlightWindow, state: MarkdownState, limit: number) {
	const segment = { ...window, text: state.text, start: state.start, line: state.line,
		final: window.final && state.start + state.text.length === window.start + window.text.length };
	const consumed = yield* highlightBlocks(segment, state, limit);
	for (let i = 0; i < consumed; i++) if (state.text.charAt(i) === '\n') state.line++;
	state.start += consumed;
	state.text = state.text.slice(consumed);
	state.mode = undefined;
	if (state.text) blockMode(state);
}

function* highlightBlocks(window: HighlightWindow, state: MarkdownState, limit: number): Generator<HighlightToken, number> {
	const source = window.text;
	let offset = 0;
	let line = 0;
	let { pending, indented } = state;
	const { sections } = state;
	let foldStart = 0;
	let consumed = 0;
	function lineAt(start: number) {
		for (; offset < start; offset++)
			if (source.charAt(offset) === '\n') line++;
		return line;
	}

	for (const token of tokenize(scannerBlock, source)) {
		if (token.kind === 'eol' && !window.final && /^[ \t\n]*$/.test(source.slice(token.start))) break;
		if (token.kind === 'tabsBlock' && !indented) {
			indented = true;
			foldStart = 1;
		} else if (indented && token.kind !== 'tabsBlock' && token.kind !== 'eol') {
			if (pending) pending.foldEnd++;
			indented = false;
		}
		if (token.kind === 'heading' || token.kind === 'setext') {
			while (sections.length && (sections.at(-1) ?? 0) >= token.level) {
				sections.pop();
				if (pending) pending.foldEnd++;
			}
			sections.push(token.level);
			foldStart = 1;
		}
		for (const result of highlightBlock(token, lineAt)) {
			[result.foldStart, result.foldEnd] = foldToken(result);
			result.foldStart += foldStart;
			foldStart = 0;
			const previous = pending;
			pending = highlightToken(window, result, window.start, window.line);
			if (previous) yield previous;
		}
		consumed = token.end;
		if (consumed >= limit) break;
	}
	Object.assign(state, { pending, indented });
	return consumed;
}

function* highlightBlock(
	token: ReturnType<ReturnType<typeof scannerBlock>['next']> | TokenizerError,
	lineAt: (start: number) => number,
): Generator<HighlightToken, void> {
	const source = token.source;
	if (token.kind === 'tokenizer-error') {
		token.line = lineAt(token.start);
		yield enrichHighlightToken(token, 'error');
		return;
	}
	let kind: HighlightKind = 'text';
	switch (token.kind) {
		case 'block':
		case 'tabsBlock':
			kind = 'code';
			break;
		case 'heading':
		case 'setext':
			kind = 'heading';
			break;
		case 'li':
		case 'ol':
			kind = 'list';
			break;
		case 'blockquote':
			kind = 'blockquote';
			break;
		case 'hr':
			kind = 'separator';
			break;
		case 'linkdef':
			kind = 'link';
			break;
		case 'html':
			kind = 'tag';
			break;
		default:
			break;
	}
	if (
		token.kind !== 'text' && token.kind !== 'heading' &&
		token.kind !== 'setext' && token.kind !== 'li' &&
		token.kind !== 'ol' && token.kind !== 'blockquote'
	) {
		token.line = lineAt(token.start);
		yield enrichHighlightToken(token, kind);
		return;
	}
	const start = token.start + token.textStart;
	const end = token.kind === 'heading' || token.kind === 'setext'
		? token.start + token.textEnd
		: token.end;
	if (start > token.start)
		yield { ...token, highlight: kind, foldStart: 0, foldEnd: 0, end: start, line: lineAt(token.start) };
	for (const inline of tokenize(scannerInline, source.slice(start, end))) {
		let inlineKind: HighlightKind = kind === 'heading' ? kind : 'text';
		switch (inline.kind) {
			case 'tokenizer-error':
				inlineKind = 'error';
				break;
			case 'code':
			case 'tabsBlock':
				inlineKind = 'code';
				break;
			case 'delim':
				inlineKind = inline.count > 1 ? 'strong' : 'emphasis';
				break;
			case 'a':
			case 'img':
			case 'autolink':
				inlineKind = 'link';
				break;
			case 'html':
				inlineKind = 'tag';
				break;
			default:
				break;
		}
		yield {
			kind: inline.kind,
			highlight: inlineKind,
			foldStart: 0,
			foldEnd: 0,
			start: start + inline.start,
			end: start + inline.end,
			line: lineAt(start + inline.start),
			source,
		};
	}
	if (end < token.end)
		yield { ...token, highlight: kind, foldStart: 0, foldEnd: 0, start: end, line: lineAt(end) };
}
