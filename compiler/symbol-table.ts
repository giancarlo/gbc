import { SymbolTable as BaseSymbolTable, Position } from '../sdk/index.js';
import type { Node } from './node.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
	Sequence = 4,
	External = 16,
	Intrinsic = 32,
	Collection = 64,
}

type BaseSymbol = {
	name?: string;
	definition?: Node;
	references?: Position[];
	type?: Type;
	flags: Flags;
	typeParams?: Type[];
	components?: Type[];
	application?: { fn: Type; argNodes: Node[] };
};
export type TypeFamily =
	| 'int'
	| 'uint'
	| 'float'
	| 'char'
	| 'bool'
	| 'string'
	| 'void'
	| 'fn'
	| 'data'
	| 'literal'
	| 'union'
	| 'unknown';

type TypeUnion =
	| {
			name: string;
			size: number;
			family: Exclude<TypeFamily, 'data' | 'literal' | 'union'>;
	  }
	| {
			name: string;
			size: number;
			family: 'data';
			members: Record<string, Symbol>;
			/** Runtime-length collection of `elem` (`Array<T>`): laid out
			 * `[len][cap][elem0][elem1]…` (payload at offset 8), elements
			 * inline at the element's stride. `members` stays empty —
			 * the length is not known at compile time. */
			elem?: Type;
	  }
	| {
			name: string;
			size: number;
			family: 'literal';
			value: unknown;
	  }
	| {
			name: string;
			size: number;
			family: 'union';
			members: Type[];
	  };

type SymbolProp = {
	type: TypeUnion;
	literal: { value: unknown };
	function: {
		parameters?: Symbol[];
		returnType?: Type;
		overloads?: SymbolMap['function'][];
	};
	parameter: unknown;
	variable: { name: string };
	data: { members: Record<string, Symbol> };
};
export type SymbolMap = {
	[K in keyof SymbolProp]: BaseSymbol & { kind: K } & SymbolProp[K];
};
export type Symbol = SymbolMap[keyof SymbolProp];
export type Scope = Map<string | symbol, Symbol>;

export type SymbolTable = ReturnType<typeof ProgramSymbolTable>;
export type TypesSymbolTable = ReturnType<typeof TypesSymbolTable>;
export type Type = SymbolMap['type' | 'function'];

// Shared numeric type predicates (used by both the checker and the WASM
// backend — single source of truth so the two never disagree on what `Int`,
// `Int64` or `Float` is).
export function isIntType(t?: Type): boolean {
	return t?.kind === 'type' && (t.family === 'int' || t.family === 'uint');
}
export function isInt64Type(t?: Type): boolean {
	return isIntType(t) && t?.kind === 'type' && t.size === 8;
}
export function isUintType(t?: Type): boolean {
	return t?.kind === 'type' && t.family === 'uint';
}
export function numberLiteralType(value: number | bigint): SymbolMap['type'] {
	if (typeof value === 'number')
		return value >= -0x80000000 && value <= 0x7fffffff
			? BaseTypes.Int32
			: BaseTypes.Int64;
	if (value >= -0x80000000n && value <= 0x7fffffffn) return BaseTypes.Int32;
	if (value >= -(1n << 63n) && value <= (1n << 63n) - 1n)
		return BaseTypes.Int64;
	return BaseTypes.Uint64;
}
export function isFloatType(t?: Type): boolean {
	return t?.kind === 'type' && t.family === 'float';
}
export function isNumericType(t?: Type): boolean {
	return isIntType(t) || isFloatType(t);
}

// Numeric promotion: the result type of an arithmetic op on `lt`/`rt` —
// Float64 if either is float, else Int64 if either is 64-bit, else Int32.
// `undefined` when the operands aren't a promotable numeric pair. (The checker
// layers `DivByZero` onto the int result for `/`,`%`.)
export function numericResultType(lt: Type, rt: Type): Type | undefined {
	if (isFloatType(lt) || isFloatType(rt)) return BaseTypes.Float64;
	if (isIntType(lt) && isIntType(rt)) {
		const l64 = isInt64Type(lt);
		const r64 = isInt64Type(rt);
		const wide = l64 || r64;
		const unsigned =
			l64 === r64
				? isUintType(lt) || isUintType(rt)
				: isUintType(l64 ? lt : rt);
		return wide
			? unsigned
				? BaseTypes.Uint64
				: BaseTypes.Int64
			: unsigned
				? BaseTypes.Uint32
				: BaseTypes.Int32;
	}
	return undefined;
}

