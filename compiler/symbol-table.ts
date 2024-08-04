///<amd-module name="@cxl/gbc.compiler/symbol-table.js"/>
import { SymbolTable as BaseSymbolTable } from '@cxl/gbc.sdk';
import {
	BooleanType,
	FloatType,
	ObjectType,
	FunctionType,
	IntegerType,
	StringType,
	Type,
} from './checker.js';
import type { Node } from './node.js';

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
	type: {};
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

export function SymbolTable(globals?: Symbol[]) {
	const st = BaseSymbolTable<Symbol>();

	if (globals) st.setSymbols(...globals);

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

export function ProgramSymbolTable() {
	return SymbolTable([
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
	]);
}

export function TypesSymbolTable() {
	return SymbolTable([
		{ name: 'int', kind: 'type', flags: 0, type: IntegerType },
		{ name: 'string', kind: 'type', flags: 0, type: StringType },
		{ name: 'true', kind: 'literal', flags: 0, type: BooleanType },
		{ name: 'false', kind: 'literal', flags: 0, type: BooleanType },
	]);
}
