///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/gbc.sdk';
import { IntegerType, StringType } from './checker.js';
import type { Node } from './node.js';

type BaseSymbol = {
	definition?: Node;
	references?: Node[];
};
type SymbolProp = {
	type: unknown;
	literal: unknown;
	namespace: { members: Record<string, Symbol> };
	function: unknown;
	parameter: unknown;
	variable: unknown;
	data: { members: Record<string, Symbol> };
	macro: { value: string };
};
export type SymbolMap = {
	[K in keyof SymbolProp]: BaseSymbol & { kind: K } & SymbolProp[K];
};
export type Symbol = SymbolMap[keyof SymbolProp];
export type Scope = Record<string | symbol, Symbol>;

export type SymbolTable = ReturnType<typeof SymbolTable>;

export const ScopeOwner = Symbol('ScopeOwner');

export function SymbolTable(globals?: Record<string, Symbol>) {
	const st = BaseSymbolTable<Symbol>();

	if (globals) st.setSymbols(globals);

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

function literal(value: unknown) {
	return { kind: 'literal', value } as const;
}

export function ProgramSymbolTable() {
	return SymbolTable({
		true: literal(true),
		false: literal(false),
		NaN: literal(NaN),
		infinity: literal(Infinity),
		std: {
			kind: 'namespace',
			members: {
				log: {
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

export function TypesSymbolTable() {
	return SymbolTable({
		int: literal(IntegerType),
		number: literal(Number),
		string: literal(StringType),
		true: literal(true),
		false: literal(false),
	});
}
