import { CompilerError, Position, text } from '../sdk/index.js';

import type { InfixNode, Node, NodeMap } from './node.js';
import { BaseTypes as BT, Flags } from './symbol-table.js';
import type { Symbol, SymbolMap, Type } from './symbol-table.js';

const typeSymbol = Symbol('type');
type CheckedNode = Node & { [typeSymbol]?: Type };

function typeToStr(type?: Type): string {
	if (type?.kind === 'type' && type.family === 'union')
		return type.members.map(m => m.name).join(' | ');
	return type?.name || 'unknown';
}

/** Completes the return type resolution for function identifiers if their type is function and it has a defined returnType.*/
function resolveReturnType(node: Node) {
	const type = resolver(node);
	if (type?.kind === 'function' && type.returnType) return type.returnType;
	if (type?.kind === 'type' && type.family !== 'fn') return type;
}

function resolveDataType(node: NodeMap['data']): Type {
	const inner = node.children[0];
	const items =
		inner?.kind === ',' ? inner.children : inner ? [inner] : [];
	const members: Record<string, Symbol> = {};
	items.forEach((item, idx) => {
		if (item.kind === 'propdef' && item.label) {
			resolveType(item);
			const name = item.symbol.name;
			if (name) members[name] = item.symbol;
			return;
		}
		const t = resolveType(item) ?? BT.Unknown;
		members[String(idx)] = {
			kind: 'variable',
			name: String(idx),
			flags: 0,
			type: t,
		};
	});
	return {
		kind: 'type',
		flags: 0,
		name: '__data',
		family: 'data',
		size: 0,
		members,
	};
}

function resolveNumericOp(node: InfixNode): Type | undefined {
	const lType = resolver(node.children[0]);
	const rType = resolver(node.children[1]);

	if (!isNumericType(lType) || !isNumericType(rType)) return;
	if (isFloatType(lType) || isFloatType(rType)) return BT.Float64;
	return BT.Int32;
}

function resolveDefType(node: NodeMap['def']): Type | undefined {
	const sym = node.symbol;
	if (sym.type) return sym.type;
	const declared = node.type ? resolveType(node.type) : undefined;
	const value = resolveType(node.value);
	const isImmutable = !(sym.flags & Flags.Variable);
	const t = isImmutable && value ? value : (declared ?? value);
	if (t) sym.type = t;
	return t;
}

function resolveFnType(node: NodeMap['fn']): Type {
	const sym = node.symbol;
	if (!sym.returnType && node.returnType)
		sym.returnType = resolver(node.returnType);
	if (node.parameters?.length) node.parameters.forEach(resolver);
	return sym;
}

function resolveParameterType(node: NodeMap['parameter']): Type | undefined {
	if (node.symbol.type) return node.symbol.type;
	if (node.type) {
		const t = resolver(node.type);
		node.symbol.type = t;
		return t;
	}
}

function resolvePropdefType(node: NodeMap['propdef']): Type {
	if (node.symbol.type) return node.symbol.type;
	const t = node.value ? resolver(node.value) : BT.Unknown;
	if (t.kind === 'function' || (t.kind === 'type' && t.family !== 'unknown'))
		node.symbol.type = t;
	return t;
}

function dispatchArms(node: Node): Node[] | undefined {
	if (node.kind !== '|') return undefined;
	const arms: Node[] = [];
	const walk = (n: Node): boolean => {
		if (n.kind === '|') return walk(n.children[0]) && walk(n.children[1]);
		// An arm is an inline fn value, or an ident naming a function (e.g. an
		// external like `out_i32`) — `out = out_i32 | out_str | …`.
		if (n.kind === 'fn') {
			arms.push(n);
			return true;
		}
		if (n.kind === 'ident') {
			const s = n.symbol;
			if (
				s.kind === 'function' ||
				(s.definition?.kind === 'def' && s.definition.value.kind === 'fn')
			) {
				arms.push(n);
				return true;
			}
		}
		return false;
	};
	return walk(node) ? arms : undefined;
}

