import { text } from 'gbc/sdk/index.js';
import { Flags } from './symbol-table.js';
import { Node, NodeMap } from './node.js';

function def({ left, right }: NodeMap['def']) {
	const symbol = left.symbol;

	if (!(symbol.flags & Flags.Export)) return '';

	switch (right.kind) {
		case 'fn': {
			const params =
				right.parameters?.map(p => `${p.symbol.name}:any`) ?? '';
			return `export function ${text(left)}(${params}): any`;
		}
	}

	return '';
}

/**
 * Generate Typescript Types Definition files.
 */
export function compileTypes(node: Node): string {
	switch (node.kind) {
		case 'def':
			return def(node);
		case 'typeident':
			return node.symbol.name ?? '';
		case 'type': {
			const isExport = node.symbol.flags & Flags.Export;
			const name = text(node.children[0]);
			return `${isExport ? 'export ' : ''}type ${name} = ${compileTypes(
				node.children[1],
			)}`;
		}
		case 'root':
			return node.children.map(compileTypes).join(';\n');
	}
	return '';
}
