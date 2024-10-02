///<amd-module name="@cxl/gbc.compiler/checker.js"/>
import { CompilerError } from '@cxl/gbc.sdk';

import type { InfixNode, Node, NodeMap } from './node.js';
import { BaseTypes, Type } from './symbol-table.js';

const typeSymbol = Symbol('type');
export type CheckedNode = Node & { [typeSymbol]?: Type };

function typeToStr(type?: Type) {
	return type?.name || 'unknown';
}

/**
 * Resolves the type of a given node.
 */
function resolveType(node: Node): Type | undefined {
	switch (node.kind) {
		case 'def': {
			let type = node.left.symbol.type;
			if (type) return type;
			type = (node.type && resolver(node.type)) || resolver(node.right);
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
			return Number.isInteger(node.value)
				? BaseTypes.int
				: BaseTypes.float;
		case 'parameter': {
			if (node.symbol.type) return node.symbol.type;
			if (node.type) {
				node.symbol.type = resolver(node.type);
				return node.symbol.type;
			}
			return;
		}
		case '{': {
			const sym = node.symbol;
			if (!sym) return;

			if (!sym.returnType) {
				if (node.returnType) sym.returnType = resolver(node.returnType);
			}
			if (node.parameters?.length) node.parameters.forEach(resolver);

			return sym;
		}
	}
}
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
	return (node[typeSymbol] ||= resolveType(node));
}

function isNumberType(node: Node) {
	return node.kind === 'ident' && node.symbol?.type === BaseTypes.int;
}

function isNumber(node: Node) {
	return node.kind === 'number' || isNumberType(node);
}

function canAssign(to: Type, a: Type): boolean {
	if (to === a) return true;
	return false;
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

	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkEach(node.children);
			case '{':
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
						`Type "${typeToStr(type)}" is not assignable to type "${typeToStr(fn.returnType)}".`,
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
								`Argument of type "${typeToStr(typeA)}' is not assignable to parameter of type "${typeToStr(typeB)}".`,
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
