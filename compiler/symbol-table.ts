///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/gbc.sdk';

import type { Node } from './parser.js';

type BaseSymbol = {
	name: string;
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
		{ name: 'true', kind: 'literal' },
		{ name: 'false', kind: 'literal' },
		{ name: 'loop', kind: 'function' },
		{
			name: 'std',
			kind: 'namespace',
			members: {
				out: { name: 'out', kind: 'native', replace: 'console.log' },
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
