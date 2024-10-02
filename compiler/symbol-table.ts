///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable, Position } from '@cxl/gbc.sdk';
import type { Node } from './node.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
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

export function SymbolTable<T extends Symbol>(globals?: Record<string, T>) {
	const st = BaseSymbolTable<T>();

	if (globals) st.setSymbols(globals);

	return {
		...st,
		getRef(id: string, node: Position) {
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
		std: {
			kind: 'data',
			flags: 0,
			members: {
				out: {
					flags: 0,
					kind: 'macro',
					value: `function*($){console.log($);yield($)}`,
				},
			},
		},
	});

	/*{
			name: 'std',
			kind: 'namespace',
			flags: 0,
			type: { name: 'std' },
			members: {
				out: {
					name: 'out',
					kind: 'native',
					replace: `function*($){console.log($);yield($)}`,
					type: { name: 'out' },
					flags: 0,
				},
			},
		},
	]);*/
}

export const BaseTypes: Record<string, SymbolMap['type']> = {
	boolean: { name: 'boolean', kind: 'type', flags: 0 },
	float: { name: 'float', kind: 'type', flags: 0 },
	int: { name: 'int', kind: 'type', flags: 0 },
	string: { name: 'string', kind: 'type', flags: 0 },
	void: { name: 'void', kind: 'type', flags: 0 },
	true: { name: 'true', kind: 'type', flags: 0 },
	false: { name: 'false', kind: 'type', flags: 0 },
};

export function TypesSymbolTable() {
	return SymbolTable<Type>(BaseTypes);
}
