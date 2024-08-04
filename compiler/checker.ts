///<amd-module name="@cxl/gbc.compiler/checker.js"/>
import { CompilerError, text } from '@cxl/gbc.sdk';

import type { Node } from './node.js';

export type Type = {
	name: string;
};

export const BooleanType = { name: 'boolean' };
export const FloatType = { name: 'float' };
export const ObjectType = { name: 'object' };
export const FunctionType = { name: 'function' };
export const IntegerType = { name: 'int' };
export const StringType = { name: 'string' };

const typeSymbol = Symbol('type');
export type CheckedNode = Node & { [typeSymbol]?: Type };

const nativeTypeMap: Record<string, Type> = {
	int: IntegerType,
	boolean: BooleanType,
	string: StringType,
	float: FloatType,
};

/**
 * Perform semantic analysis
 */
export function checker({ root }: { root: Node; errors: CompilerError[] }) {
	/**
	 * Resolves the type of a given node.
	 */
	function resolveType(node: Node) {
		if (node.kind === 'ident') {
			const name = text(node);
			const native = nativeTypeMap[name];
			if (native) return native;
		}
	}

	/**
	 * Determines the type of a node based on its kind and associated type declarations.
	 */
	function getNodeType(node: CheckedNode) {
		if (node[typeSymbol]) return node[typeSymbol];

		if (node.kind === 'def') {
			const type = node.type && resolveType(node.type);
			if (type) node.left.symbol.type = type;
		}
	}

	function checkEach(node: Node[]) {
		node.forEach(check);
	}

	function check(node: Node) {
		switch (node.kind) {
			case 'root':
			case 'main':
				return checkEach(node.children);
			case 'def':
				getNodeType(node);
		}
	}

	return {
		run: () => check(root),
		getNodeType,
	};
}
