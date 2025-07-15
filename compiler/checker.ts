import { CompilerError } from 'gbc/sdk/index.js';

import type { InfixNode, Node, NodeMap, NodeKind } from './node.js';
import { BaseTypes, Type } from './symbol-table.js';

const typeSymbol = Symbol('type');
export type CheckedNode = Node & { [typeSymbol]?: Type };

function typeToStr(type?: Type) {
	return type?.name || 'unknown';
}

const resolveMap: {
	[K in NodeKind]?: (node: NodeMap[K]) => Type | undefined;
} = {
	def: node => {
		let type = node.left.symbol.type;
		if (type) return type;
		type = (node.type && resolver(node.type)) || resolver(node.right);
		if (type) node.left.symbol.type = type;
		return type;
	},
	ident: n => n.symbol.type,
	typeident: n => n.symbol,
	call: n => resolveReturnType(n.children[0]),
	number: n => BaseTypes[Number.isInteger(n.value) ? 'int' : 'float'],
	parameter: node => {
		if (node.symbol.type) return node.symbol.type;
		if (node.type) {
			node.symbol.type = resolver(node.type);
			return node.symbol.type;
		}
	},
	fn: node => {
		const sym = node.symbol;

		if (!sym.returnType) {
			if (node.returnType) sym.returnType = resolver(node.returnType);
		}
		if (node.parameters?.length) node.parameters.forEach(resolver);

		return sym;
	},
};

/** Completes the return type resolution for function identifiers if their type is function and it has a defined returnType.*/
function resolveReturnType(node: Node) {
	if (node.kind === 'ident') {
		const type = resolver(node);
		if (type?.kind === 'function' && type.returnType)
			return type.returnType;
	}
}

/**
 * Determines the type of a node based on its kind and associated type declarations.
 */
function resolver(node: CheckedNode) {
	return (node[typeSymbol] ||= resolveMap[node.kind]?.(node as never));
}

function isNumberType(node: Node) {
	return node.kind === 'ident' && node.symbol?.type === BaseTypes.int;
}

function isNumber(node: Node) {
	return node.kind === 'number' || isNumberType(node);
}

function canAssign(to: Type, a: Type): boolean {
	return to === a;
}

function getListTypes(node: NodeMap[',']) {
	return node.children?.map(resolver);
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
	function checkEach(node: Node[]) {
		node.forEach(check);
	}

	function error(message: string, position: Node) {
		errors.push({ message, position });
	}

	function numberBinaryOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		if (!(isNumber(left) && isNumber(right))) {
			errors.push({
				message: `Operator "${
					node.kind
				}" cannot be applied to types "${typeToStr(
					resolver(left),
				)}" and "${typeToStr(resolver(right))}".`,
				position: left,
			});
		}
	}

	/**
	 * The `check` function performs semantic analysis on a node by exploring its structure and applying various checks
	 * based on its kind. Each case handles a specific node kind, ensuring that the proper validation and type-resolution
	 * operations are performed. Depending on the node kind, it might resolve types, validate parameters, and enforce
	 * correct usage of operations and calls.
	 */
	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkEach(node.children);
			case 'fn':
				resolver(node);
				return node.statements && checkEach(node.statements);
			case 'main':
				return checkEach(node.statements);
			case 'next': {
				const fn = node.owner;
				const val = node.children?.[0];
				const type = val ? resolver(val) : BaseTypes.void;

				if (!fn.returnType) fn.returnType = type;
				else if (type && !canAssign(fn.returnType, type))
					error(
						`Type "${typeToStr(
							type,
						)}" is not assignable to type "${typeToStr(
							fn.returnType,
						)}".`,
						node,
					);
				return;
			}
			case 'call': {
				const fn = resolver(node.children[0]);
				if (!fn || fn.kind !== 'function') {
					error(`This expression is not callable`, node);
					return;
				}

				const args = node.children[1];
				const params = fn.parameters;
				const paramCount = params?.length ?? 0;
				const argsCount = args
					? args?.kind === ','
						? args.children.length
						: 1
					: 0;

				if (argsCount !== paramCount)
					error(
						`Expected ${paramCount} arguments but got ${argsCount}.`,
						node,
					);

				if (params?.length && args) {
					const argTypes =
						args.kind === ','
							? getListTypes(args)
							: [resolver(args)];
					for (let i = 0; i < argTypes.length; i++) {
						const typeA = argTypes[i];
						const typeB = params[i].type;
						if (typeA && typeB && !canAssign(typeA, typeB))
							error(
								`Argument of type "${typeToStr(
									typeA,
								)}' is not assignable to parameter of type "${typeToStr(
									typeB,
								)}".`,
								node,
							);
					}
				}

				return;
			}
			case 'def':
				resolver(node);
				check(node.right);
				return;
			case '<=':
			case '>=':
			case '<':
			case '>':
			case '-':
			case '+':
			case '/':
			case '*':
				return numberBinaryOperator(node);
		}
	}

	return {
		run: () => check(root),
		resolver,
	};
}
