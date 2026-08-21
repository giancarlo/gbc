import { CompilerError, Position, text } from '../sdk/index.js';

import type { InfixNode, Node, NodeMap } from './node.js';
import {
	BaseTypes as BT,
	BufferSymbol,
	Flags,
	bufferTypeOf,
	emissionElements,
	fixedEmissionType,
	restEmissionType,
	isFloatType,
	isHeapType,
	isIntType,
	isCollection,
	isNumericType,
	numberLiteralType,
	numericResultType,
	unifyTypeParam,
} from './symbol-table.js';
import type {
	OwnershipMode,
	ResolvedType,
	Symbol,
	SymbolMap,
	Type,
} from './symbol-table.js';

const typeSymbol = Symbol('type');
type CheckedNode = Node & { [typeSymbol]?: Type };

// The stdlib `DivByZero` type, injected at program init so the free
// type-resolution layer can build `Int32 | DivByZero` for runtime division.
let divByZero: Type | undefined;
export function setDivByZero(t: Type | undefined): void {
	divByZero = t;
}

const invalidType: ResolvedType = {
	kind: 'type',
	name: 'Invalid',
	flags: Flags.None,
	family: 'invalid',
	size: 0,
};

function isInvalidType(type: Type): boolean {
	return type === invalidType;
}

const resolving = new Set<Symbol>();

const intRange: Record<string, [bigint, bigint]> = {
	int1: [-0x80n, 0x7fn],
	int2: [-0x8000n, 0x7fffn],
	int4: [-0x80000000n, 0x7fffffffn],
	int8: [-(1n << 63n), (1n << 63n) - 1n],
	uint1: [0n, 0xffn],
	uint2: [0n, 0xffffn],
	uint4: [0n, 0xffffffffn],
	uint8: [0n, (1n << 64n) - 1n],
};

/** An int literal adopts any integer type whose range holds its value. */
function literalFits(
	node: Node | undefined,
	target: Type | undefined,
): boolean {
	if (!node || node.kind !== 'number' || node.float) return false;
	if (!target || target.kind !== 'type') return false;
	const r = intRange[target.family + target.size];
	return !!r && node.value >= r[0] && node.value <= r[1];
}

/** literalFits through two-armed ternaries — each branch may adopt or assign. */
function branchesFit(node: Node | undefined, target: Type): boolean {
	if (!node) return false;
	if (node.kind === '?' && node.children[2])
		return (
			branchesFit(node.children[1], target) &&
			branchesFit(node.children[2], target)
		);
	if (literalFits(node, target)) return true;
	const t = resolveType(node);
	if (!t || (t.kind === 'type' && t.family === 'unknown')) return true;
	return canAssign(target, t);
}

function typeToStr(type?: Type): string {
	if (type?.kind === 'type' && type.family === 'emission') {
		if (type.name) return type.name;
		const elements = type.elements.map((element, index) => {
			const ownership = type.ownerships[index];
			return `${ownership && ownership !== 'borrow' ? `${ownership} ` : ''}${typeToStr(element)}`;
		});
		if (type.rest) {
			const ownership = type.restOwnership;
			elements.push(
				`...${ownership && ownership !== 'borrow' ? `${ownership} ` : ''}${typeToStr(type.rest)}`,
			);
		}
		return `{ ${elements.join(', ')} }`;
	}
	if (type?.kind === 'type' && type.family === 'union')
		return type.members.map(m => m.name).join(' | ');
	if (type?.kind === 'type' && type.family === 'buffer')
		return `${type.name}<${typeToStr(type.elem)}>`;
	return type?.name || 'unknown';
}

// `Buffer<T>(cap)` constructs a buffer; its element type comes from the applied
// type argument on the callee (`Buffer<Int32>`). A bare `Buffer` with no type
// arg is reported by `checkBufferCtorArg`.
function bufferCtorType(node: NodeMap['call']): Type | undefined {
	const callee = node.children[0];
	if (callee.kind !== 'typeident') return undefined;
	const sym = callee.symbol;
	if (sym === BufferSymbol) return bufferTypeOf(BT.Unknown);
	return isCollection(sym.type) ? sym.type : undefined;
}

function functionElementReturn(
	fn: SymbolMap['function'] | undefined,
): Type | undefined {
	if (fn?.returnType) return fn.returnType;
	if (!fn?.emissionType) return undefined;
	const emitted = emissionElements(fn.emissionType);
	return emitted.length === 1
		? emitted[0]
		: emitted.length
			? unionOf(emitted)
			: undefined;
}

function callReturnType(node: NodeMap['call']): Type | undefined {
	const buf = bufferCtorType(node);
	if (buf) return buf;
	const fnSym = resolveFunctionType(node.children[0]);
	const rt =
		resolveReturnType(node.children[0]) ?? functionElementReturn(fnSym);
	if (!rt || rt.kind !== 'type' || !fnSym) return rt;
	const argsNode = node.children[1];
	const args =
		argsNode?.kind === ',' ? argsNode.children : argsNode ? [argsNode] : [];
	return substituteFunctionReturn(rt, fnSym, args.map(resolver));
}

function resolveFunctionType(node: Node): SymbolMap['function'] | undefined {
	const ft = resolver(node);
	const resolved = ft.kind === 'function'
		? ft
		: ft.type?.kind === 'function'
			? ft.type
			: undefined;
	if (resolved || node.kind !== 'ident') return resolved;
	const definition = node.symbol.definition;
	if (definition?.kind !== 'parameter' || !definition.type) return;
	const declared = resolver(definition.type);
	if (declared.kind === 'function') {
		definition.symbol.type = declared;
		return declared;
	}
}

function substituteFunctionReturn(
	rt: Type,
	fnSym: SymbolMap['function'],
	args: Type[],
): Type {
	const fnNode =
		fnSym.definition?.kind === 'fn' ? fnSym.definition : undefined;
	const tparams =
		fnSym.typeParams ??
		fnNode?.typeParameters
			?.map(p => p.symbol.type)
			.filter((t): t is Type => !!t);
	if (!tparams?.length) return rt;
	const names = new Set(
		tparams.map(t => t.name).filter((n): n is string => !!n),
	);
	const subst = new Map<string, Type>();
	(fnSym.parameters ?? []).forEach((p, i) =>
		unifyTypeParam(p.type, args[i], names, subst),
	);
	return reduceType(rt, subst);
}

function pipeArgumentTypes(
	input: Type,
	fnSym: SymbolMap['function'],
): Type[] {
	const params = fnSym.parameters ?? [];
	if (params.length <= 1) return params.length === 0 ? [] : [input];
	if (input.kind !== 'type' || input.family !== 'data')
		return [input];
	const keys = Object.keys(input.members);
	return params.map((p, i) => {
		const named = p.name ? keys.indexOf(p.name) : -1;
		const key = keys[named >= 0 ? named : i];
		return key === undefined
			? BT.Unknown
			: (input.members[key]?.type ?? BT.Unknown);
	});
}

function resolveFunctionStageReturn(stage: Node, input: Type): Type | undefined {
	const fnSym = resolveFunctionType(stage);
	const rt = functionElementReturn(fnSym);
	if (!fnSym || !rt) return undefined;
	const args = pipeArgumentTypes(input, fnSym);
	return substituteFunctionReturn(rt, fnSym, args);
}

function resolveReturnType(node: Node) {
	const type = resolver(node);
	if (type.kind === 'function' && type.returnType) return type.returnType;
	if (type.kind === 'type' && type.family !== 'fn') return type;
}

