import { text } from 'gbc/sdk/index.js';
import { Flags } from './symbol-table.js';

import type { Node } from './node.js';

function nodeId(node: Node) {
	switch (node.kind) {
		case 'string':
			return text(node);
		case 'number':
			return String(node.value);
		case 'ident':
			return `:${node.symbol?.name || text(node)}`;
		default:
			return node.kind;
	}
}

export function symbolFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag].toLowerCase());
	}
	return result;
}

export function ast(node: Node): string {
	const flags =
		'symbol' in node && node.symbol?.flags
			? symbolFlags(node.symbol.flags as number)
			: '';
	const id = nodeId(node) + (flags ? ` ${flags.join(' ')}` : '');

	return 'children' in node && node.children?.length
		? `(${id} ${node.children.map(n => (n ? ast(n) : '?')).join(' ')})`
		: id;
}
