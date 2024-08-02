///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/gbc.sdk';

import type { Node } from './node.js';

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
}

type BaseSymbol = {
	name: string;
	flags: Flags;
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
export function SymbolTable() {
	const st = BaseSymbolTable<Symbol>();
	st.setSymbols(
		{ name: 'true', kind: 'literal', flags: 0 },
		{ name: 'false', kind: 'literal', flags: 0 },
		{ name: 'NaN', kind: 'literal', flags: 0 },
		{ name: 'infinity', kind: 'literal', flags: 0 },
		{
			name: 'std',
			kind: 'namespace',
			flags: 0,
			members: {
				out: {
					name: 'out',
					kind: 'native',
					//replace: '(($,next)=>{console.log($);next?.($)})',
					replace: `function*($){console.log($);yield($)}`,
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
