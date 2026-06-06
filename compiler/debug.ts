import { text, Token } from '../sdk/index.js';
import { Flags } from './symbol-table.js';

import type { Node } from './node.js';

type AstNode = Node | Token<'ident'>;

function nodeId(node: AstNode) {
	switch (node.kind) {
		case 'string':
			return text(node);
		case 'number':
			return String(node.value);
		case 'ident':
		case 'label':
			return `:${text(node)}`;
		case '@':
			return text(node);
		default:
			return node.kind;
	}
}

function symbolFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag]?.toLowerCase());
	}
	return result;
}

export function ast(node: AstNode): string {
	const rawFlags =
		'symbol' in node && node.symbol.flags ? node.symbol.flags : 0;
	// `@export` is declaration metadata; don't echo it on every reference.
	const shownFlags = node.kind === 'ident' ? rawFlags & ~Flags.Export : rawFlags;
	const flags = shownFlags ? symbolFlags(shownFlags) : '';
	const id = nodeId(node) + (flags ? ` ${flags.join(' ')}` : '');

	if (!('children' in node)) return id;
	if (!node.children?.length) return `(${id})`;
	return `(${id} ${node.children.map(n => (n ? ast(n) : '?')).join(' ')})`;
}
