import { tokenize, createHighlighter, shiftHighlightBuffer, highlightTokens, highlightToken, highlightSegments, foldToken, type HighlightOptions, type HighlightKind, type HighlightBuffer, type HighlightToken, type HighlightWindow } from '@cxl/gbc.sdk';
import { scanner } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter, HighlightOptions, LanguageResolver } from '@cxl/gbc.sdk';
const classify = (token: ReturnType<ReturnType<typeof scanner>['next']>): HighlightKind => {
	switch (token.kind) {
		case 'attrName':
			return 'attribute';
		case 'tagName':
			return 'tag';
		case 'comment':
		case 'string':
			return token.kind;
		case 'equals':
			return 'operator';
		case 'openTag':
		case 'gt':
		case 'slash':
			return 'punctuation';
		default:
			return 'text';
	}
};

const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const optionalEnds = new Set('html head body li dt dd p rt rp optgroup option colgroup caption thead tbody tfoot tr td th'.split(' '));
const paragraphEnds = new Set('address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre search section table ul'.split(' '));
const paragraphEnd = ['p'] as const;
const scopes = new Set('html table select datalist ruby dl ul ol menu template svg math'.split(' '));
const headContents = new Set('html head base basefont bgsound link meta noframes noscript script style template title'.split(' '));
const startEnds: Readonly<Record<string, readonly string[] | undefined>> = {
	body: ['head'],
	li: ['li'],
	dt: ['dt', 'dd'],
	dd: ['dt', 'dd'],
	rt: ['rt', 'rp'],
	rp: ['rt', 'rp'],
	option: ['option'],
	optgroup: ['option', 'optgroup'],
	hr: ['p', 'option', 'optgroup'],
	colgroup: ['caption', 'colgroup'],
	thead: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
	tbody: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
	tfoot: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
	tr: ['caption', 'colgroup', 'tr', 'td', 'th'],
	td: ['td', 'th'],
	th: ['td', 'th'],
};

interface OpenElements {
	names: string[];
	counts: Map<string, number>;
}

function closeElements({ names, counts }: OpenElements, name: string, closing: boolean): number {
	let index = names.length;
	if (closing) {
		const match = names.lastIndexOf(name);
		if (match >= 0) index = match;
	} else {
		if (names.at(-1) === 'head' && !headContents.has(name)) index--;
		const ends = Object.hasOwn(startEnds, name) ? startEnds[name] : (paragraphEnds.has(name) ? paragraphEnd : undefined);
		if (ends?.some(end => counts.get(end))) {
			for (let i = names.length - 1; i >= 0; i--) {
				const open = names[i];
				if (!open || scopes.has(open)) break;
				if (ends.includes(open)) index = i;
			}
		}
	}
	const count = names.length - index;
	for (let i = index; i < names.length; i++) {
		const open = names[i] ?? '';
		if (optionalEnds.has(open)) counts.set(open, (counts.get(open) ?? 0) - 1);
	}
	names.length = index;
	return count;
}

function openElement({ names, counts }: OpenElements, name: string, slash: boolean): number {
	if (slash || voidTags.has(name)) return 0;
	names.push(name);
	if (optionalEnds.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
	return 1;
}

interface HtmlState {
	buffer: HighlightBuffer;
	inTag: boolean;
	inText: boolean;
	quote: string;
	escape: boolean;
	prefix: string;
	comment: boolean;
	tail: string;
	name: string;
	closing: boolean;
	slash: boolean;
	declaration: boolean;
	elements: OpenElements;
	pending: HighlightToken | undefined;
}

export const highlight = (_options?: HighlightOptions) => createHighlighter((): HtmlState => ({
	buffer: { start: 0, line: 0, fragment: undefined }, inTag: false, inText: false, quote: '', escape: false,
	prefix: '', comment: false, tail: '', name: '', closing: false, slash: false, declaration: false,
	elements: { names: [], counts: new Map() }, pending: undefined,
}), function* (window, previous) {
	const state = { ...previous, elements: { names: [...previous.elements.names], counts: new Map(previous.elements.counts) } };
	if (state.pending) state.pending = highlightToken(window, state.pending);
	const segments = highlightSegments(window, state.buffer, ch => {
		if (state.comment) {
			state.tail = (state.tail + ch).slice(-3);
			if (state.tail !== '-->') return false;
			state.comment = state.inTag = false;
			state.prefix = '';
			return true;
		}
		if (state.quote) {
			if (state.escape) state.escape = false;
			else if (ch === '\\') state.escape = true;
			else if (ch === state.quote) { state.quote = ''; return !state.inTag; }
			return false;
		}
		if (state.inText && ch !== '<') return false;
		if (ch === '<') { state.inTag = true; state.inText = false; state.prefix = '<'; return false; }
		if (state.prefix) {
			state.prefix += ch;
			if (state.prefix === '<!--') { state.comment = true; state.tail = ''; return false; }
			if (state.prefix.length >= 4) state.prefix = '';
		}
		if (ch === '"' || ch === "'") state.quote = ch;
		else if (ch === '>') { state.inTag = false; state.prefix = ''; return true; }
		else if (!state.inTag && !' \t\r\n/='.includes(ch)) state.inText = true;
		return false;
	});
	for (;;) {
		const next = segments.next();
		if (next.done) { state.buffer = next.value; break; }
		yield* highlightMarkup(next.value, state);
	}
	if (window.final && state.pending) {
		while (optionalEnds.has(state.elements.names.at(-1) ?? '')) {
			state.elements.names.pop();
			state.pending.foldEnd++;
		}
		yield state.pending;
		state.pending = undefined;
	}
	return { state, committed: state.pending?.start ?? state.buffer.start };
}, (state, shift) => ({
	...state, buffer: shiftHighlightBuffer(state.buffer, shift),
	pending: state.pending ? shift.position(state.pending) : undefined,
}));

function* highlightMarkup(window: HighlightWindow, state: HtmlState) {
	let { name, closing, slash, declaration, pending } = state;
	const { elements } = state;
	const source = window.text;
	for (const token of highlightTokens(window, tokenize(scanner, window.text), classify, undefined, foldToken)) {
		switch (token.kind) {
			case 'openTag':
				name = '';
				closing = false;
				declaration = source[token.end - window.start] === '!' || source[token.end - window.start] === '?';
				break;
			case 'tagName':
				if (!declaration) {
					name = source.slice(token.start - window.start, token.end - window.start).toLowerCase();
					if (!closing) token.foldEnd += closeElements(elements, name, false);
				}
				break;
			case 'slash':
				if (!name) closing = true;
				break;
			case 'gt':
				if (name) {
					if (closing) token.foldEnd += closeElements(elements, name, true);
					else token.foldStart = openElement(elements, name, slash);
				}
				name = '';
				break;
			case 'comment':
				name = '';
				break;
			default:
				break;
		}
		slash = token.kind === 'slash';
		if (pending) yield pending;
		pending = token;
	}
	Object.assign(state, { name, closing, slash, declaration, pending });
}
