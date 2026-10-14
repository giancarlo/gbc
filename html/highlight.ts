import { createHighlighter, foldToken, text } from '@cxl/gbc.sdk';
import { scanner } from './index.js';

export type { HighlightKind, HighlightToken, Highlighter } from '@cxl/gbc.sdk';
const highlightTokens = createHighlighter(scanner, token => {
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
});

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

export function* highlight(source: string): ReturnType<typeof highlightTokens> {
	let name = '';
	let closing = false;
	let slash = false;
	let declaration = false;
	const elements: OpenElements = { names: [], counts: new Map() };
	let pending: (ReturnType<typeof highlightTokens> extends Generator<infer Node> ? Node : never) | undefined;
	for (const token of highlightTokens(source)) {
		[token.foldStart, token.foldEnd] = foldToken(token);
		switch (token.kind) {
			case 'openTag':
				name = '';
				closing = false;
				declaration = source[token.end] === '!' || source[token.end] === '?';
				break;
			case 'tagName':
				if (!declaration) {
					name = text(token).toLowerCase();
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
	if (pending) {
		while (optionalEnds.has(elements.names.at(-1) ?? '')) {
			elements.names.pop();
			pending.foldEnd++;
		}
		yield pending;
	}
}
