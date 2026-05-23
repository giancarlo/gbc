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
			return `:${text(node)}`;
		case '@':
			return text(node);
		default:
			return node.kind;
	}
}

export function symbolFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag]?.toLowerCase());
	}
	return result;
}

export function ast(node: AstNode): string {
	const flags =
		'symbol' in node && node.symbol?.flags
			? symbolFlags(node.symbol.flags as number)
			: '';
	const id = nodeId(node) + (flags ? ` ${flags.join(' ')}` : '');

	if (!('children' in node)) return id;
	if (!node.children?.length) return `(${id})`;
	return `(${id} ${node.children.map(n => (n ? ast(n) : '?')).join(' ')})`;
}