function resolveType(node: CheckedNode): Type | undefined {
	switch (node.kind) {
		case 'def':
			return resolveDefType(node);
		case 'ident':
			return node.symbol.kind === 'function'
				? node.symbol
				: node.symbol.type;
		case 'typeident':
			return node.symbol;
		case 'call':
			return resolveReturnType(node.children[0]);
		case 'loop':
			return BT.Int32;
		case 'number':
			return BT[Number.isInteger(node.value) ? 'Int32' : 'Float64'];
		case 'string': {
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
		case 'parameter':
			return resolveParameterType(node);
		case 'fn':
			return resolveFnType(node);
		case 'data':
			return resolveDataType(node);
		case '.': {
			const left = node.children[0];
			const right = node.children[1];
			if (right.kind === 'ident') {
				const sym = right.symbol;
				if (sym.kind === 'function') return sym;
				if (sym.kind === 'variable' && sym.type) return sym.type;
			}
			const lt = resolver(left);
			if (
				lt.kind === 'type' &&
				lt.family === 'data'
			) {
				const keys = Object.keys(lt.members);
				let key: string | undefined;
				if (right.kind === 'number') key = keys[right.value];
				else if (right.kind === 'ident')
					key = right.symbol.name;
				const m = key !== undefined ? lt.members[key] : undefined;
				if (m?.kind === 'variable' && m.type) return m.type;
			}
			return BT.Unknown;
		}
		case '-':
		case '+':
		case '/':
		case '*':
			return resolveNumericOp(node);
		case '<=':
		case '>=':
		case '<':
		case '>':
		case '==':
		case '!=':
		case 'is':
		case '!':
		case '&&':
		case '||':
			return BT.Bool;
		case '?':
			return resolver(node.children[1]);
		case '>>': {
			const kids = node.children;
			const last = kids[kids.length - 1];
			if (!last) return BT.Unknown;
			if (last.kind === 'fn') {
				const ft = resolveFnType(last);
				if (ft.kind === 'function' && ft.returnType)
					return ft.returnType;
				const tail =
					last.statements?.[last.statements.length - 1];
				return tail ? resolver(tail) : BT.Unknown;
			}
			if (last.kind === 'ident')
				return resolveReturnType(last) ?? resolver(last);
			return resolver(last);
		}
		case '|': {
			const arms = dispatchArms(node);
			if (!arms) return BT.Unknown;
			const overloads: SymbolMap['function'][] = [];
			for (const a of arms) {
				if (a.kind === 'ident') {
					const d = a.symbol.definition;
					const fs =
						a.symbol.kind === 'function'
							? a.symbol
							: d?.kind === 'def' && d.value.kind === 'fn'
								? resolveFnType(d.value)
								: undefined;
					if (fs && fs.kind === 'function') overloads.push(fs);
					continue;
				}
				if (a.kind !== 'fn') continue;
				const t = resolveFnType(a);
				if (t.kind === 'function') overloads.push(t);
			}
			if (overloads.length !== arms.length) return BT.Unknown;
			return {
				kind: 'function',
				flags: 0,
				name: '__dispatch',
				returnType: unionOf(overloads.map(o => o.returnType ?? BT.Void)),
				overloads,
			};
		}
		case 'propdef':
			return resolvePropdefType(node);
		default:
			return BT.Unknown;
	}
}

/**
 * Determines the type of a node based on its kind and associated type declarations.
 */
function resolver(node: CheckedNode): Type {
	if (node[typeSymbol]) return node[typeSymbol];
	const t = reduceType(resolveType(node) ?? BT.Unknown, EMPTY_BINDINGS);
	// Don't cache an unresolved result: the walkPipes pre-pass may resolve an
	// expression whose referenced defs aren't typed yet; caching Unknown would
	// poison the later check pass. Re-resolving Unknown is idempotent.
	if (!(t.kind === 'type' && t.family === 'unknown')) node[typeSymbol] = t;
	return t;
}

function annotateDollar(node: CheckedNode, type: Type): void {
	if (node.kind === '$') {
		node[typeSymbol] = type;
		return;
	}
	if (node.kind === 'fn') return;
	if (!('children' in node) || !node.children) return;
	const kids = node.children;
	for (let i = 0; i < kids.length; i++) {
		const k = kids[i];
		if (k) annotateDollar(k, type);
	}
}

function isTypeParam(t: Type | undefined): boolean {
	return (
		t?.kind === 'type' &&
		t.family === 'unknown' &&
		!!t.name &&
		t.name !== 'Unknown'
	);
}

function unifyTP(
	paramType: Type | undefined,
	argType: Type | undefined,
	names: Set<string>,
	out: Map<string, Type>,
) {
	if (!paramType || !argType) return;
	if (isTypeParam(paramType) && paramType.name && names.has(paramType.name)) {
		if (!out.has(paramType.name)) out.set(paramType.name, argType);
		return;
	}
	if (
		paramType.kind === 'type' &&
		paramType.family === 'data' &&
		argType.kind === 'type' &&
		argType.family === 'data'
	) {
		const pk = Object.keys(paramType.members);
		const ak = Object.keys(argType.members);
		for (let i = 0; i < pk.length; i++)
			unifyTP(
				paramType.members[pk[i] ?? '']?.type,
				argType.members[ak[i] ?? '']?.type,
				names,
				out,
			);
	}
}

function refsAny(node: Node, outer: Set<Symbol>): boolean {
	if (node.kind === 'ident') return outer.has(node.symbol);
	if ('children' in node && node.children)
		for (let i = 0; i < node.children.length; i++) {
			const k = node.children[i];
			if (k && refsAny(k, outer)) return true;
		}
	if (node.kind === 'fn' || node.kind === 'main')
		for (const s of node.statements ?? []) if (s && refsAny(s, outer)) return true;
	return false;
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

function paramsMatch(
	params: Symbol[] | undefined,
	argTypes: (Type | undefined)[],
): boolean {
	const arity = params?.length ?? 0;
	if (arity !== argTypes.length) return false;
	for (let i = 0; i < arity; i++) {
		const want = params?.[i]?.type;
		const got = argTypes[i];
		if (!want || !got) continue;
		if (!canAssign(want, got)) return false;
	}
	return true;
}

function canAssign(to: Type, a: Type): boolean {
	if (to === a) return true;
	if (a.components?.some(c => canAssign(to, c))) return true;
	if (to.kind === 'function' && a.kind === 'function') {
		const tp = to.parameters ?? [];
		const ap = a.parameters ?? [];
		if (tp.length !== ap.length) return false;
		for (let i = 0; i < tp.length; i++) {
			const tt = tp[i]?.type;
			const at = ap[i]?.type;
			if (tt && at && !canAssign(tt, at)) return false;
		}
		if (to.returnType && a.returnType)
			return canAssign(to.returnType, a.returnType);
		return true;
	}
	if (to.kind !== 'type' || a.kind !== 'type') return false;
	if (to.family === 'unknown') return true;
	if (to.family === 'union')
		return to.members.some(m => canAssign(m, a));
	if (to.family === 'literal' && a.family === 'literal')
		return to.value === a.value;
	if (to.family === 'string') {
		if (a.family === 'string') return true;
		if (a.family === 'literal' && typeof a.value === 'string') return true;
	}
	if (to.family === 'data' && a.family === 'data') {
		// D49: a named type is nominal — its identity is the type-symbol
		// instance, not its structure. The `to === a` test at the top of this
		// function is that identity check, so reaching here means the instances
		// already differ; two types that each carry a declared identity are
		// therefore distinct and never assign, even with identical members. An
		// anonymous block (`__data`) has no declared identity, so it coerces
		// structurally into a named type.
		if (to.name !== '__data' && a.name !== '__data') return false;
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
		if (t.kind === 'type' && t.family !== 'void') seen.set(t.name, t);
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

// --- D43 type-level reduction engine ---

const EMPTY_BINDINGS: Map<string, Type> = new Map();
const MAX_REDUCE = 256;

function dataTypeOf(members: Type[]): Type {
	const m: Record<string, Symbol> = {};
	members.forEach((t, i) => {
		m[String(i)] = { kind: 'variable', name: String(i), flags: 0, type: t };
	});
	return { kind: 'type', flags: 0, name: '__data', family: 'data', size: 0, members: m };
}

// Head-rest split of a type (D39): scalar lifts to head + Void rest; data
// peels first member as head, remainder as rest (D10 collapse / Void).
function headRestOf(t: Type): { head: Type; rest: Type } | undefined {
	if (t.kind !== 'type' || t.family === 'void' || t.family === 'unknown')
		return undefined;
	if (t.family !== 'data') return { head: t, rest: BT.Void };
	const keys = Object.keys(t.members);
	if (keys.length === 0) return undefined;
	const head = t.members[keys[0] ?? '']?.type ?? BT.Unknown;
	const rest = keys.slice(1);
	if (rest.length === 0) return { head, rest: BT.Void };
	if (rest.length === 1)
		return { head, rest: t.members[rest[0] ?? '']?.type ?? BT.Unknown };
	return { head, rest: dataTypeOf(rest.map(k => t.members[k]?.type ?? BT.Unknown)) };
}

function containsApp(t: Type, seen = new Set<Type>()): boolean {
	if (t.kind !== 'type' || seen.has(t)) return false;
	seen.add(t);
	if (t.application) return true;
	if (t.family === 'union') return t.members.some(m => containsApp(m, seen));
	if (t.family === 'data')
		return Object.values(t.members).some(
			m => m.type !== undefined && containsApp(m.type, seen),
		);
	return false;
}

// Reduce a type under type-variable bindings: substitute bound vars, evaluate
// applications. Identity for ordinary types when there is nothing to do.
export function reduceType(t: Type, bindings: Map<string, Type>, depth = 0): Type {
	if (t.kind !== 'type') return t;
	if (depth > MAX_REDUCE) return BT.Unknown;
	if (t.application) return reduceApply(t, bindings, depth);
	if (t.family === 'unknown' && t.name && bindings.has(t.name))
		return bindings.get(t.name)!;
	if (!bindings.size && !containsApp(t)) return t;
	if (t.family === 'union')
		return unionOf(t.members.map(m => reduceType(m, bindings, depth + 1)));
	if (t.family === 'data') {
		const reduced: Type[] = [];
		for (const k of Object.keys(t.members)) {
			const mt = t.members[k]?.type;
			if (!mt) continue;
			const r = reduceType(mt, bindings, depth + 1);
			if (r.kind === 'type' && r.family === 'void') continue; // D40 drop
			reduced.push(r);
		}
		if (reduced.length === 0) return BT.Void;
		if (reduced.length === 1) return reduced[0]!; // D10 collapse
		return dataTypeOf(reduced);
	}
	return t;
}

function reduceApply(
	appSym: Type,
	bindings: Map<string, Type>,
	depth: number,
): Type {
	const app = appSym.application;
	if (!app || depth > MAX_REDUCE) return BT.Unknown;
	const fn = app.fn;
	const chain = fn.definition;
	const argTypes = app.argNodes.map(n =>
		reduceType(resolveType(n) ?? BT.Unknown, bindings, depth + 1),
	);
	if (!chain || chain.kind !== '>>') return BT.Unknown;
	const inner = new Map<string, Type>();
	(fn.typeParams ?? []).forEach((p, i) => {
		if (p.name && argTypes[i]) inner.set(p.name, argTypes[i]!);
	});
	return reduceChain(chain, inner, depth + 1);
}

function reduceChain(
	chain: NodeMap['>>'],
	bindings: Map<string, Type>,
	depth: number,
): Type {
	const kids = chain.children;
	const head = kids[0];
	let input = reduceType(
		(head && resolveType(head)) || BT.Unknown,
		bindings,
		depth + 1,
	);
	for (let i = 1; i < kids.length; i++) {
		const stage = kids[i];
		if (!stage || stage.kind !== 'fn') continue;
		const out = applyStage(stage, input, bindings, depth + 1);
		if (out === undefined)
			// Indeterminate when the input is an unresolved type param (e.g.
			// reducing a generic template's declared return); only a concrete
			// no-match collapses to Void (D40).
			return input.kind === 'type' && input.family === 'unknown'
				? BT.Unknown
				: BT.Void;
		input = out;
	}
	return input;
}

function applyStage(
	stage: NodeMap['fn'],
	input: Type,
	bindings: Map<string, Type>,
	depth: number,
): Type | undefined {
	const local = new Map(bindings);
	const pattern = stage.parameters?.[0]?.type;
	if (pattern?.kind === 'data') {
		const inner = pattern.children[0];
		const slots = inner?.kind === ',' ? inner.children : inner ? [inner] : [];
		const names = slots.map(s =>
			s?.kind === 'parameter' ? s.symbol.name : undefined,
		);
		let cur = input;
		for (let i = 0; i < names.length; i++) {
			if (i === names.length - 1) {
				if (names[i]) local.set(names[i]!, cur);
				break;
			}
			const hr = headRestOf(cur);
			if (!hr) return undefined; // input doesn't match the pattern
			if (names[i]) local.set(names[i]!, hr.head);
			cur = hr.rest;
		}
	}
	const body = stage.statements?.[0];
	if (!body) return BT.Void;
	return reduceType(resolveType(body) ?? BT.Unknown, local, depth + 1);
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

	function error(message: string, position: Position) {
		errors.push({ message, position });
	}

	function numberBinaryOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		const lt = resolver(left);
		const rt = resolver(right);
		if (isTypeParam(lt) || isTypeParam(rt)) return;
		if (!(isNumericType(lt) && isNumericType(rt))) {
			errors.push({
				message: `Operator "${
					node.kind
				}" cannot be applied to types "${typeToStr(
					lt,
				)}" and "${typeToStr(rt)}".`,
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
	function checkNext(node: NodeMap['next']) {
		const fn = node.owner;
		const val = node.children?.[0];
		const types: Type[] =
			val?.kind === ','
				? val.children
						.map(c => resolveType(c))
						.filter((t): t is Type => !!t)
				: val
					? [resolveType(val) ?? BT.Unknown]
					: [BT.Void];
		const type = unionOf(types);

		if (!fn.returnType) fn.returnType = type;
		else if (!canAssign(fn.returnType, type))
			error(
				`Type "${typeToStr(
					type,
				)}" is not assignable to type "${typeToStr(
					fn.returnType,
				)}".`,
				node,
			);
	}

	function chooseOverload(
		fn: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
	): SymbolMap['function'] | undefined {
		if (fn.overloads) {
			const match = [fn, ...fn.overloads].find(c =>
				paramsMatch(c.parameters, argTypes),
			);
			if (!match) {
				error(
					`No matching overload for ${fn.name ?? '?'}(${argTypes
						.map(typeToStr)
						.join(', ')})`,
					node,
				);
				return undefined;
			}
			return match;
		}
		if (
			(fn.parameters?.length ?? 0) > 0 &&
			argTypes.length === 0
		) {
			error(
				`No matching overload for ${fn.name ?? '?'}() — expected ${fn.parameters?.length ?? 0} argument(s)`,
				node,
			);
			return undefined;
		}
		return fn;
	}

	function checkCallArgs(
		chosen: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
	) {
		const params = chosen.parameters;
		if (!params?.length) return;
		const fnNode =
			chosen.definition && chosen.definition.kind === 'fn'
				? chosen.definition
				: undefined;
		const paramNodes = fnNode?.parameters;

		for (let i = 0; i < argTypes.length; i++) {
			const typeA = argTypes[i];
			const typeB = params[i]?.type;
			if (!typeA || !typeB) continue;
			const isVoidArg =
				typeA.kind === 'type' && typeA.family === 'void';
			const hasDefault = !!paramNodes?.[i]?.value;
			if (isVoidArg && hasDefault) continue;
			if (!canAssign(typeB, typeA))
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

	function checkCall(node: NodeMap['call']) {
		const calleeNode = node.children[0];
		const fn = resolveType(calleeNode);
		if (calleeNode.kind === 'typeident') {
			if (fn && fn.kind === 'type' && fn.family !== 'fn') return;
			error(`This expression is not callable`, node);
			return;
		}
		if (!fn || fn.kind !== 'function') {
			error(`This expression is not callable`, node);
			return;
		}

		const args = node.children[1];
		const argTypes = args
			? args.kind === ',' ? getListTypes(args) : [resolver(args)]
			: [];

		const chosen = chooseOverload(fn, argTypes, node);
		if (!chosen || !args) return;
		checkTypeArgConstraints(chosen, argTypes, node);
		checkCallArgs(chosen, argTypes, node);
	}

	function checkTypeArgConstraints(
		chosen: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
	) {
		const fnNode =
			chosen.definition?.kind === 'fn' ? chosen.definition : undefined;
		const tparams = fnNode?.typeParameters;
		if (!tparams?.length) return;
		const names = new Set(
			tparams.map(t => t.symbol.name).filter((n): n is string => !!n),
		);
		const subst = new Map<string, Type>();
		(chosen.parameters ?? []).forEach((p, i) =>
			unifyTP(p.type, argTypes[i], names, subst),
		);
		for (const tp of tparams) {
			if (!tp.type) continue;
			const constraint = resolveType(tp.type);
			const bound = tp.symbol.name ? subst.get(tp.symbol.name) : undefined;
			if (constraint && bound && !canAssign(constraint, bound))
				error(
					`Type argument "${typeToStr(
						bound,
					)}" does not satisfy constraint "${typeToStr(
						constraint,
					)}" for type parameter "${tp.symbol.name ?? '?'}"`,
					node,
				);
		}
	}

	function checkDef(node: NodeMap['def']) {
		const sym = node.symbol;
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
		const usedExternally = sym.references?.some(
			r => r.start < node.start || r.start >= node.end,
		);
		if (!usedExternally && !(sym.flags & Flags.Export))
			error(
				`"${sym.name}" is declared but never used`,
				node.label,
			);
		check(node.value);
	}

	function checkAssign(node: NodeMap['=']) {
		const left = node.children[0];
		if (left.kind === 'ident') {
			const sym = left.symbol;
			if (!(sym.flags & Flags.Variable))
				error(
					`Cannot reassign immutable binding "${sym.name ?? ''}"`,
					left,
				);
		}
		check(node.children[1]);
	}

	function checkFnDef(node: NodeMap['fn']) {
		resolver(node);
		if (
			!node.typeParameters?.length &&
			node.symbol.returnType &&
			node.statements?.length === 1
		) {
			const stmt = node.statements[0];
			if (
				stmt &&
				stmt.kind !== 'next' &&
				stmt.kind !== 'done' &&
				stmt.kind !== 'break'
			) {
				const t = resolveType(stmt);
				if (t && !isTypeParam(t) && !canAssign(node.symbol.returnType, t))
					error(
						`Type "${typeToStr(t)}" is not assignable to return type "${typeToStr(node.symbol.returnType)}"`,
						stmt,
					);
			}
		}
		const bindings = new Set<Symbol>();
		node.parameters?.forEach(p => bindings.add(p.symbol));
		node.statements?.forEach(s => {
			if (s?.kind === 'def') bindings.add(s.symbol);
		});
		if (bindings.size)
			node.statements?.forEach(s => {
				if (!s) return;
				const emitted =
					s.kind === 'fn'
						? s
						: s.kind === 'next' && s.children?.[0]?.kind === 'fn'
							? s.children[0]
							: undefined;
				if (emitted && refsAny(emitted, bindings))
					error(
						'function captures an enclosing binding; closures are not allowed (D45)',
						emitted,
					);
			});
		if (node.statements) checkEach(node.statements);
	}

	function checkStageOnlyStmt(c: NodeMap['fn'], i: number) {
		const stmts = c.statements;
		if (stmts?.length !== 1) return;
		const only = stmts[0];
		if (only?.kind === 'next')
			error(
				'`next` is not allowed in auto-emit body. Use `{ X }` to emit X directly, or `{ next X; }` for a statement body.',
				only,
			);
		else if (
			only?.kind === 'done' &&
			i === 0 &&
			!c.parameters
		)
			error(
				'`done` alone in a block is a no-op and not allowed.',
				only,
			);
		else if (
			only?.kind === 'break' &&
			i === 0 &&
			!c.parameters
		)
			error(
				'`break` alone in a source block is not allowed.',
				only,
			);
	}

	function checkStageReturnType(c: NodeMap['fn']) {
		if (!c.returnType || c.statements?.length !== 1) return;
		const stmt = c.statements[0];
		if (
			!stmt ||
			stmt.kind === 'next' ||
			stmt.kind === 'done' ||
			stmt.kind === 'break'
		)
			return;
		resolver(c);
		const t = resolver(stmt);
		const known = !(t.kind === 'type' && t.family === 'unknown');
		if (known && c.symbol.returnType && !canAssign(c.symbol.returnType, t))
			error(
				`Type "${typeToStr(t)}" is not assignable to return type "${typeToStr(c.symbol.returnType)}"`,
				stmt,
			);
	}

	function checkPipeStageFn(c: NodeMap['fn'], i: number) {
		const stmts = c.statements;
		const hasStmts = !!stmts?.length;
		if (c.parameters?.length === 0 && !hasStmts)
			error(
				'Empty `() { }` is not allowed; use `{ }` for a no-op function.',
				c,
			);
		if (c.parameters?.length && !hasStmts)
			error('empty body in a typed block is invalid', c);
		checkStageOnlyStmt(c, i);
		if (
			!(c.symbol.flags & Flags.Sequence) &&
			hasStmts &&
			!c.parameters?.length
		) {
			const emits = stmts.some(
				s =>
					s.kind === 'next' ||
					s.kind === 'break' ||
					s.kind === 'done',
			);
			if (!emits)
				error(
					'Statement body produces no emission; use `,` for auto-emit or add `next`.',
					c,
				);
		}
		if (
			!(c.symbol.flags & Flags.Sequence) &&
			stmts &&
			stmts.length > 1 &&
			c.parameters?.length &&
			!c.returnType &&
			stmts.every(
				s =>
					s.kind === 'next' &&
					s.children?.[0]?.kind !== ',',
			)
		)
			error(
				'Statement body is reducible to comma form `{ X1, X2 }`',
				c,
			);
		checkStageReturnType(c);
	}

	function checkPipe(node: NodeMap['>>']) {
		inferPipeStageParams(node.children);
		for (let i = 0; i < node.children.length; i++) {
			const c = node.children[i];
			if (!c) continue;
			if (c.kind === 'fn') checkPipeStageFn(c, i);
			else check(c);
		}
	}

	function checkTernary(node: NodeMap['?']) {
		const [cond, truthy, falsy] = node.children;
		check(cond);
		check(truthy);
		if (falsy) check(falsy);
		if (
			!falsy &&
			truthy.kind !== 'break' &&
			truthy.kind !== 'done'
		)
			error(
				'`?:` requires both branches for value-only forms; use `break`/`done` for control flow.',
				node,
			);
	}

	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkEach(node.children);
			case 'fn':
				return checkFnDef(node);
			case 'main':
				return checkEach(node.statements);
			case 'test':
				return checkEach(node.statements);
			case 'data': {
				const inner = node.children[0];
				const items =
					inner?.kind === ',' ? inner.children : inner ? [inner] : [];
				return checkEach(items);
			}
			case 'next':
				return checkNext(node);
			case 'call':
				return checkCall(node);
			case 'def':
				return checkDef(node);
			case '=':
				return checkAssign(node);
			case '<=':
			case '>=':
			case '<':
			case '>':
			case '-':
			case '+':
			case '/':
			case '*':
				return numberBinaryOperator(node);
			case '==':
			case '!=': {
				check(node.children[0]);
				check(node.children[1]);
				const isVoid = (n: Node) => {
					const t = resolver(n);
					return t.kind === 'type' && t.family === 'void';
				};
				if (isVoid(node.children[0]) || isVoid(node.children[1]))
					error(
						`void is not comparable; use length(x) == 0 to test for the empty terminal`,
						node,
					);
				return;
			}
			case '>>':
				return checkPipe(node);
			case '?':
				return checkTernary(node);
			case '|':
			case ',':
				for (const c of node.children) check(c);
				return;
			default:
				return;
		}
	}

	function paramDeclaredType(
		stage: Node,
		idx: number,
	): Type | undefined {
		if (stage.kind !== 'fn') return undefined;
		const pNode = stage.parameters?.[idx];
		if (!pNode?.type) return undefined;
		if (pNode.type.kind !== 'typeident') return undefined;
		const s = pNode.type.symbol;
		return s.kind === 'type' ? s : undefined;
	}

	function checkStageReachable(stage: Node, input: Node) {
		const prevFn = pipeStageFn(input);
		if (!prevFn) return;
		resolver(input);
		if (
			prevFn.returnType?.kind !== 'type' ||
			prevFn.returnType.family !== 'void'
		)
			return;
		const blocked =
			stage.kind === 'fn' ||
			(stage.kind === 'ident' &&
				stage.symbol.kind !== 'function' &&
				pipeStageFn(stage));
		if (blocked)
			error('stage is unreachable: previous stage returns Void', stage);
	}

	function inferSingleParamStage(
		stage: Node,
		p: Symbol,
		inputType: SymbolMap['type'],
	) {
		// D39: single slot binds the whole upstream value.
		const declared = paramDeclaredType(stage, 0) ?? p.type;
		if (
			declared &&
			declared.kind === 'type' &&
			inputType.family === 'data' &&
			declared.family !== 'data' &&
			declared.family !== 'union' &&
			declared.family !== 'unknown'
		) {
			error(
				`stage parameter of type "${typeToStr(declared)}" is not assignable from data-block input`,
				stage,
			);
			return;
		}
		if (!p.type) p.type = inputType;
	}

	// D39 rest slot: [] → Void; one → that type (D10 collapse); many → data.
	function restSlotType(
		members: Record<string, Symbol>,
		keys: string[],
		start: number,
	): Type {
		const rest = keys.slice(start);
		if (rest.length === 0) return BT.Void;
		if (rest.length === 1)
			return members[rest[0] ?? '']?.type ?? BT.Unknown;
		const out: Record<string, Symbol> = {};
		rest.forEach((k, i) => {
			out[String(i)] = {
				kind: 'variable',
				name: String(i),
				flags: 0,
				type: members[k]?.type ?? BT.Unknown,
			};
		});
		return {
			kind: 'type',
			flags: 0,
			name: '__data',
			family: 'data',
			size: 0,
			members: out,
		};
	}

	function inferMultiParamStage(
		stage: Node,
		params: Symbol[],
		inputType: SymbolMap['type'],
	) {
		// D39: last slot binds rest; scalar input lifts to [scalar] (D10).
		const members: Record<string, Symbol> =
			inputType.family === 'data'
				? inputType.members
				: {
						'0': {
							kind: 'variable',
							name: '0',
							flags: 0,
							type: inputType,
						},
					};
		const keys = Object.keys(members);
		if (keys.length === 0) return; // unknown arity — leave slots uninferred
		const headCount = params.length - 1;
		if (keys.length < headCount) {
			error(
				`no match: stage with ${params.length} slots needs at least ${headCount} input element(s), got ${keys.length}`,
				stage,
			);
			return;
		}
		params.forEach((p, idx) => {
			const bound =
				idx < headCount
					? (members[keys[idx] ?? '']?.type ?? BT.Unknown)
					: restSlotType(members, keys, headCount);
			const declared = paramDeclaredType(stage, idx);
			if (
				declared &&
				declared.kind === 'type' &&
				declared.family !== 'unknown' &&
				!canAssign(declared, bound)
			)
				error(
					`stage parameter of type "${typeToStr(
						declared,
					)}" is not assignable from "${typeToStr(bound)}"`,
					stage,
				);
			if (!p.type) p.type = bound;
		});
	}

	function inferPipeStage(stage: Node, input: Node) {
		checkStageReachable(stage, input);
		const fnSym = pipeStageFn(stage);
		if (!fnSym) return;
		const inputType = resolver(input);
		const params = fnSym.parameters;
		if (
			stage.kind === 'fn' &&
			stage.statements &&
			inputType.kind === 'type' &&
			inputType.family !== 'unknown'
		) {
			const p0 = params?.[0];
			const single = params?.length === 1 && !!p0 && !p0.name;
			const dollarT = single
				? (paramDeclaredType(stage, 0) ?? p0.type ?? inputType)
				: inputType;
			for (const s of stage.statements) if (s) annotateDollar(s, dollarT);
		}
		if (!params?.length) return;
		if (inputType.kind !== 'type' || inputType.family === 'unknown')
			return;
		if (params.length === 1) {
			const p = params[0];
			if (p) inferSingleParamStage(stage, p, inputType);
			return;
		}
		inferMultiParamStage(stage, params, inputType);
	}

	function inferPipeStageParams(children: Node[]) {
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			inferPipeStage(stage, input);
		}
	}

	function pipeStageFn(stage: Node): SymbolMap['function'] | undefined {
		if (stage.kind === 'fn') return stage.symbol;
		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			if (sym.kind === 'function') return sym;
			if (sym.kind === 'variable') {
				if (sym.type?.kind === 'function') return sym.type;
				const def = sym.definition;
				if (def?.kind === 'def' && def.value.kind === 'fn')
					return def.value.symbol;
			}
		}
	}

	function walkPipes(node: Node) {
		if (node.kind === '>>') inferPipeStageParams(node.children);
		switch (node.kind) {
			case 'string':
			case 'number':
			case 'literal':
			case 'loop':
			case 'done':
			case 'break':
			case 'comment':
			case '$':
			case '@':
			case 'ident':
			case 'label':
			case 'typeident':
				return;
			default: {
				const children = node.children;
				if (children)
					for (let i = 0; i < children.length; i++) {
						const c = children[i];
						if (c && c.kind !== 'ident') walkPipes(c);
					}
				const statements =
					node.kind === 'fn' || node.kind === 'main'
						? node.statements
						: undefined;
				if (statements) for (const s of statements) walkPipes(s);
			}
		}
	}

	return {
		run: () => {
			walkPipes(root);
			check(root);
		},
		resolver,
	};
}
