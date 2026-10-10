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

export function* highlight(source: string): ReturnType<typeof highlightTokens> {
	let name = '';
	let closing = false;
	let slash = false;
	let declaration = false;
	for (const token of highlightTokens(source)) {
		[token.foldStart, token.foldEnd] = foldToken(token);
		switch (token.kind) {
			case 'openTag':
				name = '';
				closing = false;
				declaration = source[token.end] === '!' || source[token.end] === '?';
				break;
			case 'tagName':
				if (!declaration) name = text(token).toLowerCase();
				break;
			case 'slash':
				if (!name) closing = true;
				break;
			case 'gt':
				if (name && !voidTags.has(name)) {
					if (closing) token.foldEnd = 1;
					else if (!slash) token.foldStart = 1;
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
		yield token;
	}
}
