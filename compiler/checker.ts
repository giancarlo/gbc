import { CompilerError, text } from '../sdk/index.js';

import type { InfixNode, Node, NodeMap } from './node.js';
import { BaseTypes as BT, Flags } from './symbol-table.js';
import type { Symbol, SymbolMap, Type } from './symbol-table.js';

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
			const sym = node.label.symbol;
			if (sym.type) return sym.type;
			const declared = node.type ? resolveType(node.type) : undefined;
			const value = resolveType(node.value);
			const isImmutable = !(sym.flags & Flags.Variable);
			const t = isImmutable && value ? value : (declared ?? value);
			if (t) sym.type = t;
			return t;
		}
		case 'ident':
			return node.symbol.type;
		case 'typeident':
			return node.symbol;
		case 'call':
			return resolveReturnType(node.children[0]);
		case 'number':
			return BT[Number.isInteger(node.value) ? 'Int32' : 'Float64'];
		case 'string':
			return BT.String;
		case 'parameter': {
			const sym = node.label.symbol;
			if (sym.type) return sym.type;
			if (node.type) {
				sym.type = resolver(node.type);
				return sym.type;
			}
			return;
		}
		case 'fn': {
			const sym = node.symbol;

			if (!sym.returnType) {
				if (node.returnType) sym.returnType = resolver(node.returnType);
			}
			if (node.parameters?.length) node.parameters.forEach(resolver);

			return sym;
		}
		case 'data': {
			const inner = node.children[0];
			const items =
				inner?.kind === ',' ? inner.children : inner ? [inner] : [];
			const members: Record<string, Symbol> = {};
			for (const item of items) {
				if (item?.kind !== 'propdef' || !item.label) continue;
				// Resolve so the propdef's label symbol gets its type from
				// the value (or annotation). Without this, member loads
				// from the data type would lack type info downstream.
				resolveType(item);
				const name = item.label.symbol.name;
				if (name) members[name] = item.label.symbol;
			}
			return {
				kind: 'type',
				flags: 0,
				name: '__data',
				family: 'data',
				size: 0,
				members,
			};
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

			if (!isNumericType(lType) || !isNumericType(rType)) return;
			if (isFloatType(lType) || isFloatType(rType)) return BT.Float64;
			return BT.Int32;
		}
		case '==':
		case '!=':
		case 'is':
			return BT.Bool;
		case '?': {
			const thenBranch = node.children[1];
			return thenBranch ? resolver(thenBranch) : BT.Unknown;
		}
		case 'propdef': {
			const sym = node.label?.symbol;
			if (sym?.kind === 'variable' && sym.type) return sym.type;
			const t = node.value ? resolver(node.value) : BT.Unknown;
			if (sym?.kind === 'variable' && t.kind === 'type' && t.family !== 'unknown')
				sym.type = t;
			return t;
		}
		default:
			return BT.Unknown;
	}
}

/**
 * Determines the type of a node based on its kind and associated type declarations.
 */
function resolver(node: CheckedNode): Type {
	if (node[typeSymbol]) return node[typeSymbol];
	return (node[typeSymbol] ??= resolveType(node) ?? BT.Unknown);
}

function isIntegerType(t?: Type) {
	return t?.kind === 'type' && (t.family === 'int' || t.family === 'uint');
}
function isFloatType(t?: Type) {
	return t?.kind === 'type' && t.family === 'float';
}
function isNumericType(t?: Type) {
	return isIntegerType(t) || isFloatType(t);
}
function isNumber(node: Node) {
	return isNumericType(resolver(node));
}

function canAssign(to: Type, a: Type): boolean {
	if (to === a) return true;
	if (to.kind !== 'type' || a.kind !== 'type') return false;
	if (to.family === 'union')
		return to.members.some(m => canAssign(m, a));
	if (to.family === 'literal' && a.family === 'literal')
		return to.value === a.value;
	if (to.family === 'string' && a.family === 'literal' && typeof a.value === 'string')
		return true;
	if (to.family === 'data' && a.family === 'data') {
		for (const key of Object.keys(to.members)) {
			const toType = to.members[key]?.type;
			const aType = a.members[key]?.type;
			if (!toType || !aType) return false;
			if (!canAssign(toType, aType)) return false;
		}
		return true;
	}
	return false;
}

