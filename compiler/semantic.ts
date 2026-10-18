import { text } from '@cxl/gbc.sdk';

import { childNodes } from './node.js';
import type { InfixNode, Node, NodeMap } from './node.js';
import {
	BaseTypes as BT,
	BufferSymbol,
	Flags,
	bufferTypeOf,
	classifyEmission,
	vectorTypeOf,
	emissionElements,
	fixedEmissionType,
	restEmissionType,
	isFloatType,
	isIntType,
	isCollection,
	isNumericType,
	isVectorType,
	numberLiteralType,
	numericResultType,
	unifyTypeParam,
} from './symbol-table.js';
import { runtimeErrorType, runtimeResultType } from './runtime-errors.js';
import type {
	OwnershipMode,
	ResolvedType,
	Symbol,
	SymbolMap,
	Type,
} from './symbol-table.js';

// The stdlib `DivByZero` type, injected at program init so the free
// type-resolution layer can build `Int32 | DivByZero` for runtime division.
let divByZero: Type | undefined;
export function setDivByZero(t: Type | undefined): void {
	divByZero = t;
}

export function argumentNodes(args: Node | undefined): Node[] {
	return args?.kind === ',' ? args.children : args ? [args] : [];
}

export function dataItems(node: Node): Node[] {
	return node.kind === 'data' ? argumentNodes(node.children[0]) : [];
}

function isVoidLiteralNode(node: Node | undefined): boolean {
	return node?.kind === 'ident' && node.symbol.kind === 'literal' &&
		node.symbol.type?.kind === 'type' && node.symbol.type.family === 'void';
}

export function resolveArgNodes(params: Symbol[], args: Node[]): (Node | undefined)[] {
	const first = args[0];
	const list = args.length === 1 && first?.kind === 'data' && params.length !== 1
		? dataItems(first) : args;
	const named = list.some(arg => arg.kind === 'propdef' && !!arg.label);
	if (named && list.some(arg => arg.kind !== 'propdef'))
		throw new Error('cannot mix positional and named arguments');
	const byName = named ? new Map<string, Node>() : undefined;
	if (byName)
		for (const arg of list)
			if (arg.kind === 'propdef' && arg.label && arg.value && !isVoidLiteralNode(arg.value))
				byName.set(arg.symbol.name, arg.value);
	return params.map((param, index) => {
		const arg = byName ? byName.get(param.name ?? '') : list[index];
		const def = param.definition;
		return arg && !isVoidLiteralNode(arg) ? arg : def?.kind === 'parameter' ? def.value : undefined;
	});
}

