///<amd-module name="@cxl/gbc.compiler/checker.js"/>
import { CompilerError } from '@cxl/gbc.sdk';

import type { InfixNode, Node } from './node.js';

export type Type = {
	name: string;
};

export const BooleanType = { name: 'boolean' };
export const FloatType = { name: 'float' };
export const IntegerType = { name: 'int' };
export const StringType = { name: 'string' };
export const VoidType = { name: 'void' };

const typeSymbol = Symbol('type');
export type CheckedNode = Node & { [typeSymbol]?: Type };

function typeToStr(type?: Type) {
	return type?.name || 'unknown';
}

/**
 * Perform semantic analysis
 */
export function checker({
	root,
	errors,
}: {
	root: Node;
	errors: CompilerError[];
}) {
	/**
	 * Resolves the type of a given node.
	 */
	function resolveType(node: Node): Type | undefined {
		switch (node.kind) {
			case 'def': {
				let type = node.left.symbol.type;
				if (type) return type;
				type =
					(node.type && getNodeType(node.type)) ||
					getNodeType(node.right);
				if (type) node.left.symbol.type = type;
				return type;
			}
			case 'ident':
				return node.symbol.type;
			case 'call':
				return resolveReturnType(node.children[0]);
			case 'number':
				return Number.isInteger(node.value) ? IntegerType : FloatType;
		}
	}
	function resolveReturnType(node: Node) {
		if (node.kind === 'ident') {
			const type = getNodeType(node);
			if (type) return node.symbol.type;
		}
	}

	/**
	 * Determines the type of a node based on its kind and associated type declarations.
	 */
	function getNodeType(node: CheckedNode) {
		return (node[typeSymbol] ||= resolveType(node));
	}

	function checkEach(node: Node[]) {
		node.forEach(check);
	}

	function isNumberType(node: Node) {
		return node.kind === 'ident' && node.symbol?.type === IntegerType;
	}

	function isNumber(node: Node) {
		return node.kind === 'number' || isNumberType(node);
	}

	function numberBinaryOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		if (!(isNumber(left) && isNumber(right))) {
			errors.push({
				message: `Operator "${
					node.kind
				}" cannot be applied to types "${typeToStr(
					getNodeType(left),
				)}" and "${typeToStr(getNodeType(right))}".`,
				position: left,
			});
		}
	}

	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkEach(node.children);
			case '{':
				//if (node.returnType) getNodeType(node.returnType);
				return node.statements && checkEach(node.statements);
			case 'main':
				return checkEach(node.statements);
			/*case 'next': {
				const val = node.children?.[0];
				const type = val ? getNodeType(val) : VoidType;
				const retType = getReturnType();
				
				return;
			}*/
			case 'def':
				getNodeType(node);
				check(node.right);
				return;
			case '<=':
			case '*':
				return numberBinaryOperator(node);
		}
	}

	return {
		run: () => check(root),
		getNodeType,
	};
}
