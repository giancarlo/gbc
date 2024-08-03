///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/gbc.sdk';

import type { Node } from './node.js';
import type { Type } from './types.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
}

type BaseSymbol = {
	name: string;
	flags: Flags;
	type?: Type;
	definition?: Node;
	references?: Node[];
};
export type SymbolMap = {
	literal: {};
	namespace: { members: Record<string, Symbol> };
	function: {};
	parameter: {};
	variable: {};
	native: { replace: string };
};
export type Symbol = {
	[K in keyof SymbolMap]: BaseSymbol & { kind: K } & SymbolMap[K];
}[keyof SymbolMap];
export type Scope = Record<string, Symbol>;

export type SymbolTable = ReturnType<typeof SymbolTable>;

export const BooleanType = { name: 'boolean' };
export const FloatType = { name: 'float' };
export const ObjectType = { name: 'object' };
export const FunctionType = { name: 'function' };

export function SymbolTable() {
	const st = BaseSymbolTable<Symbol>();

	st.setSymbols(
		{ name: 'true', kind: 'literal', flags: 0, type: BooleanType },
		{ name: 'false', kind: 'literal', flags: 0, type: BooleanType },
		{ name: 'NaN', kind: 'literal', flags: 0, type: FloatType },
		{ name: 'infinity', kind: 'literal', flags: 0, type: FloatType },
		{
			name: 'std',
			kind: 'namespace',
			flags: 0,
			type: ObjectType,
			members: {
				out: {
					name: 'out',
					kind: 'native',
					replace: `function*($){console.log($);yield($)}`,
					type: FunctionType,
					flags: 0,
				},
			},
		},
	);

	return {
		...st,
		getRef(id: string, node: Node) {
			const symbol = st.get(id);
			if (symbol) {
				(symbol.references ||= []).push(node);
			}
			return symbol;
		},
	};
}
