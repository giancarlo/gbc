///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/compiler/parser.js';

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
	[K in keyof SymbolMap]: BaseSymbol & { type: K } & SymbolMap[K];
}[keyof SymbolMap];

export type SymbolTable = ReturnType<typeof SymbolTable>;
export function SymbolTable() {
	const st = BaseSymbolTable<Symbol>();
	st.setSymbols(
		{ name: 'true', type: 'literal' },
		{ name: 'false', type: 'literal' },
		{ name: 'loop', type: 'function' },
	);
	st.setSymbols({
		name: 'std',
		type: 'namespace',
		members: {
			out: { name: 'out', type: 'native', replace: 'console.log' },
		},
	});
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