export function literalType(node: Node): Type | undefined {
	switch (node.kind) {
		case 'number':
			return node.float ? BT.Float64 : numberLiteralType(node.value);
		case 'string': {
			const v = (node.value ?? text(node)).slice(1, -1);
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
		default:
			return undefined;
	}
}

export function floatFitsInteger(value: number, target: ResolvedType): boolean {
	if (!Number.isFinite(value)) return false;
	const bits = target.size * 8;
	const unsigned = target.family === 'uint';
	const minimum = unsigned ? 0 : -(2 ** (bits - 1));
	const maximum = unsigned ? 2 ** bits : 2 ** (bits - 1);
	return value >= minimum && value < maximum;
}

export function dispatchArgType(t: Type): Type {
	if (t.kind === 'type' && t.family === 'union') {
		const m = t.members.find(
			x => !(x.kind === 'type' && x.family === 'data' && x.name !== '__data'),
		);
		if (m) return dispatchArgType(m);
	}
	if (t.kind === 'type' && t.family === 'literal') {
		const v = t.value;
		if (typeof v === 'string') return BT.String;
		if (typeof v === 'boolean') return BT.Bool;
		if (typeof v === 'number')
			return Number.isInteger(v) ? BT.Int32 : BT.Float64;
	}
	return t;
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
	if (target?.kind !== 'type') return false;
	const r = intRange[target.family + target.size];
	return !!r && node.value >= r[0] && node.value <= r[1];
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
	if (type?.kind === 'type' && type.family === 'vector')
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

export function constantNumericValue(node: Node): number | undefined {
	if (node.kind === 'number' && typeof node.value === 'number') return node.value;
	if (node.kind !== 'call') return;
	const callee = node.children[0];
	const argument = node.children[1];
	if (
		callee.kind !== 'typeident' ||
		!argument ||
		argument.kind === ',' ||
		!isNumericType(callee.symbol.type)
	)
		return;
	return constantNumericValue(argument);
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

function functionTypeParameters(fn: SymbolMap['function']): Type[] {
	const definition = fn.definition;
	return fn.typeParams ?? (definition?.kind === 'fn'
		? definition.typeParameters?.map(param => param.symbol.type).filter((type): type is Type => !!type)
		: undefined) ?? [];
}

function callTypeBindings(fn: SymbolMap['function'], args: Type[]): Map<string, Type> {
	const parameters = functionTypeParameters(fn);
	const names = new Set(parameters.map(type => type.name).filter((name): name is string => !!name));
	const bindings = new Map<string, Type>();
	(fn.parameters ?? []).forEach((param, index) => unifyTypeParam(param.type, args[index], names, bindings));
	return bindings;
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

export function isKnownNonZeroNumber(
	node: Node,
	seen?: Set<Symbol>,
): boolean {
	if (node.kind === 'number') return node.value !== 0;
	if (node.kind !== 'ident') return false;
	const sym = node.symbol;
	if (seen?.has(sym)) return false;
	const definition = sym.definition;
	if (definition?.kind !== 'def') return false;
	const visited = seen ?? new Set<Symbol>();
	visited.add(sym);
	return isKnownNonZeroNumber(definition.value, visited);
}

function knownNumberValue(
	node: Node,
	seen?: Set<Symbol>,
): number | bigint | undefined {
	if (node.kind === 'number') return node.value;
	if (node.kind !== 'ident') return;
	const sym = node.symbol;
	if (seen?.has(sym)) return;
	const definition = sym.definition;
	if (definition?.kind !== 'def') return;
	const visited = seen ?? new Set<Symbol>();
	visited.add(sym);
	return knownNumberValue(definition.value, visited);
}

function numericLiteralValue(type: Type): number | bigint | undefined {
	return type.kind === 'type' &&
		type.family === 'literal' &&
		(typeof type.value === 'number' || typeof type.value === 'bigint')
		? type.value
		: undefined;
}

function numericOperationErrors(
	node: InfixNode,
	base: Type,
	right: Type,
): Type[] {
	const errors: Type[] = [];
	const literal = numericLiteralValue(right);
	if ((node.kind === '/' || node.kind === '%') && divByZero) {
		const rhs = node.children[1];
		if (literal === undefined ? !isKnownNonZeroNumber(rhs) : literal === 0)
			errors.push(divByZero);
	}
	const overflow = runtimeErrorType('NumericOverflow');
	if (node.kind === '/' && base.kind === 'type' && base.family === 'int' && overflow) {
		const divisor = literal ?? knownNumberValue(node.children[1]);
		if (divisor === undefined || divisor === -1 || divisor === -1n)
			errors.push(overflow);
	}
	return errors;
}

function numericValueType(left: Type, right: Type): Type {
	if (isVectorType(left) && isVectorType(right)) return left;
	return numericResultType(left, right) ?? BT.Unknown;
}

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

function threadCall(
	call: NodeMap['call'],
	carrier: Node,
	spreadCarrier: boolean,
): NodeMap['call'] {
	const raw = call.children[1];
	const existing = raw?.kind === ',' ? raw.children : raw ? [raw] : [];
	const leading =
		spreadCarrier && carrier.kind === ',' ? carrier.children : [carrier];
	const children = [...leading, ...existing];
	const first = children[0];
	const last = children[children.length - 1];
	const args: Node | undefined =
		children.length === 1
			? first
			: first
				? {
						...call,
						kind: ',',
						start: first.start,
						end: last?.end ?? first.end,
						children,
					}
				: undefined;
	return { ...call, children: [call.children[0], args] };
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

/**
 * Determines the type of a node based on its kind and associated type declarations.
 */
function hasUnresolvedType(type: Type): boolean {
	if (type.kind !== 'type') return false;
	if (type.family === 'unknown') return true;
	if (type.family === 'union') return type.members.some(hasUnresolvedType);
	if (type.family === 'emission') {
		return (
			type.elements.some(hasUnresolvedType) ||
			(!!type.rest && hasUnresolvedType(type.rest))
		);
	}
	return false;
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
	for (const k of childNodes(node)) {
			if (k && refsAny(k, outer)) return true;
	}
	if (node.kind === 'fn' || node.kind === 'main')
		for (const s of node.statements ?? [])
			if (refsAny(s, outer)) return true;
	return false;
}

function sameScalarType(left: Type, right: Type): boolean {
	return left.kind === 'type' && right.kind === 'type' &&
		(isNumericType(left) || left.family === 'bool' || left.family === 'string' || left.family === 'char') &&
		left.family === right.family && left.name === right.name && left.size === right.size;
}

function paramsMatch(
	params: Symbol[] | undefined,
	argTypes: (Type | undefined)[],
	widen = false,
	scalarCopies = false,
): boolean {
	const arity = params?.length ?? 0;
	if (arity !== argTypes.length) return false;
	for (let i = 0; i < arity; i++) {
		const want = params?.[i]?.type;
		const got = argTypes[i];
		if (!want || !got) continue;
		if (canAssign(want, got) || (scalarCopies && sameScalarType(want, got))) continue;
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
	if (to.family === 'vector' && a.family === 'vector')
		return canAssign(to.elem, a.elem);
	return canAssignData(to, a);
}

function sameType(a: Type, b: Type): boolean {
	if (a === b) return true;
	return (
		a.kind === 'type' &&
		b.kind === 'type' &&
		(a.family === 'buffer' || a.family === 'vector') &&
		b.family === a.family &&
		a.name === b.name &&
		sameType(a.elem, b.elem)
	);
}

function isVectorArithmetic(
	kind: InfixNode['kind'],
	left: Type,
	right: Type,
): boolean {
	return (
		isVectorType(left) &&
		isVectorType(right) &&
		sameType(left, right) &&
		(kind === '+' || kind === '-' || kind === '*' || kind === '/')
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
	const add = (type: Type): void => {
		if (type.kind !== 'type') return;
		if (type.family === 'union') {
			for (const member of type.members) add(member);
			return;
		}
		seen.set(type.name, type);
	};
	for (const type of types) add(type);
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

function fallbackResultType(left: Type, right: Type): Type {
	const types: Type[] = [];
	if (left.kind === 'type' && left.family === 'union')
		types.push(
			...left.members.filter(
				member => member.kind !== 'type' || member.family !== 'void',
			),
		);
	else if (!(left.kind === 'type' && left.family === 'void')) types.push(left);
	types.push(right);
	return unionOf(types);
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
	if (t.family === 'buffer' || t.family === 'vector')
		return containsApp(t.elem, seen);
	return false;
}

export function createSemanticContext() {
	const nodeTypes = new WeakMap<Node, Type>();

	function setNodeType(node: Node, type: Type): void {
		nodeTypes.set(node, type);
	}

	const resolving = new Set<Symbol>();

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

	function scalarCtorType(node: NodeMap['call'], resolve: (node: Node) => Type = resolver): Type | undefined {
		const callee = node.children[0];
		const argument = node.children[1];
		if (
			callee.kind !== 'typeident' ||
			!argument ||
			argument.kind === ',' ||
			callee.symbol.type.kind !== 'type' ||
			(callee.symbol.type.family !== 'int' && callee.symbol.type.family !== 'uint') ||
			!isFloatType(resolve(argument))
		)
			return;
		const target = callee.symbol.type;
		const constant = constantNumericValue(argument);
		if (constant !== undefined && floatFitsInteger(constant, target)) return target;
		return runtimeResultType(target, 'NumericOverflow');
	}

	function callReturnType(node: NodeMap['call']): Type | undefined {
		const constructor = bufferCtorType(node) ?? scalarCtorType(node);
		if (constructor) return constructor;
		const fn = resolveFunctionType(node.children[0]);
		return fn ? resolveCallReturn(fn, callArgumentTypes(fn, node.children[1])) : resolveReturnType(node.children[0]);
	}

	function effectiveCallFunction(node: NodeMap['call']): SymbolMap['function'] | undefined {
		const fn = resolveFunctionType(node.children[0]);
		if (!fn) return undefined;
		return selectOverload([fn, ...(fn.overloads ?? [])], callArgumentTypes(fn, node.children[1])) ?? fn;
	}

	function callArgumentTypes(fn: SymbolMap['function'], args: Node | undefined, resolve: (node: Node) => Type = resolver): Type[] {
		if (args && args.kind !== ',' && args.kind !== 'propdef' && args.kind !== 'data' && !isVoidLiteralNode(args))
			return [resolve(args)];
		const raw = argumentNodes(args);
		const params = fn.parameters;
		if (!params?.length) return raw.map(resolve);
		if (raw.length === params.length && raw.every(arg => arg.kind !== 'propdef' && !isVoidLiteralNode(arg)))
			return raw.map(resolve);
		let bound: (Node | undefined)[];
		try {
			bound = resolveArgNodes(params, raw);
		} catch {
			return raw.map(resolve);
		}
		return bound.map(arg => arg ? resolve(arg) : BT.Unknown);
	}

	function resolveCallReturn(fn: SymbolMap['function'], argTypes: Type[], select = selectOverload, typeParams?: Type[]) {
		const target = fn.overloads?.length ? select(fn.overloads, argTypes) ?? fn : fn;
		const signature = typeParams && !target.typeParams ? { ...target, typeParams } : target;
		const result = functionElementReturn(target) ?? functionElementReturn(fn);
		return result ? substituteFunctionReturn(result, signature, argTypes) : undefined;
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
		return functionTypeParameters(fnSym).length ? reduceType(rt, callTypeBindings(fnSym, args)) : rt;
	}

	function selectOverload(candidates: SymbolMap['function'][], args: Type[], catchAll?: (fn: SymbolMap['function']) => boolean): SymbolMap['function'] | undefined {
		if (!candidates.length) return undefined;
		const matches = (candidate: SymbolMap['function'], widen: boolean) => {
			if (catchAll?.(candidate)) return false;
			let params = candidate.parameters;
			if (functionTypeParameters(candidate).length) {
				const bindings = callTypeBindings(candidate, args);
				params = params?.map(param => ({
					...param,
					type: param.type ? reduceType(param.type, bindings) : undefined,
				}));
			}
			return paramsMatch(params, args, widen, !!catchAll) && (params ?? []).every((param, index) => {
				const expected = param.type;
				const actual = args[index];
				return !catchAll || candidate.flags & Flags.Intrinsic ||
					expected?.kind !== 'type' || expected.family !== 'data' || expected.name === '__data' ||
					actual?.kind !== 'type' || actual.family !== 'data' || actual.name !== '__data' ||
					!!actual.components?.some(component => canAssign(expected, component));
			});
		};
		return candidates.find(candidate => matches(candidate, false)) ??
			candidates.find(candidate => matches(candidate, true)) ??
			(catchAll ? candidates.find(catchAll) : undefined);
	}

	function resolveFunctionStageReturn(stage: Node, input: Type): Type | undefined {
		const fnSym = resolveFunctionType(stage);
		if (!fnSym) return undefined;
		const effective =
			fnSym.overloads?.find(overload => {
				const args = pipeArgumentTypes(input, overload);
				return paramsMatch(overload.parameters, args);
			}) ?? fnSym;
		const rt = functionElementReturn(effective);
		if (!rt) return undefined;
		const args = pipeArgumentTypes(input, effective);
		return substituteFunctionReturn(rt, effective, args);
	}

	function resolveReturnType(node: Node) {
		const type = resolver(node);
		if (type.kind === 'function' && type.returnType) return type.returnType;
		if (type.kind === 'type' && type.family !== 'fn') return type;
	}

	function resolveDataType(node: NodeMap['data']): Type {
		const items = dataItems(node);
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

	function resolveNumericOp(node: InfixNode): Type {
		const lType = resolver(node.children[0]);
		const rType = resolver(node.children[1]);

		if (isInvalidType(lType) || isInvalidType(rType)) return invalidType;
		if (
			(lType.kind === 'type' && lType.family === 'unknown') ||
			(rType.kind === 'type' && rType.family === 'unknown')
		)
			return BT.Unknown;
		if (isVectorType(lType) || isVectorType(rType))
			return isVectorArithmetic(node.kind, lType, rType)
				? lType
				: invalidType;
		if (!isNumericType(lType) || !isNumericType(rType)) return invalidType;
		const base = numericValueType(lType, rType);
		if (isFloatType(base)) return base;
		return unionOf([base, ...numericOperationErrors(node, base, rType)]);
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
		if (t && !hasUnresolvedType(t)) sym.type = t;
		return t;
	}

	const inferringReturn = new Set<Symbol>();

	function callEmissionType(node: NodeMap['call']): EmissionShape | undefined {
		const fn = resolveFunctionType(node.children[0]);
		if (!fn) return undefined;
		const args = callArgumentTypes(fn, node.children[1]);
		const target = selectOverload(fn.overloads ?? [], args) ?? fn;
		return specializedCallEmission(target, args);
	}

	function specializedCallEmission(
		fn: SymbolMap['function'],
		argTypes: Type[],
	): EmissionShape | undefined {
		let emission = fn.emissionType;
		if (!emission && fn.returnTypes && !fn.returnVariants)
			emission = fixedEmissionType(fn.returnTypes, fn.returnOwnerships);
		if (emission?.family !== 'emission') {
			if (fn.returnVariants) return undefined;
			const scalar = fn.returnType ?? BT.Void;
			const specialized = substituteFunctionReturn(scalar, fn, argTypes);
			if (!knownEmissionType(specialized)) return undefined;
			return specialized.kind === 'type' && specialized.family === 'void'
				? fixedEmissionShape([])
				: fixedEmissionShape([specialized]);
		}
		const specialized = substituteFunctionReturn(
			emission,
			fn,
			argTypes,
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

	function fallbackEmissionType(
		node: NodeMap['??'],
		contextual: boolean,
	): EmissionShape | undefined {
		const left = valueEmissionType(node.children[0], contextual);
		const right = valueEmissionType(node.children[1], contextual);
		if (!left || !right) return undefined;
		if (left.elements.length === 0 && !left.rest) return right;
		if (left.elements.length === 1 && !left.rest) {
			const first = left.elements[0];
			if (first?.kind !== 'type' || first.family !== 'union') return left;
			const members = first.members.filter(
				member => member.kind !== 'type' || member.family !== 'void',
			);
			if (members.length === first.members.length) return left;
			return mergeAlternativeEmissions(
				fixedEmissionShape([unionOf(members)]),
				right,
			);
		}
		return mergeAlternativeEmissions(left, right);
	}

	function valueEmissionType(
		node: Node,
		contextual = false,
	): EmissionShape | undefined {
		if (node.kind === '??') return fallbackEmissionType(node, contextual);
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
		if (node.kind === '->') {
			const type = resolveThreadType(node);
			return type.kind === 'type' && type.family === 'void'
				? fixedEmissionShape([])
				: fixedEmissionShape([type]);
		}
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

	function resolveType(node: Node): Type | undefined {
		const literal = literalType(node);
		if (literal) return literal;
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
			case '??':
				return fallbackResultType(
					resolver(node.children[0]),
					resolver(node.children[1]),
				);
			case '>>':
				return resolvePipeType(node);
			case '->':
				return resolveThreadType(node);
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

	function resolveMemberType(node: NodeMap['.'], resolve: (node: Node) => Type = resolver, declared = true): Type {
		const left = node.children[0];
		const right = node.children[1];
		if (declared && right.kind === 'ident') {
			const sym = right.symbol;
			if (sym.kind === 'function') return sym;
			if (sym.kind === 'variable' && sym.type) return sym.type;
		}
		const lt = resolve(left);
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
				const statement = n.statements?.[0];
				if (!statement) {
					rets.push(BT.Void);
					return;
				}
				const body =
					statement.kind === 'next' ? statement.children?.[0] : statement;
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

	function resolveThreadType(node: NodeMap['->']): Type {
		let carrier: Node = node.children[0];
		let carrierType: Type | undefined =
			carrier.kind === ',' ? undefined : resolver(carrier);
		for (let i = 1; i < node.children.length; i++) {
			const stage = node.children[i];
			if (!stage || stage.kind !== 'call') continue;
			const call = threadCall(stage, carrier, i === 1);
			const emission = callEmissionType(call);
			if (!emission) return BT.Unknown;
			const classification = classifyEmission(emission);
			if (classification.cardinality === 'many') return BT.Unknown;
			if (classification.cardinality === 'zero') {
				if (!carrierType) return BT.Unknown;
				continue;
			}
			const output = callReturnType(call) ?? BT.Unknown;
			carrierType =
				classification.mayEmitVoid && carrierType
					? fallbackResultType(output, carrierType)
					: output;
			carrier = call;
			setNodeType(carrier, carrierType);
		}
		return carrierType ?? BT.Unknown;
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
				if (fs?.kind === 'function') overloads.push(fs);
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

	function resolver(node: Node): Type {
		const cached = nodeTypes.get(node);
		if (cached) return cached;
		const t = reduceType(resolveType(node) ?? BT.Unknown, EMPTY_BINDINGS);
		// Don't cache an unresolved result: the walkPipes pre-pass may resolve an
		// expression whose referenced defs aren't typed yet; caching Unknown would
		// poison the later check pass. Re-resolving Unknown is idempotent.
		if (!hasUnresolvedType(t)) nodeTypes.set(node, t);
		return t;
	}

	function annotateDollar(node: Node, type: Type): void {
		if (node.kind === '$') {
			nodeTypes.set(node, type);
			return;
		}
		if (node.kind === 'fn') return;
		const kids = childNodes(node);
		for (let i = 0; i < kids.length; i++) {
			const k = kids[i];
			if (k) annotateDollar(k, type);
		}
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

	function getListTypes(node: NodeMap[',']) {
		return node.children.map(resolver);
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
	function reduceType(t: Type, bindings: Map<string, Type>, depth = 0): Type {
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
		if (t.family === 'vector') {
			const e = reduceType(t.elem, bindings, depth + 1);
			return e === t.elem ? t : vectorTypeOf(e);
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

	return {
		setNodeType,
		isInvalidType,
		literalFits,
		branchesFit,
		typeToStr,
		effectiveCallFunction,
		resolveFunctionType,
		resolveFunctionStageReturn,
		callEmissionType,
		specializedCallEmission,
		threadCall,
		inferFnEmission,
		inferFnElementReturn,
		setFnForwarding,
		resolveFnType,
		dispatchArms,
		isConstCondition,
		resolveType,
		resolveMemberType,
		resolver,
		annotateDollar,
		isTypeParam,
		refsAny,
		canAssign,
		sameType,
		isVectorArithmetic,
		valueType,
		isUnusedValue,
		unusedValueMessage,
		unionOf,
		fallbackResultType,
		getListTypes,
		callTypeBindings,
		selectOverload,
		pipeArgumentTypes,
		reduceType,
		isKnownNonZeroNumber,
		scalarCtorType,
		bufferCtorType,
		numericValueType,
		callArgumentTypes,
		resolveCallReturn,
	};
}

export function reduceType(type: Type, bindings: Map<string, Type>, depth = 0): Type {
	return createSemanticContext().reduceType(type, bindings, depth);
}