// Unify a (possibly generic) parameter type against a concrete argument type,
// recording type-param → concrete-type bindings in `out`. Used by both the
// checker (constraint checking) and the WASM backend (monomorphization), so the
// two stay in lockstep. Only `names` (the fn's declared type params) are bound.
function unifyFunctionTypeParam(
	paramType: Type | undefined,
	argType: Type | undefined,
	names: Set<string>,
	out: Map<string, Type>,
): boolean {
	if (paramType?.kind !== 'function' || argType?.kind !== 'function')
		return false;
	const pp = paramType.parameters ?? [];
	const ap = argType.parameters ?? [];
	for (let i = 0; i < pp.length; i++)
		unifyTypeParam(pp[i]?.type, ap[i]?.type, names, out);
	unifyTypeParam(paramType.returnType, argType.returnType, names, out);
	return true;
}

function bindNamedTypeParam(
	paramType: Type,
	argType: Type,
	names: Set<string>,
	out: Map<string, Type>,
): boolean {
	if (!(
		paramType.kind === 'type' &&
		paramType.family === 'unknown' &&
		paramType.name &&
		names.has(paramType.name)
	))
		return false;
	if (argType.kind === 'type' && !out.has(paramType.name))
		out.set(paramType.name, argType);
	return true;
}

function unifyCollectionTypeParam(
	paramType: Type,
	argType: Type,
	names: Set<string>,
	out: Map<string, Type>,
): boolean {
	if (!(
		paramType.kind === 'type' &&
		paramType.family === 'data' &&
		paramType.elem &&
		argType.kind === 'type' &&
		argType.family === 'data' &&
		argType.elem
	))
		return false;
	unifyTypeParam(paramType.elem, argType.elem, names, out);
	return true;
}

export function unifyTypeParam(
	paramType: Type | undefined,
	argType: Type | undefined,
	names: Set<string>,
	out: Map<string, Type>,
): void {
	if (!paramType || !argType) return;
	if (unifyFunctionTypeParam(paramType, argType, names, out)) return;
	if (bindNamedTypeParam(paramType, argType, names, out)) return;
	if (unifyCollectionTypeParam(paramType, argType, names, out)) return;
	if (
		paramType.kind === 'type' &&
		paramType.family === 'data' &&
		argType.kind === 'type' &&
		argType.family === 'data'
	) {
		const pk = Object.keys(paramType.members);
		const ak = Object.keys(argType.members);
		for (let i = 0; i < pk.length; i++)
			unifyTypeParam(
				paramType.members[pk[i] ?? '']?.type,
				argType.members[ak[i] ?? '']?.type,
				names,
				out,
			);
	}
}

export const ScopeOwner = Symbol('ScopeOwner');
export const EmptyFunction: SymbolMap['function'] = {
	name: '__empty',
	kind: 'function',
	flags: Flags.None,
};

export function SymbolTable<T extends Symbol>(globals?: Record<string, T>, ignoreReferences = false) {
	const st = BaseSymbolTable<T>();

	if (globals) st.setSymbols(globals);

	const table = {
		...st,
		ignoreReferences,
		/** Retrieves a symbol by id and logs a reference at the specified node position. */
		getWithReference(id: string, node: Position) {
			const symbol = st.get(id);
			if (symbol && !table.ignoreReferences) {
				(symbol.references ||= []).push(node);
			}
			return symbol;
		},
	};

	return table;
}

function literal(value: number | boolean | undefined, type: SymbolMap['type']) {
	return { kind: 'literal', value, flags: 0, type } as const;
}