function resolveDataType(node: NodeMap['data']): Type {
	const inner = node.children[0];
	const items =
		inner?.kind === ',' ? inner.children : inner ? [inner] : [];
	const only = items[0];
	if (
		items.length === 1 &&
		only &&
		!(only.kind === 'propdef' && only.label)
	)
		return resolveType(only) ?? BT.Unknown;
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

export function isKnownNonZeroNumber(
	node: Node,
	seen?: Set<Symbol>,
): boolean {
	if (node.kind === 'number') return node.value !== 0;
	if (node.kind !== 'ident') return false;
	const sym = node.symbol;
	if (sym.flags & Flags.Variable || seen?.has(sym)) return false;
	const definition = sym.definition;
	if (definition?.kind !== 'def') return false;
	const visited = seen ?? new Set<Symbol>();
	visited.add(sym);
	return isKnownNonZeroNumber(definition.value, visited);
}

function resolveNumericOp(node: InfixNode): Type {
	const lType = resolver(node.children[0]);
	const rType = resolver(node.children[1]);

	if (isInvalidType(lType) || isInvalidType(rType)) return invalidType;
	if (
		(lType.kind === 'type' && lType.family === 'unknown') ||
		(rType.kind === 'type' && rType.family === 'unknown')
	)
		return BT.Unknown;
	if (!isNumericType(lType) || !isNumericType(rType)) return invalidType;
	const base = numericResultType(lType, rType) ?? BT.Int32;
	if (isFloatType(base)) return base;
	// Integer division by a value that isn't a known non-zero literal can
	// fail, so the result type carries `DivByZero` (const-fold narrows the
	// literal case back to plain `Int`).
	if ((node.kind === '/' || node.kind === '%') && divByZero) {
		const rhs = node.children[1];
		if (!isKnownNonZeroNumber(rhs))
			return unionOf([base, divByZero]);
	}
	return base;
}

function resolveBitwiseType(node: InfixNode): Type {
	const lType = resolver(node.children[0]);
	const rType = resolver(node.children[1]);
	return numericResultType(lType, rType) ?? BT.Int32;
}

function resolveDefType(node: NodeMap['def']): Type | undefined {
	const sym = node.symbol;
	if (sym.type) return sym.type;
	if (resolving.has(sym)) return undefined;
	resolving.add(sym);
	const declared = node.type ? resolveType(node.type) : undefined;
	const value = resolveType(node.value);
	resolving.delete(sym);
	let t = value ?? declared;
	if (declared && t !== declared && literalFits(node.value, declared))
		t = declared;
	if (t) sym.type = t;
	return t;
}

const inferringReturn = new Set<Symbol>();
type EmissionShape = Extract<ResolvedType, { family: 'emission' }>;

function fixedEmissionShape(
	elements: Type[],
	ownerships?: OwnershipMode[],
): EmissionShape {
	const emission = fixedEmissionType(elements, ownerships);
	if (emission.family !== 'emission') throw new Error('Invalid emission type');
	return emission;
}

function restEmissionShape(
	elements: Type[],
	ownerships: OwnershipMode[],
	rest: Type,
	restOwnership?: OwnershipMode,
): EmissionShape {
	const emission = restEmissionType(
		elements,
		ownerships,
		rest,
		restOwnership,
	);
	if (emission.family !== 'emission') throw new Error('Invalid emission type');
	return emission;
}

function knownEmissionType(type: Type | undefined): type is Type {
	return !!type && !(type.kind === 'type' && type.family === 'unknown');
}

function knownEmission(emission: EmissionShape): boolean {
	return (
		emission.elements.every(knownEmissionType) &&
		(emission.rest === undefined || knownEmissionType(emission.rest))
	);
}

function concatEmissionList(
	emissions: EmissionShape[],
): EmissionShape | undefined {
	const elements: Type[] = [];
	const ownerships: OwnershipMode[] = [];
	let tail: EmissionShape | undefined;
	for (let i = 0; i < emissions.length; i++) {
		const emission = emissions[i];
		if (!emission) continue;
		if (tail) return undefined;
		elements.push(...emission.elements);
		ownerships.push(...emission.ownerships);
		if (emission.rest) tail = emission;
	}
	return tail?.rest
		? restEmissionShape(
				elements,
				ownerships,
				tail.rest,
				tail.restOwnership,
			)
		: fixedEmissionShape(elements, ownerships);
}

function mergeAlternativeEmissions(
	left: EmissionShape,
	right: EmissionShape,
): EmissionShape | undefined {
	if (
		left.elements.length !== right.elements.length ||
		!!left.rest !== !!right.rest
	)
		return undefined;
	const ownerships: OwnershipMode[] = [];
	const elements: Type[] = [];
	for (let i = 0; i < left.elements.length; i++) {
		const l = left.elements[i];
		const r = right.elements[i];
		const lo = left.ownerships[i];
		const ro = right.ownerships[i];
		if (!l || !r || lo !== ro) return undefined;
		elements.push(unionOf([l, r]));
		ownerships.push(lo ?? 'borrow');
	}
	if (!left.rest || !right.rest)
		return fixedEmissionShape(elements, ownerships);
	if (left.restOwnership !== right.restOwnership) return undefined;
	return restEmissionShape(
		elements,
		ownerships,
		unionOf([left.rest, right.rest]),
		left.restOwnership,
	);
}

function callEmissionType(node: NodeMap['call']): EmissionShape | undefined {
	const fn = resolveFunctionType(node.children[0]);
	if (!fn) return undefined;
	let emission = fn.emissionType;
	if (!emission && fn.returnTypes && !fn.returnVariants)
		emission = fixedEmissionType(fn.returnTypes, fn.returnOwnerships);
	if (emission?.family !== 'emission') {
		if (fn.returnVariants) return undefined;
		const scalar = callReturnType(node);
		if (!knownEmissionType(scalar)) return undefined;
		return scalar.kind === 'type' && scalar.family === 'void'
			? fixedEmissionShape([])
			: fixedEmissionShape([scalar]);
	}
	const argsNode = node.children[1];
	const args =
		argsNode?.kind === ',' ? argsNode.children : argsNode ? [argsNode] : [];
	const specialized = substituteFunctionReturn(
		emission,
		fn,
		args.map(resolver),
	);
	if (specialized.kind !== 'type' || specialized.family !== 'emission')
		return undefined;
	return knownEmission(specialized) ? specialized : undefined;
}

function stageEmissionType(stage: Node): EmissionShape | undefined {
	if (stage.kind === '|') {
		const left = stageEmissionType(stage.children[0]);
		const right = stageEmissionType(stage.children[1]);
		return left && right
			? mergeAlternativeEmissions(left, right)
			: undefined;
	}
	const fn = resolveFunctionType(stage);
	if (!fn) return undefined;
	if (fn.emissionType?.family === 'emission') return fn.emissionType;
	if (fn.returnTypes && !fn.returnVariants)
		return fixedEmissionShape(fn.returnTypes, fn.returnOwnerships);
	return stage.kind === 'fn'
		? inferFnEmission(stage, true)
		: undefined;
}

function homogeneousEmission(
	emission: EmissionShape,
): { type: Type; ownership: OwnershipMode } | undefined {
	const types = [
		...emission.elements,
		...(emission.rest ? [emission.rest] : []),
	];
	if (!types.length || types.some(type => !knownEmissionType(type))) return;
	const ownerships = [
		...emission.ownerships,
		...(emission.rest ? [emission.restOwnership ?? 'borrow'] : []),
	];
	const type = types[0];
	const ownership = ownerships[0] ?? 'borrow';
	if (
		!type ||
		types.some(candidate =>
			candidate !== type &&
			!(canAssign(type, candidate) && canAssign(candidate, type)),
		) ||
		ownerships.some(candidate => candidate !== ownership)
	)
		return;
	return { type, ownership };
}

function applyRepeatedEmission(
	input: EmissionShape,
	stage: EmissionShape,
): EmissionShape | undefined {
	const prefix = concatEmissionList(input.elements.map(() => stage));
	if (!prefix) return undefined;
	if (!input.rest) return prefix;
	if (stage.rest && input.elements.length) return undefined;
	const repeated = homogeneousEmission(stage);
	if (!repeated) return stage.elements.length || stage.rest ? undefined : prefix;
	if (prefix.rest) return undefined;
	return restEmissionShape(
		prefix.elements,
		prefix.ownerships,
		repeated.type,
		repeated.ownership,
	);
}

function pipeEmissionType(node: NodeMap['>>']): EmissionShape | undefined {
	const source = node.children[0];
	if (!source) return fixedEmissionShape([]);
	let emission =
		source.kind === 'loop'
			? restEmissionShape([], [], BT.Int32)
			: valueEmissionType(source);
	if (!emission) return undefined;
	for (let i = 1; i < node.children.length; i++) {
		const stage = node.children[i];
		if (!stage) continue;
		const output = stageEmissionType(stage);
		if (!output) return undefined;
		const applied = applyRepeatedEmission(emission, output);
		if (!applied) return undefined;
		emission = applied;
	}
	return knownEmission(emission) ? emission : undefined;
}

function conditionalEmissionType(
	node: NodeMap['?'],
	contextual: boolean,
): EmissionShape | undefined {
	const truthy = node.children[1];
	const falsy = node.children[2];
	if (truthy.kind === 'break' || truthy.kind === 'done')
		return falsy
			? valueEmissionType(falsy, contextual)
			: fixedEmissionShape([]);
	if (falsy?.kind === 'break' || falsy?.kind === 'done')
		return valueEmissionType(truthy, contextual);
	if (!falsy) return undefined;
	const left = valueEmissionType(truthy, contextual);
	const right = valueEmissionType(falsy, contextual);
	return left && right
		? mergeAlternativeEmissions(left, right)
		: undefined;
}

function valueEmissionType(
	node: Node,
	contextual = false,
): EmissionShape | undefined {
	if (node.kind === ',') {
		const parts: EmissionShape[] = [];
		for (const child of node.children) {
			const emissions = valueEmissionType(child, contextual);
			if (!emissions) return undefined;
			parts.push(emissions);
		}
		return concatEmissionList(parts);
	}
	if (node.kind === '?') return conditionalEmissionType(node, contextual);
	if (node.kind === 'call') return callEmissionType(node);
	if (node.kind === '>>') return pipeEmissionType(node);
	const type = contextual ? resolver(node) : resolveType(node);
	if (!knownEmissionType(type)) return undefined;
	if (type.kind === 'type' && type.family === 'void')
		return fixedEmissionShape([]);
	return fixedEmissionShape([type]);
}

function inferFnEmission(
	node: NodeMap['fn'],
	contextual = false,
): EmissionShape | undefined {
	const stmts = node.statements ?? [];
	if (!stmts.length) return fixedEmissionShape([]);
	const parts: EmissionShape[] = [];
	for (const statement of stmts) {
		if (statement.kind === 'done' || statement.kind === 'break') break;
		if (statement.kind !== 'next') continue;
		const value = statement.children?.[0];
		if (!value) continue;
		const emissions = valueEmissionType(value, contextual);
		if (!emissions) return undefined;
		parts.push(emissions);
	}
	return concatEmissionList(parts);
}

function resolveDeclaredFnOutputs(node: NodeMap['fn']): void {
	const sym = node.symbol;
	if (!sym.returnVariants && node.returnVariants)
		sym.returnVariants = node.returnVariants.map(variant =>
			variant.map(resolver),
		);
	if (!sym.returnTypes && node.returnTypes) {
		sym.returnTypes = node.returnTypes.map(resolver);
		const rest = node.returnRestType
			? resolver(node.returnRestType)
			: undefined;
		sym.emissionType = rest
			? restEmissionType(
					sym.returnTypes,
					sym.returnOwnerships ?? [],
					rest,
					node.returnRestOwnership,
				)
			: fixedEmissionType(sym.returnTypes, sym.returnOwnerships);
	}
	if (sym.returnTypes || !node.returnType) return;
	const type = resolver(node.returnType);
	if (type.kind === 'type' && type.family === 'emission') {
		sym.emissionType = type;
		sym.returnTypes = type.elements;
		sym.returnOwnerships = type.ownerships;
		sym.returnOwnership = type.ownerships[0] ?? sym.returnOwnership;
		return;
	}
	sym.returnTypes = type.kind === 'type' && type.family === 'void' ? [] : [type];
	sym.emissionType = fixedEmissionType(
		sym.returnTypes,
		sym.returnTypes.map(() => sym.returnOwnership ?? 'borrow'),
	);
}

function setFnElementReturn(node: NodeMap['fn']): void {
	const sym = node.symbol;
	if (
		sym.emissionType?.family === 'emission' &&
		sym.emissionType.rest &&
		!node.returnType &&
		!node.returnRestType
	)
		return;
	const emittedTypes = sym.emissionType
		? emissionElements(sym.emissionType)
		: sym.returnVariants?.flat() ?? sym.returnTypes;
	if (!sym.emissionType && sym.returnTypes && !sym.returnVariants)
		sym.emissionType = fixedEmissionType(
			sym.returnTypes,
			sym.returnOwnerships,
		);
	if (emittedTypes?.length) {
		sym.returnType =
			emittedTypes.length === 1 ? emittedTypes[0] : unionOf(emittedTypes);
		return;
	}
	const hasValueStatement = node.statements?.some(
		statement => statement.kind !== 'break' && statement.kind !== 'done',
	);
	if (node.returnType || (sym.returnTypes && hasValueStatement))
		sym.returnType = BT.Void;
}

function inferFnElementReturn(node: NodeMap['fn']): void {
	if (node.symbol.returnType) return;
	const statements = node.statements ?? [];
	for (let i = 0; i < statements.length - 1; i++)
		if (statements[i]?.kind === 'next') return;
	const tail = statements[statements.length - 1];
	if (!tail) return;
	const value = tail.kind === 'next' ? tail.children?.[0] : tail;
	if (
		!value ||
		value.kind === 'def' ||
		value.kind === '=' ||
		value.kind === 'break' ||
		value.kind === 'done' ||
		value.kind === '>>'
	)
		return;
	const emission = valueEmissionType(value, true);
	if (emission?.rest || (emission?.elements.length ?? 0) > 1) {
		node.symbol.returnType = BT.Void;
		return;
	}
	const type = resolver(value);
	if (type.kind === 'type') node.symbol.returnType = type;
}

function setFnForwarding(node: NodeMap['fn']): void {
	const only = node.statements?.length === 1 ? node.statements[0] : undefined;
	const value = only?.kind === 'next' ? only.children?.[0] : only;
	if (value?.kind !== 'call' || value.children[0].kind !== 'ident') return;
	const definition = value.children[0].symbol.definition;
	const target =
		definition?.kind === 'fn'
			? definition
			: definition?.kind === 'def' && definition.value.kind === 'fn'
				? definition.value
				: undefined;
	const targetOnly =
		target?.statements?.length === 1 ? target.statements[0] : undefined;
	const targetValue =
		targetOnly?.kind === 'next' ? targetOnly.children?.[0] : targetOnly;
	if (targetValue?.kind === '>>') node.symbol.forwardsPipe = true;
}

function resolveFnType(node: NodeMap['fn']): Type {
	const sym = node.symbol;
	resolveDeclaredFnOutputs(node);
	if (node.parameters?.length) node.parameters.forEach(resolver);
	if (
		!sym.emissionType &&
		!sym.returnTypes &&
		!sym.returnVariants &&
		!node.returnType &&
		!node.returnTypes &&
		!node.returnVariants &&
		!inferringReturn.has(sym)
	) {
		inferringReturn.add(sym);
		try {
			const inferred = inferFnEmission(node);
			if (inferred) {
				sym.emissionType = inferred;
				if (!inferred.rest) {
					sym.returnTypes = inferred.elements;
					sym.returnOwnerships = inferred.ownerships;
				}
			}
		} finally {
			inferringReturn.delete(sym);
		}
	}
	setFnElementReturn(node);
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
	if (t.kind === 'function' || t.family !== 'unknown') node.symbol.type = t;
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

function isConstValue(node: Node): boolean {
	return (
		node.kind === 'number' ||
		(node.kind === 'ident' && node.symbol.kind === 'literal')
	);
}

function isConstCondition(node: Node): boolean {
	if (isConstValue(node)) return true;
	switch (node.kind) {
		case '==':
		case '!=':
		case '<':
		case '>':
		case '<=':
		case '>=':
			return (
				isConstValue(node.children[0]) && isConstValue(node.children[1])
			);
		default:
			return false;
	}
}

function resolveType(node: CheckedNode): Type | undefined {
	switch (node.kind) {
		case 'def':
			return resolveDefType(node);
		case 'ident': {
			const sym = node.symbol;
			if (sym.kind === 'function') return sym;
			if (!sym.type && sym.definition?.kind === 'def')
				resolveType(sym.definition);
			return sym.type;
		}
		case 'typeident':
			return node.symbol.type;
		case 'call':
			return callReturnType(node);
		case 'loop':
			return BT.Int32;
		case 'number':
			return node.float ? BT.Float64 : numberLiteralType(node.value);
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
		case 'interp':
			return BT.String;
		case 'parameter':
			return resolveParameterType(node);
		case 'fn':
			return resolveFnType(node);
		case 'data':
			return resolveDataType(node);
		case '.':
			return resolveMemberType(node);
		case '-':
		case '+':
		case '/':
		case '*':
		case '%':
			return resolveNumericOp(node);
		case '<=':
		case '>=':
		case '<':
		case '>':
		case '==':
		case '!=':
		case '!':
		case '&&':
		case '||':
			return BT.Bool;
		case '?': {
			const truthy = node.children[1];
			const falsy = node.children[2];
			const result =
				truthy.kind === 'break' || truthy.kind === 'done' ? falsy : truthy;
			return result ? resolver(result) : BT.Void;
		}
		case '>>':
			return resolvePipeType(node);
		case '&':
		case '^':
		case '<:':
		case ':>':
			return resolveBitwiseType(node);
		case '|': {
			const lt = resolver(node.children[0]);
			const rt = resolver(node.children[1]);
			if (isNumericType(lt) && isNumericType(rt))
				return numericResultType(lt, rt) ?? BT.Int32;
			return resolveDispatchType(node);
		}
		case 'propdef':
			return resolvePropdefType(node);
		default:
			return BT.Unknown;
	}
}

function resolveMemberType(node: NodeMap['.']): Type {
	const left = node.children[0];
	const right = node.children[1];
	if (right.kind === 'ident') {
		const sym = right.symbol;
		if (sym.kind === 'function') return sym;
		if (sym.kind === 'variable' && sym.type) return sym.type;
	}
	const lt = resolver(left);
	if (lt.kind === 'type' && lt.family === 'data') {
		const keys = Object.keys(lt.members);
		let key: string | undefined;
		if (right.kind === 'number') key = keys[Number(right.value)];
		else if (right.kind === 'ident') key = right.symbol.name;
		const m = key !== undefined ? lt.members[key] : undefined;
		if (m?.kind === 'variable' && m.type) return m.type;
	}
	return BT.Unknown;
}

function resolvePipeType(node: NodeMap['>>']): Type {
	const kids = node.children;
	const last = kids[kids.length - 1];
	if (!last) return BT.Unknown;
	if (last.kind === 'fn') {
		const ft = resolveFnType(last);
		if (ft.kind === 'function' && ft.returnType) return ft.returnType;
		const tail = last.statements?.[last.statements.length - 1];
		return tail ? resolver(tail) : BT.Unknown;
	}
	if (last.kind === 'ident') {
		const input = kids.length > 1 ? kids[kids.length - 2] : undefined;
		const specialized =
			input && resolveFunctionStageReturn(last, resolver(input));
		return specialized ?? resolveReturnType(last) ?? resolver(last);
	}
	if (last.kind === '.') {
		const input = kids.length > 1 ? kids[kids.length - 2] : undefined;
		const specialized =
			input && resolveFunctionStageReturn(last, resolver(input));
		if (specialized) return specialized;
		const t = resolveMemberType(last);
		return t.kind === 'function' ? (t.returnType ?? BT.Void) : t;
	}
	if (last.kind === '|') {
		// A `|`-dispatch stage emits the union of its arms' returns; each
		// arm's `$` is its declared (matched) variant type.
		const rets: Type[] = [];
		const walk = (n: Node): void => {
			if (n.kind === '|') {
				walk(n.children[0]);
				walk(n.children[1]);
				return;
			}
			if (n.kind !== 'fn') {
				rets.push(resolver(n));
				return;
			}
			const body = n.statements?.[0];
			if (!body) {
				rets.push(BT.Void);
				return;
			}
			const ptype = n.parameters?.[0]?.type;
			if (ptype?.kind === 'typeident')
				annotateDollar(body, ptype.symbol.type);
			rets.push(resolver(body));
		};
		walk(last);
		return unionOf(rets);
	}
	return resolver(last);
}

function resolveDispatchType(node: NodeMap['|']): Type {
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
		returnTypes: overloads[0]?.returnTypes,
		overloads,
	};
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


function refsAny(node: Node, outer: Set<Symbol>): boolean {
	if (node.kind === 'ident') return outer.has(node.symbol);
	if ('children' in node && node.children)
		for (let i = 0; i < node.children.length; i++) {
			const k = node.children[i];
			if (k && refsAny(k, outer)) return true;
		}
	if (node.kind === 'fn' || node.kind === 'main')
		for (const s of node.statements ?? [])
			if (refsAny(s, outer)) return true;
	return false;
}


function paramsMatch(
	params: Symbol[] | undefined,
	argTypes: (Type | undefined)[],
	widen = false,
): boolean {
	const arity = params?.length ?? 0;
	if (arity !== argTypes.length) return false;
	for (let i = 0; i < arity; i++) {
		const want = params?.[i]?.type;
		const got = argTypes[i];
		if (!want || !got) continue;
		if (canAssign(want, got)) continue;
		// A narrower int arg adopts a wider int arm (`5` picks an `Int64` arm)
		// — mirrors codegen's dispatch widen, tried only after exact matches.
		if (
			widen &&
			want.kind === 'type' &&
			got.kind === 'type' &&
			isIntType(want) &&
			isIntType(got) &&
			want.size >= got.size
		)
			continue;
		return false;
	}
	return true;
}

function canAssignEmission(
	to: Extract<ResolvedType, { family: 'emission' }>,
	a: Extract<ResolvedType, { family: 'emission' }>,
): boolean {
	if (a.rest && !to.rest) return false;
	if (a.elements.length < to.elements.length) return false;
	if (!to.rest && a.elements.length !== to.elements.length) return false;
	for (let i = 0; i < a.elements.length; i++) {
		const actual = a.elements[i];
		const expected = to.elements[i] ?? to.rest;
		const actualOwnership = a.ownerships[i];
		const expectedOwnership = to.ownerships[i] ?? to.restOwnership;
		if (
			!actual ||
			!expected ||
			actualOwnership !== expectedOwnership ||
			!canAssign(expected, actual)
		)
			return false;
	}
	return (
		!a.rest ||
		(!!to.rest &&
			a.restOwnership === to.restOwnership &&
			canAssign(to.rest, a.rest))
	);
}

function canAssign(to: Type, a: Type): boolean {
	if (to === a) return true;
	if (a.components?.some(c => canAssign(to, c))) return true;
	if (to.kind === 'function' && a.kind === 'function')
		return canAssignFunction(to, a);
	if (to.kind !== 'type' || a.kind !== 'type') return false;
	if (to.family === 'unknown') return true;
	if (to.family === 'emission' || a.family === 'emission') {
		if (to.family !== 'emission' || a.family !== 'emission') return false;
		return canAssignEmission(to, a);
	}
	if (a.family === 'union') return a.members.every(m => canAssign(to, m));
	if (to.family === 'union') return to.members.some(m => canAssign(m, a));
	if (canAssignCoercion(to, a)) return true;
	if (to.family === 'buffer' && a.family === 'buffer')
		return (
			(!to.components || to.name === a.name) &&
			canAssign(to.elem, a.elem)
		);
	return canAssignData(to, a);
}

function sameType(a: Type, b: Type): boolean {
	if (a === b) return true;
	return (
		a.kind === 'type' &&
		b.kind === 'type' &&
		a.family === 'buffer' &&
		b.family === 'buffer' &&
		a.name === b.name &&
		sameType(a.elem, b.elem)
	);
}

function canAssignFunction(
	to: SymbolMap['function'],
	a: SymbolMap['function'],
): boolean {
	if (
		to.returnOwnership &&
		a.returnOwnership &&
		to.returnOwnership !== a.returnOwnership
	)
		return false;
	const tp = to.parameters ?? [];
	const ap = a.parameters ?? [];
	if (tp.length !== ap.length) return false;
	for (let i = 0; i < tp.length; i++) {
		if (
			tp[i]?.ownership &&
			ap[i]?.ownership &&
			tp[i]?.ownership !== ap[i]?.ownership
		)
			return false;
		const tt = tp[i]?.type;
		const at = ap[i]?.type;
		if (tt && at && !canAssign(tt, at)) return false;
	}
	return canAssignFunctionReturns(to, a);
}

function canAssignFunctionReturns(
	to: SymbolMap['function'],
	a: SymbolMap['function'],
): boolean {
	if (to.emissionType && a.emissionType)
		return canAssign(to.emissionType, a.emissionType);
	if (to.returnOwnerships && a.returnOwnerships) {
		if (to.returnOwnerships.length !== a.returnOwnerships.length) return false;
		for (let i = 0; i < to.returnOwnerships.length; i++)
			if (to.returnOwnerships[i] !== a.returnOwnerships[i]) return false;
	}
	if (
		to.returnType &&
		a.returnType &&
		!canAssign(to.returnType, a.returnType)
	)
		return false;
	const targetVariants = to.returnVariants ??
		(to.returnTypes ? [to.returnTypes] : undefined);
	const actualVariants = a.returnVariants ??
		(a.returnTypes ? [a.returnTypes] : undefined);
	if (targetVariants && actualVariants) {
		const targetOwnerships = to.returnVariantOwnerships ??
			(to.returnOwnerships ? [to.returnOwnerships] : undefined);
		const actualOwnerships = a.returnVariantOwnerships ??
			(a.returnOwnerships ? [a.returnOwnerships] : undefined);
		return actualVariants.every((actual, actualIndex) =>
			targetVariants.some(
				(target, targetIndex) =>
					target.length === actual.length &&
					target.every((type, index) => {
						const emitted = actual[index];
						if (!emitted || !canAssign(type, emitted)) return false;
						const expectedOwnership = targetOwnerships?.[targetIndex]?.[index];
						const actualOwnership = actualOwnerships?.[actualIndex]?.[index];
						return (
							!expectedOwnership ||
							!actualOwnership ||
							expectedOwnership === actualOwnership
						);
					}),
			),
		);
	}
	return true;
}

/** Literal/scalar widening coercions; false means "no coercion, keep checking". */
function canAssignCoercion(to: ResolvedType, a: ResolvedType): boolean {
	if (to.family === 'literal' && a.family === 'literal')
		return to.value === a.value;
	if (to.family === 'string')
		return (
			a.family === 'string' ||
			(a.family === 'literal' && typeof a.value === 'string')
		);
	if (
		(to.family === 'int' || to.family === 'uint' || to.family === 'float') &&
		a.family === 'literal' &&
		typeof a.value === 'number'
	)
		return true;
	return (
		to.family === 'bool' &&
		a.family === 'literal' &&
		typeof a.value === 'boolean'
	);
}

function canAssignData(to: ResolvedType, a: ResolvedType): boolean {
	if (to.family !== 'data' || a.family !== 'data') return false;
	// A named type is nominal — its identity is the type-symbol instance,
	// not its structure. The `to === a` test in `canAssign` is that identity
	// check, so reaching here means the instances already differ; two types that
	// each carry a declared identity are therefore distinct and never assign,
	// even with identical members. An anonymous block (`__data`) has no declared
	// identity, so it coerces structurally into a named type.
	if (to.name !== '__data' && a.name !== '__data') return false;
	for (const key of Object.keys(to.members)) {
		// The hidden trace slot is compiler-filled at construction,
		// never written in a literal.
		if (key === '__trace') continue;
		const toType = to.members[key]?.type;
		const aType = a.members[key]?.type;
		if (!toType || !aType) return false;
		if (!canAssign(toType, aType)) return false;
	}
	return true;
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

function isUnusedValue(type: Type): boolean {
	return (
		type.kind === 'function' ||
		(type.family !== 'void' && type.family !== 'unknown')
	);
}

function unusedValueMessage(type: Type): string {
	return type.kind === 'function'
		? 'Anonymous function value is not consumed. `{ ... }` creates a function but does not call it; move these statements into a function and call it here.'
		: 'value is not consumed: emit it with `next`, bind it, or pipe it to a consumer';
}

/**
 * Collapse a list of types into a single type. Identical types reduce to
 * one; otherwise builds a `union` type whose `size` is the largest member.
 * Only data-typed members (kind: 'type') participate; function-kind types
 * are skipped because they aren't valid union arms.
 */
function unionOf(types: Type[]): Type {
	const seen = new Map<string, ResolvedType>();
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

// --- Type-level reduction engine ---

const EMPTY_BINDINGS: Map<string, Type> = new Map();
const MAX_REDUCE = 256;

function dataTypeOf(members: Type[]): Type {
	const m: Record<string, Symbol> = {};
	members.forEach((t, i) => {
		m[String(i)] = { kind: 'variable', name: String(i), flags: 0, type: t };
	});
	return { kind: 'type', flags: 0, name: '__data', family: 'data', size: 0, members: m };
}

// Head-rest split of a type: scalar lifts to head + Void rest; data peels its
// first member as head and its remainder as a collapsing rest.
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
	if (t.family === 'emission')
		return (
			t.elements.some(element => containsApp(element, seen)) ||
			(t.rest !== undefined && containsApp(t.rest, seen))
		);
	if (t.family === 'data')
		return Object.values(t.members).some(
			m => m.type !== undefined && containsApp(m.type, seen),
		);
	return false;
}

// Reduce a record type's members under bindings, dropping `Void` members and
// collapsing a single member to its type.
function reduceDataMembers(
	members: Record<string, Symbol>,
	bindings: Map<string, Type>,
	depth: number,
): Type {
	const reduced: Type[] = [];
	for (const k of Object.keys(members)) {
		const mt = members[k]?.type;
		if (!mt) continue;
		const r = reduceType(mt, bindings, depth + 1);
		if (r.kind === 'type' && r.family === 'void') continue;
		reduced.push(r);
	}
	if (reduced.length === 0) return BT.Void;
	const first = reduced[0];
	if (reduced.length === 1 && first) return first;
	return dataTypeOf(reduced);
}

// Reduce a type under type-variable bindings: substitute bound vars, evaluate
// applications. Identity for ordinary types when there is nothing to do.
export function reduceType(t: Type, bindings: Map<string, Type>, depth = 0): Type {
	if (t.kind !== 'type') return t;
	if (depth > MAX_REDUCE) return BT.Unknown;
	if (t.application) return reduceApply(t, bindings, depth);
	if (t.family === 'unknown' && t.name) {
		const bound = bindings.get(t.name);
		if (bound) return bound;
	}
	if (!bindings.size && !containsApp(t)) return t;
	if (t.family === 'union')
		return unionOf(t.members.map(m => reduceType(m, bindings, depth + 1)));
	if (t.family === 'emission')
		return {
			...t,
			elements: t.elements.map(element =>
				reduceType(element, bindings, depth + 1),
			),
			rest: t.rest ? reduceType(t.rest, bindings, depth + 1) : undefined,
		};
	if (t.family === 'buffer') {
		const e = reduceType(t.elem, bindings, depth + 1);
		return e === t.elem ? t : { ...t, elem: e };
	}
	if (t.family === 'data') return reduceDataMembers(t.members, bindings, depth);
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
		if (p.name && argTypes[i]) inner.set(p.name, argTypes[i]);
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
			// No match collapses to Void.
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
			s.kind === 'parameter' ? s.symbol.name : undefined,
		);
		let cur = input;
		for (let i = 0; i < names.length; i++) {
			const name = names[i];
			if (i === names.length - 1) {
				if (name) local.set(name, cur);
				break;
			}
			const hr = headRestOf(cur);
			if (!hr) return undefined; // input doesn't match the pattern
			if (name) local.set(name, hr.head);
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
	const outputOwnershipChecked = new Set<SymbolMap['function']>();

	function checkEach(node: Node[]) {
		node.forEach(check);
	}

	function error(message: string, position: Position) {
		errors.push({ message, position });
	}

	function numberBinaryOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		check(left);
		check(right);
		const lt = resolver(left);
		const rt = resolver(right);
		if (isInvalidType(lt) || isInvalidType(rt)) return;
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
		if (node.kind === '%' && (isFloatType(lt) || isFloatType(rt)))
			error('modulo requires integer operands', left);
		if (
			(node.kind === '/' || node.kind === '%') &&
			right.kind === 'number' &&
			right.value === 0
		)
			error(
				`${node.kind === '%' ? 'modulo' : 'division'} by zero`,
				right,
			);
	}

	function bitwiseOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		const lt = resolver(left);
		const rt = resolver(right);
		if (isTypeParam(lt) || isTypeParam(rt)) return;
		const bad = (t: Type) =>
			t.kind === 'type' && t.family !== 'unknown' && !isIntType(t);
		if (bad(lt) || bad(rt))
			error(`Operator "${node.kind}" requires integer operands`, left);
	}

	/**
	 * The `check` function performs semantic analysis on a node by exploring its structure and applying various checks
	 * based on its kind. Each case handles a specific node kind, ensuring that the proper validation and type-resolution
	 * operations are performed. Depending on the node kind, it might resolve types, validate parameters, and enforce
	 * correct usage of operations and calls.
	 */
	function checkNext(node: NodeMap['next']) {
		const val = node.children?.[0];
		if (val) {
			if (val.kind === ',') for (const c of val.children) check(c);
			else check(val);
		}
	}

	function chooseOverload(
		fn: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
	): SymbolMap['function'] | undefined {
		if (fn.overloads) {
			const arms = [fn, ...fn.overloads];
			const match =
				arms.find(c => paramsMatch(c.parameters, argTypes)) ??
				arms.find(c => paramsMatch(c.parameters, argTypes, true));
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

	function callTypeBindings(
		chosen: SymbolMap['function'],
		argTypes: Type[],
	): Map<string, Type> {
		const fnNode =
			chosen.definition?.kind === 'fn' ? chosen.definition : undefined;
		const typeParams =
			chosen.typeParams ??
			fnNode?.typeParameters
				?.map(p => p.symbol.type)
				.filter((t): t is Type => !!t) ??
			[];
		const names = new Set(
			typeParams.map(t => t.name).filter((n): n is string => !!n),
		);
		const bindings = new Map<string, Type>();
		(chosen.parameters ?? []).forEach((p, i) =>
			unifyTypeParam(p.type, argTypes[i], names, bindings),
		);
		return bindings;
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
		const argsNode = node.children[1];
		const argNodes = argsNode
			? argsNode.kind === ','
				? argsNode.children
				: [argsNode]
			: [];
		const bindings = callTypeBindings(chosen, argTypes);

		for (let i = 0; i < argTypes.length; i++) {
			const typeA = argTypes[i];
			const parameterType = params[i]?.type;
			if (!typeA || !parameterType) continue;
			const typeB = reduceType(parameterType, bindings);
			const isVoidArg =
				typeA.kind === 'type' && typeA.family === 'void';
			const hasDefault = !!paramNodes?.[i]?.value;
			if (isVoidArg && hasDefault) continue;
			if (literalFits(argNodes[i], typeB)) continue;
			if (!canAssign(typeB, typeA))
				error(
					`Argument of type "${typeToStr(
						typeA,
					)}" is not assignable to parameter of type "${typeToStr(
						typeB,
					)}".`,
					node,
				);
		}
	}

	function contextualFunctionType(
		type: SymbolMap['function'],
		bindings: Map<string, Type>,
	): SymbolMap['function'] {
		const emissionType = type.emissionType
			? reduceType(type.emissionType, bindings)
			: undefined;
		return {
			...type,
			parameters: type.parameters?.map(parameter => ({
				...parameter,
				type: parameter.type
					? reduceType(parameter.type, bindings)
					: undefined,
			})),
			returnType: type.returnType
				? reduceType(type.returnType, bindings)
				: undefined,
			emissionType:
				emissionType?.kind === 'type' ? emissionType : undefined,
			returnTypes: type.returnTypes?.map(returnType =>
				reduceType(returnType, bindings),
			),
			returnVariants: type.returnVariants?.map(variant =>
				variant.map(returnType => reduceType(returnType, bindings)),
			),
		};
	}

	function contextualizeCallBlocks(
		fn: SymbolMap['function'],
		args: Node[],
	): void {
		if (fn.overloads) return;
		const provisional = args.map(arg =>
			arg.kind === 'fn' ? BT.Unknown : resolver(arg),
		);
		const bindings = callTypeBindings(fn, provisional);
		args.forEach((arg, index) => {
			if (arg.kind !== 'fn' || arg.parameters?.length) return;
			const expected = fn.parameters?.[index]?.type;
			if (expected?.kind !== 'function') return;
			const context = contextualFunctionType(expected, bindings);
			if (context.parameters?.length !== 1) return;
			const expectedParameter = context.parameters[0];
			if (!expectedParameter?.type) return;
			const symbol: SymbolMap['variable'] = {
				kind: 'variable',
				name: '',
				flags: 0,
				type: expectedParameter.type,
				ownership: expectedParameter.ownership,
			};
			const parameter: NodeMap['parameter'] = {
				...arg,
				kind: 'parameter',
				children: [undefined, undefined, undefined],
				symbol,
			};
			arg.parameters = [parameter];
			arg.children.unshift(parameter);
			arg.symbol.parameters = [symbol];
			arg.symbol.returnOwnership = context.returnOwnership;
			for (const statement of arg.statements ?? [])
				annotateDollar(statement, expectedParameter.type);
			if (
				!arg.returnType &&
				!arg.returnTypes &&
				!arg.returnRestType &&
				!arg.returnVariants
			) {
				arg.symbol.returnType = undefined;
				arg.symbol.returnTypes = undefined;
				arg.symbol.returnOwnerships = undefined;
				arg.symbol.emissionType = undefined;
			}
			resolver(arg);
		});
	}

	/** Default ctor: `T(x)` where `x` is T's own structural value; field-less
	 * errors take Void (`T()`), field-less plain types have no value at all. */
	function checkDataCtorArg(
		target: ResolvedType & { family: 'data' },
		node: NodeMap['call'],
	) {
		const visible = Object.keys(target.members).filter(
			k => k !== '__trace',
		);
		const args = node.children[1];
		if (visible.length === 0) {
			if (args)
				error(
					`"${target.name}" has no fields — its constructor takes no value`,
					node,
				);
			return;
		}
		if (!args) {
			error(
				`"${target.name}(…)" requires its structural value: [ ${visible[0]} = … ]`,
				node,
			);
			return;
		}
		const at = resolver(args);
		if (
			at.kind === 'type' &&
			at.family !== 'unknown' &&
			!canAssign(target, at)
		)
			error(
				`Type "${typeToStr(at)}" is not assignable to "${target.name}"`,
				node,
			);
	}

	function checkBufferCtorArg(
		node: NodeMap['call'],
	) {
		const args = node.children[1];
		if (!args || args.kind === ',') {
			error(`Buffer<T>(capacity) takes a single Int32 capacity`, node);
			return;
		}
		const at = resolver(args);
		if (at.kind === 'type' && at.family !== 'unknown' && !isIntType(at))
			error(`Buffer capacity must be an Int32`, node);
	}

	function checkScalarCtorArg(target: Type, node: NodeMap['call']) {
		if (target.kind !== 'type' || !isNumericType(target)) return;
		const args = node.children[1];
		if (!args) {
			error(`"${target.name}" requires a numeric argument`, node);
			return;
		}
		if (args.kind === ',') {
			error(`"${target.name}" takes a single numeric value`, node);
			return;
		}
		const at = resolver(args);
		if (at.kind === 'type' && at.family !== 'unknown' && !isNumericType(at))
			error(
				`Cannot convert "${typeToStr(at)}" to "${target.name}"`,
				node,
			);
	}

	function checkRedundantCtor(
		target: ResolvedType,
		node: NodeMap['call'],
	): void {
		if (target.family === 'buffer') return;
		const args = node.children[1];
		if (!args || args.kind === ',') return;
		const argument = resolver(args);
		if (argument !== target) return;
		error(
			`Redundant type constructor \`${target.name}\`; the argument is already \`${target.name}\`.`,
			node,
		);
	}

	function checkCall(node: NodeMap['call']) {
		const calleeNode = node.children[0];
		const fn = resolveType(calleeNode);
		if (calleeNode.kind === 'typeident') {
			if (fn && fn.kind === 'type' && fn.family !== 'fn') {
				checkRedundantCtor(fn, node);
				if (calleeNode.symbol === BufferSymbol) {
					error(
						`Buffer requires a type argument: Buffer<T>(capacity)`,
						node,
					);
				} else if (fn.family === 'buffer') checkBufferCtorArg(node);
				else if (fn.family === 'data') checkDataCtorArg(fn, node);
				else checkScalarCtorArg(fn, node);
				return;
			}
			error(`This expression is not callable`, node);
			return;
		}
		if (!fn || fn.kind !== 'function') {
			error(`This expression is not callable`, node);
			return;
		}

		const args = node.children[1];
		const argNodes = args
			? args.kind === ',' ? args.children : [args]
			: [];
		contextualizeCallBlocks(fn, argNodes);
		const argTypes = args
			? args.kind === ',' ? getListTypes(args) : [resolver(args)]
			: [];

		if (argTypes.some(isTypeParam)) return;

		const chosen = chooseOverload(fn, argTypes, node);
		if (!chosen || !args) return;
		checkTypeArgConstraints(chosen, argTypes, node);
		checkCallArgs(chosen, argTypes, node);
		checkMutableCallArgs(chosen, node);
	}

	function referencesSymbol(node: Node, symbol: Symbol): boolean {
		if (node.kind === 'ident') return bindingRoot(node.symbol) === symbol;
		if (!('children' in node) || !node.children) return false;
		return node.children.some(child => !!child && referencesSymbol(child, symbol));
	}

	function bindingRoot(symbol: Symbol): Symbol {
		const definition = symbol.definition;
		return definition?.kind === 'def' && definition.value.kind === 'ident'
			? bindingRoot(definition.value.symbol)
			: symbol;
	}

	function mutableSymbol(symbol: SymbolMap['variable']): boolean {
		return (
			symbol.ownership === 'var' ||
			symbol.ownership === 'own' ||
			(symbol.definition?.kind === 'def' && ownedHere(symbol.definition))
		);
	}

	function mutableArgRoot(arg: Node | undefined, node: Node): Symbol | undefined {
		if (!arg || arg.kind !== 'ident' || arg.symbol.kind !== 'variable') {
			error('a `var` parameter requires a mutable binding', arg ?? node);
			return;
		}
		if (mutableSymbol(arg.symbol)) return arg.symbol;
		error(`cannot mutably borrow shared binding "${arg.symbol.name}"`, arg);
	}

	function checkMutableCallArgs(
		fn: SymbolMap['function'],
		node: NodeMap['call'],
	): void {
		const raw = node.children[1];
		const args = raw?.kind === ',' ? raw.children : raw ? [raw] : [];
		const roots = new Map<Symbol, number>();
		for (let i = 0; i < args.length; i++) {
			if (fn.parameters?.[i]?.ownership !== 'var') continue;
			const arg = args[i];
			const root = mutableArgRoot(arg, node);
			if (!root) continue;
			const previous = roots.get(root);
			if (previous !== undefined)
				error(
					`mutable borrow of "${root.name ?? ''}" overlaps another argument`,
					arg ?? node,
				);
			else roots.set(root, i);
		}
		for (const [symbol, mutableIndex] of roots)
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				if (i !== mutableIndex && arg && referencesSymbol(arg, symbol))
					error(
						`mutable borrow of "${symbol.name ?? ''}" overlaps argument ${i + 1}`,
						arg,
					);
			}
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
		const subst = callTypeBindings(chosen, argTypes);
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
					)}" for type parameter "${tp.symbol.name}"`,
					node,
				);
		}
	}

	function checkDispatchDef(node: Node): void {
		const dt = resolveType(node);
		if (dt?.kind !== 'function' || !dt.overloads) return;
		const ovs = dt.overloads;
		const rts = ovs.map(o => o.returnType ?? BT.Void);
		const first = rts[0];
		if (
			first &&
			rts.some(r => !(canAssign(first, r) && canAssign(r, first)))
		) {
			error('overload arms must return the same type', node);
			return;
		}
		const ins = ovs.map(o => o.parameters?.[0]?.type);
		for (let i = 0; i < ins.length; i++)
			for (let j = 0; j < i; j++) {
				const a = ins[j];
				const b = ins[i];
				if (a && b && canAssign(a, b)) {
					error(
						'ambiguous overload: two arms accept the same input type',
						node,
					);
					return;
				}
			}
	}

	function checkDef(node: NodeMap['def']) {
		const sym = node.symbol;
		resolver(node);
		if (node.value.kind === '|') checkDispatchDef(node.value);
		if (node.type) {
			const declared = resolveType(node.type);
			const vt = valueType(node.value);
			if (
				!(sym.flags & Flags.Variable) &&
				declared &&
				vt &&
				sameType(declared, vt)
			)
				error(
					`Redundant type annotation \`${typeToStr(declared)}\`; the initializer is already \`${typeToStr(vt)}\`.`,
					node.type,
				);
			if (
				declared &&
				vt &&
				!canAssign(declared, vt) &&
				!literalFits(node.value, declared)
			)
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
		if (left.kind === 'ident')
			error(`Cannot reassign binding "${left.symbol.name ?? ''}"`, left);
		check(node.children[1]);
	}

	function checkReturnTypeAssignable(node: NodeMap['fn']) {
		const ret = node.symbol.returnType;
		if (node.typeParameters?.length || !ret || node.statements?.length !== 1)
			return;
		const statement = node.statements[0];
		const stmt =
			statement?.kind === 'next' ? statement.children?.[0] : statement;
		if (
			!stmt ||
			stmt.kind === 'done' ||
			stmt.kind === 'break'
		)
			return;
		const t = resolveType(stmt);
		if (
			t &&
			!isTypeParam(t) &&
			!canAssign(ret, t) &&
			!branchesFit(stmt, ret)
		)
			error(
				`Type "${typeToStr(t)}" is not assignable to return type "${typeToStr(ret)}"`,
				stmt,
			);
	}

	function checkRestEmissions(
		node: NodeMap['fn'],
		actual: Type[],
		emission: ResolvedType | undefined,
	): boolean {
		if (emission?.family !== 'emission') return false;
		const rest = emission.rest;
		if (!rest) return false;
		if (actual.length < emission.elements.length) {
			error(
				`function declares at least ${emission.elements.length} emissions but produces ${actual.length}`,
				node,
			);
			return true;
		}
		for (let i = 0; i < actual.length; i++) {
			const expected = emission.elements[i] ?? rest;
			const found = actual[i];
			if (found && !canAssign(expected, found))
				error(
					`emission ${i + 1} has type "${typeToStr(found)}", expected "${typeToStr(expected)}"`,
					node,
				);
		}
		return true;
	}

	function hasDeclaredEmissions(node: NodeMap['fn']): boolean {
		return !!(
			node.returnType ||
			node.returnTypes ||
			node.returnRestType ||
			node.returnVariants
		);
	}

	function checkDeclaredEmissions(node: NodeMap['fn']) {
		if (!hasDeclaredEmissions(node)) return;
		if (node.typeParameters?.length) return;
		if (node.statements?.some(statement => statement.kind === 'break')) return;
		const declared = node.symbol.returnTypes ?? [];
		const actualEmission = inferFnEmission(node);
		if (!actualEmission) return;
		const emission = node.symbol.emissionType;
		if (actualEmission.rest) {
			if (emission && !canAssign(emission, actualEmission))
				error(
					`function output type "${typeToStr(actualEmission)}" is not assignable to declared type "${typeToStr(emission)}"`,
					node,
				);
			return;
		}
		const actual = actualEmission.elements;
		if (checkRestEmissions(node, actual, emission)) return;
		if (node.returnVariants) {
			const matches = node.symbol.returnVariants?.some(
				variant =>
					variant.length === actual.length &&
					variant.every((type, index) => {
						const emitted = actual[index];
						return !!emitted && canAssign(type, emitted);
					}),
			);
			if (!matches)
				error('function output does not match any declared emission signature', node);
			return;
		}
		if (declared.length !== actual.length) {
			error(
				declared.length === 0
					? `function declares no emissions but produces ${actual.length}`
					: `function declares ${declared.length} emissions but produces ${actual.length}`,
				node,
			);
			return;
		}
		if (!node.returnTypes) return;
		for (let i = 0; i < declared.length; i++) {
			const expected = declared[i];
			const found = actual[i];
			if (expected && found && !canAssign(expected, found))
				error(
					`emission ${i + 1} has type "${typeToStr(found)}", expected "${typeToStr(expected)}"`,
					node,
				);
		}
	}

	function checkNoClosureCapture(node: NodeMap['fn']) {
		const bindings = new Set<Symbol>();
		node.parameters?.forEach(p => bindings.add(p.symbol));
		node.statements?.forEach(s => {
			if (s.kind === 'def') bindings.add(s.symbol);
		});
		if (!bindings.size) return;
		node.statements?.forEach(s => {
			const emitted =
				s.kind === 'fn'
					? s
					: s.kind === 'next' && s.children?.[0]?.kind === 'fn'
						? s.children[0]
						: undefined;
			if (emitted && refsAny(emitted, bindings))
				error(
					'function captures an enclosing binding; closures are not allowed',
					emitted,
				);
		});
	}

	function checkUnusedStatements(statements: Node[]) {
		for (const s of statements) {
			if (
				s.kind === 'next' ||
				s.kind === 'done' ||
				s.kind === 'break' ||
				s.kind === 'def' ||
				s.kind === '=' ||
				s.kind === 'import' ||
				s.kind === 'comment'
			)
				continue;
			const t = resolver(s);
			if (isUnusedValue(t)) error(unusedValueMessage(t), s);
		}
	}

	function nestedFunctionReferences(node: Node, symbol: Symbol): boolean {
		if (node.kind === 'fn') return referencesSymbol(node, symbol);
		if (!('children' in node) || !node.children) return false;
		return node.children.some(
			child => !!child && nestedFunctionReferences(child, symbol),
		);
	}

	function isCopyType(type: Type): boolean {
		if (type.kind !== 'type') return false;
		if (type.family === 'union') return type.members.every(isCopyType);
		return (
			type.family === 'int' ||
			type.family === 'uint' ||
			type.family === 'float' ||
			type.family === 'char' ||
			type.family === 'bool' ||
			type.family === 'void' ||
			type.family === 'literal'
		);
	}

	function referencesNonCopyBinding(node: Node, ignored: Symbol): boolean {
		if (node.kind === '$') return !isCopyType(resolver(node));
		if (
			node.kind === 'ident' &&
			node.symbol !== ignored &&
			node.symbol.kind === 'variable' &&
			(node.symbol.definition?.kind === 'def' ||
				node.symbol.definition?.kind === 'parameter')
		)
			return !isCopyType(resolver(node));
		if (!('children' in node) || !node.children) return false;
		return node.children.some(
			child => !!child && referencesNonCopyBinding(child, ignored),
		);
	}

	function checkRedundantIntermediates(statements: Node[]): void {
		for (let i = 0; i < statements.length - 1; i++) {
			const statement = statements[i];
			const next = statements[i + 1];
			if (
				statement?.kind !== 'def' ||
				!next ||
				statement.symbol.flags & Flags.Variable ||
				!isCopyType(resolver(statement))
			)
				continue;
			const references = statement.symbol.references ?? [];
			if (
				references.length === 0 ||
				!references.every(
					reference =>
						reference.source === next.source &&
						reference.start >= next.start &&
						reference.end <= next.end,
				) ||
				nestedFunctionReferences(next, statement.symbol) ||
				referencesNonCopyBinding(next, statement.symbol)
			)
				continue;
			error(
				`Redundant intermediate binding "${statement.symbol.name}"; pipe its initializer into the following statement.`,
				statement,
			);
		}
	}

	function checkUnusedValues(node: NodeMap['fn']) {
		if (!node.statements) return;
		for (const s of node.statements) {
			if (
				s.kind === 'next' ||
				s.kind === 'done' ||
				s.kind === 'break' ||
				s.kind === 'def' ||
				s.kind === '=' ||
				s.kind === 'comment'
			)
				continue;
			const t = resolver(s);
			if (isUnusedValue(t)) error(unusedValueMessage(t), s);
		}
	}

	// Ownership: `next` of a value created here (owned heap value) moves it;
	// use after is an error. `next` of a param/borrow emits a reference and
	// `b = a` borrows — neither moves. Scalars/interned literals are Copy.
	// Embedding an owned local in a labeled data literal moves it into the
	// record — the name stays readable as a borrow of the record until the
	// record itself moves. Records own their members, so a member may be an
	// owned local, a fresh value, or a static literal — never a borrow, and
	// never the same value twice.
	function ownedHere(def: NodeMap['def']): boolean {
		const v = def.value;
		if (v.kind === 'ident') return false;
		const t = resolver(v);
		if (v.kind === 'call') {
			const callee = resolveFunctionType(v.children[0]);
			if (callee?.returnOwnership)
				return callee.returnOwnership === 'own';
		}
		return isHeapType(t);
	}
	type Move = {
		position: Position;
		context: string;
	};

	function moveLocation(position: Position): string {
		const lineStart = position.source.lastIndexOf('\n', position.start - 1);
		return `line ${position.line + 1}, column ${position.start - lineStart}`;
	}

	function flagMovedUses(
		n: Node,
		moved: Map<Symbol, Move>,
		borrowed?: Map<Symbol, Symbol>,
	): void {
		if (n.kind === 'ident') {
			const move = moved.get(n.symbol);
			if (move)
				error(
					`"${n.symbol.name ?? ''}" used after move ${move.context} at ${moveLocation(move.position)}`,
					n,
				);
			else {
				const owner = borrowed?.get(n.symbol);
				const ownerMove = owner && moved.get(owner);
				if (owner && ownerMove)
					error(
						`"${n.symbol.name ?? ''}" used after its value moved with "${owner.name ?? ''}" ${ownerMove.context} at ${moveLocation(ownerMove.position)}`,
						n,
					);
			}
			return;
		}
		if (n.kind === 'fn' || n.kind === 'main' || n.kind === 'test') return;
		if ('children' in n && n.children)
			for (let i = 0; i < n.children.length; i++) {
				const k = n.children[i];
				if (k) flagMovedUses(k, moved, borrowed);
			}
	}
	function walkEmbeds(
		value: Node,
		seen: Set<Symbol>,
		owned: Set<Symbol>,
		borrowed: Map<Symbol, Symbol>,
		onMove: (sym: Symbol, position: Position) => void,
	): void {
		if (value.kind !== 'data') return;
		const inner = value.children[0];
		const items = !inner
			? []
			: inner.kind === ','
				? inner.children
				: [inner];
		// A single unlabeled non-nominal block collapses to its value — an
		// alias, not a fresh record; nothing is embedded.
		if (items.length === 1 && items[0]?.kind !== 'propdef' && !value.nominal)
			return;
		for (const item of items) {
			const v = item.kind === 'propdef' ? item.value : item;
			if (!v) continue;
			if (v.kind === 'data') {
				walkEmbeds(v, seen, owned, borrowed, onMove);
				continue;
			}
			if (v.kind !== 'ident') continue;
			const t = resolver(v);
			if (!isHeapType(t)) continue;
			const name = v.symbol.name ?? '';
			if (seen.has(v.symbol)) {
				error(
					`"${name}" is embedded twice — a record member owns its value`,
					v,
				);
				continue;
			}
			seen.add(v.symbol);
			if (owned.has(v.symbol)) {
				onMove(v.symbol, v);
				continue;
			}
			error(
				`cannot embed borrowed "${name}" — record members own their values`,
				v,
			);
		}
	}

	function consumingMove(
		node: NodeMap['call'],
		fn: SymbolMap['function'],
		index: number,
		position: Position,
	): Move {
		const parameter = fn.parameters?.[index];
		const parameterName = parameter?.name
			? `"${parameter.name}"`
			: `${index + 1}`;
		const callee = node.children[0];
		const name =
			fn.name ?? (callee.kind === 'ident' ? callee.symbol.name : undefined);
		const functionName = name ? ` of "${name}"` : '';
		return {
			position,
			context: `into \`own\` parameter ${parameterName}${functionName}`,
		};
	}

	function markCallMoves(
		node: NodeMap['call'],
		owned: Set<Symbol>,
		moved: Map<Symbol, Move>,
	): void {
		const fn = resolveFunctionType(node.children[0]);
		if (!fn) return;
		const list = node.children[1];
		const args = list?.kind === ',' ? list.children : list ? [list] : [];
		const seenExclusive = new Set<Symbol>();
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const mode = fn.parameters?.[i]?.ownership;
			if (!arg || arg.kind !== 'ident') continue;
			const type = resolver(arg);
			const heap = isHeapType(type);
			if (!heap) continue;
			if (mode === 'own') {
				if (seenExclusive.has(arg.symbol))
					error(
						`"${arg.symbol.name ?? ''}" is passed to conflicting ownership slots`,
						arg,
					);
				seenExclusive.add(arg.symbol);
			}
			if (mode !== 'own') continue;
			if (!owned.has(arg.symbol))
				error(
					`cannot move borrowed "${arg.symbol.name ?? ''}" into an \`own\` parameter`,
					arg,
				);
			else moved.set(arg.symbol, consumingMove(node, fn, i, arg));
		}
	}

	function markConsumingMoves(
		n: Node,
		owned: Set<Symbol>,
		moved: Map<Symbol, Move>,
	): void {
		if (n.kind === 'fn' || n.kind === 'main' || n.kind === 'test') return;
		if (n.kind === 'call') markCallMoves(n, owned, moved);
		if ('children' in n && n.children)
			for (let i = 0; i < n.children.length; i++) {
				const k = n.children[i];
				if (k) markConsumingMoves(k, owned, moved);
			}
	}
	function checkMoves(node: {
		parameters?: NodeMap['parameter'][];
		statements?: Node[];
		symbol?: SymbolMap['function'];
	}): void {
		if (!node.statements) return;
		const owned = new Set<Symbol>(
			node.parameters
				?.filter(p => p.symbol.ownership === 'own')
				.map(p => p.symbol) ?? [],
		);
		const moved = new Map<Symbol, Move>();
		const borrowed = new Map<Symbol, Symbol>();
		for (const s of node.statements) {
			flagMovedUses(s, moved, borrowed);
			markConsumingMoves(s, owned, moved);
			if (s.kind === 'def') {
				walkEmbeds(s.value, new Set(), owned, borrowed, m => {
					owned.delete(m);
					borrowed.set(m, s.symbol);
				});
				// `b = a` of an owned local: b borrows a value that dies
				// with this block — track it so emitting b is rejected and
				// reads after `a` moves are flagged.
				if (
					s.value.kind === 'ident' &&
					owned.has(s.value.symbol)
				)
					borrowed.set(s.symbol, s.value.symbol);
				if (ownedHere(s)) owned.add(s.symbol);
			} else if (s.kind === 'next') {
				const v = s.children?.[0];
				if (v && v.kind === 'ident' && borrowed.has(v.symbol))
					error(
						`cannot emit "${v.symbol.name ?? ''}" — it borrows a value that dies with this block`,
						v,
					);
				else if (v && v.kind === 'ident' && owned.has(v.symbol))
					moved.set(v.symbol, {
						position: v,
						context: 'with `next`',
					});
				else if (v && v.kind === 'data')
					walkEmbeds(v, new Set(), owned, borrowed, (m, position) => {
						owned.delete(m);
						moved.set(m, {
							position,
							context: 'into an emitted record',
						});
				});
			}
		}
		checkDeclaredOwnedReturn(node, owned);
	}

	function checkDeclaredOwnedReturn(
		node: {
			statements?: Node[];
			symbol?: SymbolMap['function'];
		},
		owned: Set<Symbol>,
	): void {
		const fn = node.symbol;
		if (fn?.returnOwnerships) {
			const values = (node.statements ?? []).flatMap(statement => {
				if (statement.kind !== 'next' || !statement.children?.[0]) return [];
				const value = statement.children[0];
				return value.kind === ',' ? value.children : [value];
			});
			fn.returnOwnerships.forEach((ownership, index) => {
				const value = values[index];
				if (ownership === 'own' && value)
					checkOwnedReturn(value, owned, fn);
			});
			return;
		}
		if (fn?.returnOwnership !== 'own') return;
		const statements = node.statements;
		const tail = statements?.[statements.length - 1];
		if (tail) checkOwnedReturn(tail, owned, fn);
	}

	function mutableIdentReturnOrigin(
		node: NodeMap['ident'],
		fn: NodeMap['fn'],
		seen: Set<Symbol>,
	): number[] | undefined {
		if (node.symbol.kind !== 'variable') return undefined;
		const index = fn.parameters?.findIndex(
			parameter => parameter.symbol === node.symbol,
		);
		if (
			index !== undefined &&
			index >= 0 &&
			fn.parameters?.[index]?.symbol.ownership === 'var'
		)
			return [index];
		if (seen.has(node.symbol)) return undefined;
		seen.add(node.symbol);
		const definition = node.symbol.definition;
		return definition?.kind === 'def'
			? mutableReturnOrigin(definition.value, fn, seen)
			: undefined;
	}

	function mutableCallReturnOrigin(
		node: NodeMap['call'],
		fn: NodeMap['fn'],
		seen: Set<Symbol>,
	): number[] | undefined {
		const callee = resolveFunctionType(node.children[0]);
		if (callee?.returnOwnership !== 'var') return undefined;
		const origins = callee.returnBorrowOrigins;
		if (!origins?.length) return undefined;
		const args = node.children[1];
		const values = args?.kind === ',' ? args.children : args ? [args] : [];
		const mapped = origins.map(origin => {
			const value = values[origin];
			return value
				? mutableReturnOrigin(value, fn, new Set(seen))
				: undefined;
		});
		if (mapped.some(origin => origin === undefined)) return undefined;
		return [...new Set(mapped.flatMap(origin => origin ?? []))];
	}

	function mutableConditionalReturnOrigin(
		node: NodeMap['?'],
		fn: NodeMap['fn'],
		seen: Set<Symbol>,
	): number[] | undefined {
		const truthy = mutableReturnOrigin(
			node.children[1],
			fn,
			new Set(seen),
		);
		const alternate = node.children[2];
		const falsy = alternate
			? mutableReturnOrigin(alternate, fn, new Set(seen))
			: undefined;
		return truthy && falsy
			? [...new Set([...truthy, ...falsy])]
			: undefined;
	}

	function mutableReturnOrigin(
		node: Node,
		fn: NodeMap['fn'],
		seen = new Set<Symbol>(),
	): number[] | undefined {
		if (node.kind === 'next') {
			const value = node.children?.[0];
			return value ? mutableReturnOrigin(value, fn, seen) : undefined;
		}
		if (node.kind === '?')
			return mutableConditionalReturnOrigin(node, fn, seen);
		if (node.kind === '>>') {
			const source = node.children[0];
			const output = node.children[node.children.length - 1];
			return source && output && pipeOutputOwnership(output) === 'var'
				? mutableReturnOrigin(source, fn, seen)
				: undefined;
		}
		if (node.kind === 'ident')
			return mutableIdentReturnOrigin(node, fn, seen);
		if (node.kind === 'call') return mutableCallReturnOrigin(node, fn, seen);
	}

	function checkMutableReturn(node: NodeMap['fn']): void {
		if (node.symbol.returnOwnership !== 'var') return;
		const statements = node.statements ?? [];
		const emissions = statements.filter(statement => statement.kind === 'next');
		const origins = emissions.map(emission =>
			mutableReturnOrigin(emission, node),
		);
		if (!origins.length || origins.some(origin => origin === undefined)) {
			error('`var` result must originate from a `var` parameter', node);
			return;
		}
		node.symbol.returnBorrowOrigins = [
			...new Set(origins.flatMap(origin => origin ?? [])),
		];
	}

	function checkOwnedReturn(
		node: Node,
		owned: Set<Symbol>,
		fn: SymbolMap['function'],
	): void {
		if (node.kind === 'next') {
			const value = node.children?.[0];
			if (value) checkOwnedReturn(value, owned, fn);
			return;
		}
		if (node.kind === '?') {
			checkOwnedReturn(node.children[1], owned, fn);
			const alternate = node.children[2];
			if (alternate) checkOwnedReturn(alternate, owned, fn);
			return;
		}
		const type = resolver(node);
		if (!isHeapType(type)) return;
		if (node.kind === 'ident' && owned.has(node.symbol)) return;
		if (node.kind === 'string' || node.kind === 'interp' || node.kind === 'data')
			return;
		if (node.kind === 'call') {
			const callee = resolveFunctionType(node.children[0]);
			if (callee?.returnOwnership === 'own') return;
			if (node.children[0].kind === 'typeident') return;
		}
		error(
			`function "${fn.name ?? ''}" declares an \`own\` result but emits a borrowed value`,
			node,
		);
	}

	function checkFnDef(node: NodeMap['fn']) {
		resolver(node);
		checkOnlyStmt(node);
		checkReturnTypeAssignable(node);
		checkNoClosureCapture(node);
		checkUnusedValues(node);
		if (node.statements) {
			checkRedundantIntermediates(node.statements);
			checkEach(node.statements);
		}
		checkDeclaredEmissions(node);
		checkMoves(node);
		functionOutputOwnership(node);
		checkMutableReturn(node);
	}

	function checkOnlyStmt(c: NodeMap['fn'], i?: number) {
		const stmts = c.statements;
		if (stmts?.length !== 1) return;
		const only = stmts[0];
		if (only?.kind === 'next' && !only.implicit)
			error(
				'`next` is not allowed in a single-statement function. Use `{ X }` to emit X directly.',
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

	/** A multi-statement stage body must end in `next`/`done`/`break`, an
	 * assignment, or a Void expression — a dangling value would corrupt the
	 * pipe's stack (there is no implicit tail emission in stages). */
	function checkStageTail(c: NodeMap['fn']) {
		const stmts = c.statements;
		if (!stmts || stmts.length < 2) return;
		const last = stmts[stmts.length - 1];
		if (
			!last ||
			last.kind === 'next' ||
			last.kind === 'done' ||
			last.kind === 'break' ||
			last.kind === '=' ||
			last.kind === 'def' ||
			last.kind === 'comment'
		)
			return;
		const t = resolver(last);
		if (isUnusedValue(t)) error(unusedValueMessage(t), last);
	}

	function checkStageReturnType(c: NodeMap['fn']) {
		if (!c.returnType || c.statements?.length !== 1) return;
		const statement = c.statements[0];
		const stmt =
			statement?.kind === 'next' ? statement.children?.[0] : statement;
		if (
			!stmt ||
			stmt.kind === 'done' ||
			stmt.kind === 'break'
		)
			return;
		resolver(c);
		const t = resolver(stmt);
		const known = !(t.kind === 'type' && t.family === 'unknown');
		if (c.symbol.returnType && branchesFit(stmt, c.symbol.returnType))
			return;
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
		checkOnlyStmt(c, i);
		if (hasStmts && !c.parameters?.length) {
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
		if (stmts)
			for (const s of stmts) {
				checkStageConditions(s);
				rejectAssignments(s);
			}
		checkStageReturnType(c);
		checkStageTail(c);
	}

	function rejectAssignments(node: Node): void {
		if (node.kind === '=')
			error(`Cannot reassign binding "${text(node.children[0])}"`, node.children[0]);
		if ('children' in node && node.children)
			for (let i = 0; i < node.children.length; i++) {
				const child = node.children[i];
				if (child) rejectAssignments(child);
			}
		if (node.kind === 'fn' && node.statements)
			for (const statement of node.statements) rejectAssignments(statement);
	}

	function stageAcceptType(stage: Node): Type | undefined {
		if (stage.kind === 'fn') {
			if ((stage.parameters?.length ?? 0) > 1) return undefined;
			return paramDeclaredType(stage, 0);
		}
		if (stage.kind === '|') {
			const arms: Node[] = [];
			const collect = (n: Node): void => {
				if (n.kind === '|') {
					collect(n.children[0]);
					collect(n.children[1]);
					return;
				}
				arms.push(n);
			};
			collect(stage);
			const accepts = arms.map(stageAcceptType);
			// An arm that accepts "any" (undefined) makes the group unbounded.
			if (accepts.some(a => a === undefined)) return undefined;
			return unionOf(accepts.filter((a): a is Type => a !== undefined));
		}
		if (stage.kind === 'ident' || stage.kind === '.') {
			const fsym = pipeStageFn(stage);
			if (!fsym) return undefined;
			const cands = fsym.overloads ? [fsym, ...fsym.overloads] : [fsym];
			const parts: Type[] = [];
			for (const c of cands) {
				if ((c.parameters?.length ?? 0) !== 1) return undefined;
				const p = c.parameters?.[0]?.type;
				if (!p) return undefined;
				parts.push(p);
			}
			return unionOf(parts);
		}
		return undefined;
	}

	function stageEmitType(stage: Node, input: Type | undefined): Type {
		if (stage.kind === 'fn') {
			const ft = resolveFnType(stage);
			return ft.kind === 'function' && ft.returnType
				? ft.returnType
				: BT.Unknown;
		}
		if (stage.kind === '|') {
			const parts: Type[] = [];
			const walk = (n: Node): void => {
				if (n.kind === '|') {
					walk(n.children[0]);
					walk(n.children[1]);
					return;
				}
				parts.push(stageEmitType(n, input));
			};
			walk(stage);
			return unionOf(parts);
		}
		if (input) {
			const specialized = resolveFunctionStageReturn(stage, input);
			if (specialized) return specialized;
		}
		const fsym = pipeStageFn(stage);
		if (fsym) return fsym.returnType ?? BT.Void;
		return BT.Unknown;
	}

	function stagedLoop(children: Node[]): Node | undefined {
		for (let i = 1; i < children.length; i++)
			if (children[i]?.kind === 'loop') return children[i];
	}

	function checkPipe(node: NodeMap['>>']) {
		const kids = node.children;
		const invalidLoop = stagedLoop(kids);
		if (invalidLoop) {
			error(
				'`loop` is valid only as a pipe source; use tail recursion for loop-carried state',
				invalidLoop,
			);
			return;
		}
		inferPipeStageParams(kids);
		checkPipeStageOwnership(kids);
		for (let i = 0; i < kids.length; i++) {
			const c = kids[i];
			if (!c) continue;
			if (c.kind === 'fn') checkPipeStageFn(c, i);
			else if (c.kind === '|' && i > 0) {
				const checkArms = (n: Node): void => {
					if (n.kind === '|') {
						checkArms(n.children[0]);
						checkArms(n.children[1]);
					} else if (n.kind === 'fn') checkPipeStageFn(n, i);
					else check(n);
				};
				checkArms(c);
			} else check(c);
		}
		const litType = (v: string | number | boolean | bigint): Type => ({
			kind: 'type',
			flags: 0,
			family: 'literal',
			name: typeof v === 'string' ? `'${v}'` : String(v),
			size:
				typeof v === 'string'
					? 0
					: typeof v === 'boolean'
						? 1
						: typeof v === 'bigint'
							? 8
							: Number.isInteger(v)
								? 4
								: 8,
			value: v,
		});
		// A literal value (`5`, `'x'`, `true`) carries its literal type here, so a
		// single matching arm exhausts it; a base-typed value (`Int32`, `Bool`)
		// needs arms covering its domain.
		const emitTypeOf = (n: Node): Type => {
			if (n.kind === 'number') return litType(n.value);
			if (n.kind === 'string') return litType(text(n).slice(1, -1));
			if (n.kind === 'ident' && n.symbol.kind === 'literal') {
				const v = n.symbol.value;
				if (
					typeof v === 'string' ||
					typeof v === 'number' ||
					typeof v === 'boolean'
				)
					return litType(v);
			}
			return resolver(n);
		};
		const covers = (accept: Type, m: Type): boolean => {
			if (canAssign(accept, m)) return true;
			if (m.kind === 'type' && m.family === 'bool')
				return (
					canAssign(accept, litType(true)) &&
					canAssign(accept, litType(false))
				);
			return false;
		};
		let emit = kids[0] ? emitTypeOf(kids[0]) : undefined;
		for (let i = 1; i < kids.length; i++) {
			const stage = kids[i];
			if (!stage) continue;
			if (
				emit &&
				emit.kind === 'type' &&
				emit.family !== 'unknown' &&
				emit.family !== 'void'
			) {
				const accept = stageAcceptType(stage);
				if (accept !== undefined && !isTypeParam(accept)) {
					const members: Type[] =
						emit.family === 'union' ? emit.members : [emit];
					const uncovered = members.find(m => !covers(accept, m));
					if (uncovered)
						error(
							`pipe stage does not consume "${typeToStr(
								uncovered,
							)}" of "${typeToStr(emit)}"`,
							stage,
						);
				}
			}
			emit = stageEmitType(stage, emit);
		}
		const terminal = kids[kids.length - 1];
		if (emit?.kind === 'function' && terminal)
			error(unusedValueMessage(emit), terminal);
	}

	function pipeFunctionNode(stage: Node): NodeMap['fn'] | undefined {
		if (stage.kind === 'fn') return stage;
		const symbol = stage.kind === 'ident' ? stage.symbol : undefined;
		const definition = symbol?.definition;
		if (definition?.kind === 'fn') return definition;
		if (definition?.kind === 'def' && definition.value.kind === 'fn')
			return definition.value;
		const fnDefinition = pipeStageFn(stage)?.definition;
		if (fnDefinition?.kind === 'fn') return fnDefinition;
		if (fnDefinition?.kind === 'def' && fnDefinition.value.kind === 'fn')
			return fnDefinition.value;
	}

	function expressionOwnership(node: Node): OwnershipMode | undefined {
		if (node.kind === 'next')
			return node.children?.[0]
				? expressionOwnership(node.children[0])
				: undefined;
		if (node.kind === 'ident' && node.symbol.kind === 'variable') {
			if (node.symbol.ownership) return node.symbol.ownership;
			const definition = node.symbol.definition;
			return definition?.kind === 'def' && ownedHere(definition)
				? 'own'
				: 'borrow';
		}
		if (node.kind === 'call') {
			const callee = resolveFunctionType(node.children[0]);
			if (callee?.returnOwnership) return callee.returnOwnership;
			if (node.children[0].kind === 'typeident') return 'own';
		}
		if (node.kind === 'string' || node.kind === 'interp' || node.kind === 'data')
			return 'own';
	}

	function functionOutputOwnership(
		fn: NodeMap['fn'],
	): OwnershipMode | undefined {
		if (outputOwnershipChecked.has(fn.symbol))
			return fn.symbol.returnOwnership;
		outputOwnershipChecked.add(fn.symbol);
		if (fn.symbol.returnOwnership) return fn.symbol.returnOwnership;
		const statements = fn.statements ?? [];
		const emissions = statements.filter(
			(statement): statement is NodeMap['next'] => statement.kind === 'next',
		);
		let mode: OwnershipMode | undefined;
		for (const emission of emissions) {
			const current = expressionOwnership(emission);
			if (!current) continue;
			if (mode && mode !== current) {
				fn.symbol.returnOwnership = 'borrow';
				return 'borrow';
			}
			mode = current;
		}
		if (mode) fn.symbol.returnOwnership = mode;
		return mode;
	}

	function pipeOutputOwnership(node: Node): OwnershipMode | undefined {
		const fn = pipeFunctionNode(node);
		if (fn) return functionOutputOwnership(fn);
		return expressionOwnership(node);
	}

	function checkPipeStageOwnership(children: Node[]): void {
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			const parameter = pipeStageFn(stage)?.parameters?.[0];
			const expected = parameter?.ownership;
			if (expected !== 'own' && expected !== 'var') continue;
			const mode = pipeOutputOwnership(input);
			if (expected === 'var') {
				if (mode !== 'own' && mode !== 'var')
					error('a `var` stage requires mutable access from its input', stage);
				continue;
			}
			if (mode === 'var')
				error('cannot move mutable borrow into `own` stage', stage);
			else if (mode === 'borrow')
				error('cannot move shared borrow into `own` stage', stage);
		}
	}

	function requireBoolCond(cond: Node) {
		if (isConstCondition(cond)) {
			error(
				'`?:` condition is a compile-time constant; one branch is dead code',
				cond,
			);
			return;
		}
		const ct = resolver(cond);
		if (ct.kind === 'type' && ct.family !== 'bool' && ct.family !== 'unknown')
			error('`?:` condition must be `Bool`', cond);
	}

	function checkStageConditions(node: Node) {
		if (node.kind === 'fn') return;
		if (node.kind === '?') requireBoolCond(node.children[0]);
		if ('children' in node && node.children)
			for (let i = 0; i < node.children.length; i++) {
				const c = node.children[i];
				if (c) checkStageConditions(c);
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
		requireBoolCond(cond);
	}

	function checkRoot(node: NodeMap['root']): void {
		let seenMain = false;
		for (const c of node.children) {
			if (c.kind !== 'main') continue;
			if (seenMain) error('multiple `main` blocks are not allowed', c);
			seenMain = true;
		}
		checkEach(node.children);
	}

	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkRoot(node);
			case 'fn':
				return checkFnDef(node);
			case 'main':
				checkRedundantIntermediates(node.statements);
				checkEach(node.statements);
				checkUnusedStatements(node.statements);
				return checkMoves(node);
			case 'test':
				checkRedundantIntermediates(node.statements);
				return checkEach(node.statements);
			case 'import':
				return;
			case 'data': {
				const inner = node.children[0];
				const items =
					inner?.kind === ',' ? inner.children : inner ? [inner] : [];
				if (items.length === 0)
					error(
						'empty data block `[]` is not a value (type-level `[]` is Void)',
						node,
					);
				return checkEach(items);
			}
			case 'extend': {
				check(node.children[1]);
				const armSym = resolver(node.children[1]);
				const targetName = text(node.children[0]);
				const rt =
					armSym.kind === 'function' ? armSym.returnType : undefined;
				if (rt && rt.kind === 'type' && rt.name !== targetName)
					error(
						`constructor arm must return ${targetName}`,
						node,
					);
				return;
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
			case '%':
				return numberBinaryOperator(node);
			case '&':
			case '^':
			case '<:':
			case ':>':
				return bitwiseOperator(node);
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
				const isBool = (n: Node) => {
					const t = resolver(n);
					return t.kind === 'type' && t.family === 'bool';
				};
				if (isBool(node.children[0]) !== isBool(node.children[1]))
					error(
						'`==`/`!=` cannot compare `Bool` with a non-`Bool` type',
						node,
					);
				return;
			}
			case '>>':
				return checkPipe(node);
			case '?':
				return checkTernary(node);
			case '|': {
				const lt = resolver(node.children[0]);
				const rt = resolver(node.children[1]);
				if (isNumericType(lt) && isNumericType(rt))
					return bitwiseOperator(node);
				if (!dispatchArms(node)) {
					if (isIntType(lt) || isIntType(rt))
						error(
							'Operator "|" requires integer operands',
							node,
						);
					for (const c of node.children) check(c);
					return;
				}
				for (const c of node.children) check(c);
				return;
			}
			case ',':
			case 'interp':
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
		return s.type;
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
		inputType: ResolvedType,
	) {
		// A single slot binds the whole upstream value.
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
		if (!p.type) p.type = declared ?? inputType;
	}

	// Rest slot: [] → Void; one → that type; many → data.
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
		inputType: ResolvedType,
	) {
		// The last slot binds rest; scalar input lifts to [scalar].
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
			for (const s of stage.statements) annotateDollar(s, dollarT);
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
		if (stagedLoop(children)) return;
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			if (stage.kind === '|') {
				// Each dispatch arm infers `$` from its own declared type.
				const collect = (n: Node): void => {
					if (n.kind === '|') {
						collect(n.children[0]);
						collect(n.children[1]);
					} else inferPipeStage(n, input);
				};
				collect(stage);
			} else inferPipeStage(stage, input);
		}
	}

	function pipeStageFn(stage: Node): SymbolMap['function'] | undefined {
		if (stage.kind === 'fn') return stage.symbol;
		if (stage.kind === '.') {
			const t = resolveMemberType(stage);
			return t.kind === 'function' ? t : undefined;
		}
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
		if (node.kind === 'fn') resolveFnType(node);
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
		if (
			node.kind === 'fn' &&
			node.symbol.name &&
			!node.symbol.emissionType
		)
			resolveFnType(node);
	}

	function finalizeFnSemantics(node: Node, seen = new Set<Node>()): void {
		if (seen.has(node)) return;
		seen.add(node);
		if ('children' in node)
			for (const child of node.children ?? [])
				if (child) finalizeFnSemantics(child, seen);
		if (node.kind === 'fn' && node.statements) {
			for (const statement of node.statements)
				finalizeFnSemantics(statement, seen);
			inferFnElementReturn(node);
			setFnForwarding(node);
		}
		if (node.kind === 'main' || node.kind === 'test')
			for (const statement of node.statements)
				finalizeFnSemantics(statement, seen);
	}

	return {
		run: () => {
			walkPipes(root);
			check(root);
			finalizeFnSemantics(root);
		},
		resolver,
	};
}
