///<amd-module name="@cxl/gbc.cli/debug.js"/>
import { text } from '@cxl/gbc.sdk';
import { Flags } from './symbol-table.js';

import type { Node } from './node.js';

function nodeId(node: Node) {
	switch (node.kind) {
		case 'string':
			return text(node);
		case 'number':
			return node.value;
		case 'ident':
			return `:${text(node)}`;
		default:
			return node.kind;
	}
}

function nodeFlags(flags: number) {
	const result = [];
	for (const flag in Flags) {
		if (flags & +flag) result.push('@' + Flags[flag].toLowerCase());
	}
	return result.length ? ' ' + result.join(' ') : '';
}

export function ast(node: Node): string {
	const flags = 'flags' in node ? nodeFlags(node.flags as number) : '';
	const id = nodeId(node) + flags;

	return 'children' in node && node.children?.length
		? `(${id} ${node.children.map(n => (n ? ast(n) : '?')).join(' ')})`
		: id;
}