/**
 * Build a parameter symbol for stdlib declarations.
 */
function param(name: string, type: Type): SymbolMap['variable'] {
	return { kind: 'variable', name, flags: 0, type };
}

export const AnyData: SymbolMap['type'] = {
	name: '[]',
	kind: 'type',
	flags: 0,
	family: 'data',
	size: 4,
	members: {},
};

// `Buffer<T>` — the low-level, safe, runtime-length memory primitive that the
// stdlib `Array<T>` (and eventually `String`) is built on. A bare `Buffer`
// (this symbol) carries `Flags.Collection` for routing; applying it
// (`Buffer<Int32>`) yields a `bufferTypeOf` instance — a `data` type whose
// `elem` is the element type (see the `elem` field docs). Layout is
// `[len][cap][elem×cap]`, payload at offset 8. One shared shape so
// parser/checker/backend never disagree.
export const BufferType: SymbolMap['type'] = {
	name: 'Buffer',
	kind: 'type',
	flags: Flags.Collection,
	family: 'data',
	size: 4,
	members: {},
	typeParams: [
		{ name: 'T', kind: 'type', flags: 0, family: 'unknown', size: 4 },
	],
};

export function bufferTypeOf(elem: Type): SymbolMap['type'] {
	return {
		kind: 'type',
		flags: Flags.Collection,
		name: 'Buffer',
		family: 'data',
		size: 4,
		members: {},
		elem,
	};
}

export function isCollection(t: Type): boolean {
	return t.kind === 'type' && t.family === 'data' && t.elem !== undefined;
}

export function ProgramSymbolTable() {
	const typeParam = (): SymbolMap['type'] => ({
		kind: 'type',
		name: 'T',
		flags: 0,
		family: 'unknown',
		size: 4,
	});
	const getType = typeParam();
	const setType = typeParam();
	const capacityType = typeParam();
	const transferType = typeParam();
	return SymbolTable<Symbol>({
		true: literal(true, BaseTypes.Bool),
		false: literal(false, BaseTypes.Bool),
		nan: literal(NaN, BaseTypes.Float64),
		infinity: literal(Infinity, BaseTypes.Float64),
		void: literal(undefined, BaseTypes.Void),
		length: {
			kind: 'function',
			name: 'length',
			flags: Flags.Intrinsic,
			parameters: [param('s', BaseTypes.Unknown)],
			returnType: BaseTypes.Int32,
		},
		origin: OriginIntrinsic,
		frames: FramesIntrinsic,
		frameAt: FrameAtIntrinsic,
		stack: StackIntrinsic,
		get: {
			kind: 'function',
			name: 'get',
			flags: Flags.Intrinsic,
			typeParams: [getType],
			parameters: [
				param('b', bufferTypeOf(getType)),
				param('i', BaseTypes.Int32),
			],
			returnType: getType,
		},
		set: {
			kind: 'function',
			name: 'set',
			flags: Flags.Intrinsic,
			typeParams: [setType],
			parameters: [
				param('b', bufferTypeOf(setType)),
				param('i', BaseTypes.Int32),
				param('x', setType),
			],
			returnType: bufferTypeOf(setType),
		},
		capacity: {
			kind: 'function',
			name: 'capacity',
			flags: Flags.Intrinsic,
			typeParams: [capacityType],
			parameters: [param('b', bufferTypeOf(capacityType))],
			returnType: BaseTypes.Int32,
		},
		transfer: {
			kind: 'function',
			name: 'transfer',
			flags: Flags.Intrinsic,
			typeParams: [transferType],
			parameters: [
				param('source', bufferTypeOf(transferType)),
				param('destination', bufferTypeOf(transferType)),
			],
			returnType: bufferTypeOf(transferType),
		},
		out_buffer: {
			kind: 'function',
			name: 'out_buffer',
			flags: Flags.Intrinsic,
			parameters: [param('s', BaseTypes.String)],
			returnType: BaseTypes.Void,
		},
		// `@` is the external-module operator (`@module.name`). The standard
		// library is a global prelude (bare `out`/`each`/…), not under `@`.
		'@': {
			kind: 'data',
			flags: 0,
			members: {},
		},
	});
}

