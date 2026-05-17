import { SymbolTable as BaseSymbolTable, Position } from '../sdk/index.js';
import type { Node } from './node.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
	Sequence = 4,
	Lambda = 8,
	External = 16,
}

type BaseSymbol = {
	name?: string;
	definition?: Node;
	references?: Position[];
	type?: Type;
	flags: Flags;
};
export type TypeFamily =
	| 'int'
	| 'uint'
	| 'float'
	| 'bool'
	| 'string'
	| 'void'
	| 'fn'
	| 'error'
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
	function: { parameters?: Symbol[]; returnType?: Type };
	parameter: unknown;
	variable: { name: string };
	data: { members: Record<string, Symbol> };
};
export type SymbolMap = {
	[K in keyof SymbolProp]: BaseSymbol & { kind: K } & SymbolProp[K];
};
export type Symbol = SymbolMap[keyof SymbolProp];
export type Scope = Record<string | symbol, Symbol>;

export type SymbolTable = ReturnType<typeof ProgramSymbolTable>;
export type TypesSymbolTable = ReturnType<typeof TypesSymbolTable>;
export type Type = SymbolMap['type' | 'function'];

export const ScopeOwner = Symbol('ScopeOwner');
export const EmptyFunction: SymbolMap['function'] = {
	name: '__empty',
	kind: 'function',
	flags: Flags.None,
};

export function SymbolTable<T extends Symbol>(globals?: Record<string, T>) {
	const st = BaseSymbolTable<T>();

	if (globals) st.setSymbols(globals);

	return {
		...st,
		/** Retrieves a symbol by id and logs a reference at the specified node position. */
		getWithReference(id: string, node: Position) {
			const symbol = st.get(id);
			if (symbol) {
				(symbol.references ||= []).push(node);
			}
			return symbol;
		},
	};
}

function literal(value: unknown, type: SymbolMap['type']) {
	return { kind: 'literal', value, flags: 0, type } as const;
}

/**
 * Build a parameter symbol for stdlib declarations.
 */
function param(name: string, type: Type): SymbolMap['variable'] {
	return { kind: 'variable', name, flags: 0, type };
}

export function ProgramSymbolTable() {
	return SymbolTable<Symbol>({
		true: literal(true, BaseTypes.Bool),
		false: literal(false, BaseTypes.Bool),
		nan: literal(NaN, BaseTypes.Float64),
		infinity: literal(Infinity, BaseTypes.Float64),

		'@': {
			kind: 'data',
			flags: 0,
			members: {
				out: {
					name: 'out',
					flags: Flags.External,
					kind: 'function',
					parameters: [param('s', BaseTypes.String)],
					returnType: BaseTypes.Void,
				},
				each: {
					name: 'each',
					flags: 0,
					kind: 'function',
				},
			},
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
	Bool: { name: 'Bool', kind: 'type', flags: 0, family: 'bool', size: 1 },
	Void: { name: 'Void', kind: 'type', flags: 0, family: 'void', size: 0 },
	Fn: { name: 'Fn', kind: 'type', flags: 0, family: 'fn', size: 4 },
	Error: { name: 'Error', kind: 'type', flags: 0, family: 'error', size: 4 },
	Unknown: { name: 'Unknown', kind: 'type', flags: 0, family: 'unknown', size: 0 },
} as const satisfies Record<string, SymbolMap['type']>;

export function TypesSymbolTable() {
	return SymbolTable<Type>(BaseTypes);
}
