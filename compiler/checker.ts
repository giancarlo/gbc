import { CompilerError } from '../sdk/index.js';

import type { InfixNode, Node, NodeMap } from './node.js';
import { BaseTypes as BT, Type } from './symbol-table.js';

const typeSymbol = Symbol('type');
export type CheckedNode = Node & { [typeSymbol]?: Type };

function typeToStr(type?: Type) {
	return type?.name || 'unknown';
}

/** Completes the return type resolution for function identifiers if their type is function and it has a defined returnType.*/
function resolveReturnType(node: Node) {
	if (node.kind === 'ident') {
		const type = resolver(node);
		if (type.kind === 'function' && type.returnType) return type.returnType;
	}
}

function resolveType(node: CheckedNode): Type | undefined {
	switch (node.kind) {
		case 'def': {
			let type = node.left.symbol.type;
			if (type) return type;
			type =
				(node.type && resolveType(node.type)) ||
				resolveType(node.right);
			if (type) node.left.symbol.type = type;
			return type;
		}
		case 'ident':
			return node.symbol.type;
		case 'typeident':
			return node.symbol;
		case 'call':
			return resolveReturnType(node.children[0]);
		case 'number':
			return BT[Number.isInteger(node.value) ? 'int' : 'float'];
		case 'parameter':
			if (node.symbol.type) return node.symbol.type;
			if (node.type) {
				node.symbol.type = resolver(node.type);
				return node.symbol.type;
			}
			return;
		case 'fn': {
			const sym = node.symbol;

			if (!sym.returnType) {
				if (node.returnType) sym.returnType = resolver(node.returnType);
			}
			if (node.parameters?.length) node.parameters.forEach(resolver);

			return sym;
		}
		case '<=':
		case '>=':
		case '<':
		case '>':
		case '-':
		case '+':
		case '/':
		case '*': {
			const lType = resolver(node.children[0]);
			const rType = resolver(node.children[1]);

			if (
				(lType !== BT.int && lType !== BT.float) ||
				(rType !== BT.int && rType !== BT.float)
			)
				return;

			if (lType === BT.float || rType === BT.float) return BT.float;

			return BT.int;
		}
		default:
			return BT.unknown;
	}
}

/**
 * Determines the type of a node based on its kind and associated type declarations.
 */
function resolver(node: CheckedNode): Type {
	if (node[typeSymbol]) return node[typeSymbol];
	return (node[typeSymbol] ??= resolveType(node) ?? BT.unknown);
}

function isNumber(node: Node) {
	const type = resolver(node);
	return type === BT.int || type === BT.float;
	//.kind === 'number' || node.kind === 'ident' && node.symbol.type === BaseTypes.int;
}

function canAssign(to: Type, a: Type): boolean {
	return to === a;
}

function getListTypes(node: NodeMap[',']) {
	return node.children.map(resolver);
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
				const type = val ? resolveType(val) : BT.void;

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
				const fn = resolveType(node.children[0]);
				if (!fn || fn.kind !== 'function') {
					error(`This expression is not callable`, node);
					return;
				}

				const args = node.children[1];
				const params = fn.parameters;
				const paramCount = params?.length ?? 0;
				const argsCount = args
					? args.kind === ','
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
						const typeB = params[i]?.type;
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
			default:
		}
	}

	return {
		run: () => check(root),
		resolver,
	};
}