export const BaseTypes = {
	Int8: { name: 'Int8', kind: 'type', flags: 0, family: 'int', size: 1 },
	Int16: { name: 'Int16', kind: 'type', flags: 0, family: 'int', size: 2 },
	Int32: { name: 'Int32', kind: 'type', flags: 0, family: 'int', size: 4 },
	Int64: { name: 'Int64', kind: 'type', flags: 0, family: 'int', size: 8 },
	Uint8: { name: 'Uint8', kind: 'type', flags: 0, family: 'uint', size: 1 },
	Uint16: { name: 'Uint16', kind: 'type', flags: 0, family: 'uint', size: 2 },
	Uint32: { name: 'Uint32', kind: 'type', flags: 0, family: 'uint', size: 4 },
	Uint64: { name: 'Uint64', kind: 'type', flags: 0, family: 'uint', size: 8 },
	Float32: { name: 'Float32', kind: 'type', flags: 0, family: 'float', size: 4 },
	Float64: { name: 'Float64', kind: 'type', flags: 0, family: 'float', size: 8 },
	String: { name: 'String', kind: 'type', flags: 0, family: 'string', size: 4 },
	Char: { name: 'Char', kind: 'type', flags: 0, family: 'char', size: 4 },
	Bool: { name: 'Bool', kind: 'type', flags: 0, family: 'bool', size: 1 },
	Void: { name: 'Void', kind: 'type', flags: 0, family: 'void', size: 0 },
	Fn: { name: 'Fn', kind: 'type', flags: 0, family: 'fn', size: 4 },
	Unknown: { name: 'Unknown', kind: 'type', flags: 0, family: 'unknown', size: 0 },
	// The lazy trace handle — one hidden word (`__trace` is not a
	// scannable identifier, so user code can never name or collide with it).
	// `Error = Trace` composes it into every error as a prefix slot.
	Trace: {
		name: 'Trace',
		kind: 'type',
		flags: 0,
		family: 'data',
		size: 4,
		members: {
			__trace: { kind: 'variable', name: '__trace', flags: 0 },
		},
	},
} as const satisfies Record<string, SymbolMap['type']>;

export function TypesSymbolTable() {
	return SymbolTable<Type>({ ...BaseTypes, Buffer: BufferType });
}

/** `origin(e: Error): Frame` — the trace reader; Error/Frame types are
 * patched in at program init (they are stdlib types). */
export const OriginIntrinsic: SymbolMap['function'] = {
	kind: 'function',
	name: 'origin',
	flags: Flags.Intrinsic,
	parameters: [{ kind: 'variable', name: 'e', flags: 0 }],
};

/** `frames(e: Error): Int32` — trace chain length (1 outside debug builds). */
export const FramesIntrinsic: SymbolMap['function'] = {
	kind: 'function',
	name: 'frames',
	flags: Flags.Intrinsic,
	parameters: [{ kind: 'variable', name: 'e', flags: 0 }],
	returnType: BaseTypes.Int32,
};

/** `frameAt(e: Error, i: Int32): Frame` — 0 = origin, then innermost-first. */
export const FrameAtIntrinsic: SymbolMap['function'] = {
	kind: 'function',
	name: 'frameAt',
	flags: Flags.Intrinsic,
	parameters: [
		{ kind: 'variable', name: 'e', flags: 0 },
		{ kind: 'variable', name: 'i', flags: 0, type: BaseTypes.Int32 },
	],
};

/** `runtime.stack(e: Error): [Frame]` — the whole trace as a
 * runtime-length collection (a single origin frame outside debug builds).
 * Return type is wired at program init once `Frame` exists. */
export const StackIntrinsic: SymbolMap['function'] = {
	kind: 'function',
	name: 'stack',
	flags: Flags.Intrinsic,
	parameters: [{ kind: 'variable', name: 'e', flags: 0 }],
};
