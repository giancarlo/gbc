import { SymbolTable as BaseSymbolTable, Position } from '../sdk/index.js';
import type { Node } from './node.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
	Sequence = 4,
	Lambda = 8,
}

type BaseSymbol = {
	name?: string;
	definition?: Node;
	references?: Position[];
	type?: Type;
	flags: Flags;
};
type SymbolProp = {
	type: { name: string };
	literal: unknown;
	function: { parameters?: Symbol[]; returnType?: Type };
	parameter: unknown;
	variable: { name: string };
	data: { members: Record<string, Symbol> };
	macro: { value: string };
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

export function ProgramSymbolTable() {
	return SymbolTable<Symbol>({
		true: literal(true, BaseTypes.boolean),
		false: literal(false, BaseTypes.boolean),
		NaN: literal(NaN, BaseTypes.float),
		infinity: literal(Infinity, BaseTypes.float),

		// Standard Library
		'@': {
			kind: 'data',
			flags: 0,
			members: {
				out: {
					flags: 0,
					kind: 'function',
				},
			},
		},
	});
}

export const BaseTypes = {
	boolean: { name: 'boolean', kind: 'type', flags: 0 },
	float: { name: 'float', kind: 'type', flags: 0 },
	int: { name: 'int', kind: 'type', flags: 0 },
	string: { name: 'string', kind: 'type', flags: 0 },
	void: { name: 'void', kind: 'type', flags: 0 },
	true: { name: 'true', kind: 'type', flags: 0 },
	false: { name: 'false', kind: 'type', flags: 0 },
	unknown: { name: 'unknown', kind: 'type', flags: 0 },
} as const;

export function TypesSymbolTable() {
	return SymbolTable<Type>(BaseTypes);
}