function valueType(node: Node): Type | undefined {
	if (node.kind === 'string') {
		const v = text(node).slice(1, -1);
		return {
			kind: 'type',
			flags: 0,
			family: 'literal',
			name: `'${v}'`,
			size: 0,
			value: v,
		};
	}
	return resolveType(node);
}

/**
 * Collapse a list of types into a single type. Identical types reduce to
 * one; otherwise builds a `union` type whose `size` is the largest member.
 * Only data-typed members (kind: 'type') participate; function-kind types
 * are skipped because they aren't valid union arms.
 */
function unionOf(types: Type[]): Type {
	const seen = new Map<string, SymbolMap['type']>();
	for (const t of types) {
		if (t.kind === 'type') seen.set(t.name, t);
	}
	const members = Array.from(seen.values());
	if (members.length === 0) return BT.Void;
	const first = members[0];
	if (members.length === 1 && first) return first;
	let maxSize = 0;
	const names: string[] = [];
	for (const m of members) {
		if (m.size > maxSize) maxSize = m.size;
		names.push(m.name);
	}
	return {
		kind: 'type',
		flags: 0,
		name: names.join(' | '),
		family: 'union',
		size: maxSize,
		members,
	};
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
			case 'data': {
				const inner = node.children[0];
				const items =
					inner?.kind === ',' ? inner.children : inner ? [inner] : [];
				return checkEach(items);
			}
			case 'next': {
				const fn = node.owner;
				const val = node.children?.[0];
				// `next(a, b, c)` — the comma child enumerates values the fn
				// emits; the fn's emit type is the union of the children's
				// types (collapsed when all share one type).
				const types: Type[] =
					val?.kind === ','
						? val.children
								.map(c => (c ? resolveType(c) : undefined))
								.filter((t): t is Type => !!t)
						: val
							? [resolveType(val) ?? BT.Unknown]
							: [BT.Void];
				const type = unionOf(types);

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

				if (params?.length && args) {
					const argTypes =
						args.kind === ','
							? getListTypes(args)
							: [resolver(args)];
					for (let i = 0; i < argTypes.length; i++) {
						const typeA = argTypes[i];
						const typeB = params[i]?.type;
						if (typeA && typeB && !canAssign(typeB, typeA))
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
			case 'def': {
				const sym = node.label.symbol;
				resolver(node);
				if (node.type) {
					const declared = resolveType(node.type);
					const vt = valueType(node.value);
					if (declared && vt && !canAssign(declared, vt))
						error(
							`Type "${typeToStr(vt)}" is not assignable to declared type "${typeToStr(declared)}"`,
							node,
						);
				}
				if (
					!sym.references?.length &&
					!(sym.flags & Flags.Export)
				)
					error(
						`"${sym.name ?? ''}" is declared but never used`,
						node.label,
					);
				check(node.value);
				return;
			}
			case '=': {
				const left = node.children[0];
				if (left.kind === 'ident') {
					const sym = left.symbol;
					if (!(sym.flags & Flags.Variable))
						error(
							`Cannot reassign immutable binding "${
								sym.name ?? ''
							}"`,
							left,
						);
				}
				check(node.children[1]);
				return;
			}
			case '<=':
			case '>=':
			case '<':
			case '>':
			case '-':
			case '+':
			case '/':
			case '*':
				return numberBinaryOperator(node);
			case '>>':
				inferPipeStageParams(node.children);
				for (const c of node.children)
					if (c && c.kind !== 'fn') check(c);
				return;
			case ',':
				for (const c of node.children) if (c) check(c);
				return;
		}
	}

	function inferPipeStageParams(children: Node[]) {
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			const fnSym = pipeStageFn(stage);
			if (!fnSym) continue;
			const firstParam = fnSym.parameters?.[0];
			if (!firstParam || firstParam.type) continue;
			const inputType = resolver(input);
			if (
				inputType.kind === 'type' &&
				inputType.family !== 'unknown'
			)
				firstParam.type = inputType;
		}
	}

	function pipeStageFn(stage: Node): SymbolMap['function'] | undefined {
		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			if (sym.kind === 'function') return sym;
			if (sym.kind === 'variable' && sym.type?.kind === 'function')
				return sym.type;
		}
	}

	return {
		run: () => check(root),
		resolver,
	};
}
