import { MakeNodeMap, Token } from '../sdk/index.js';

import type { Symbol, SymbolMap, Scope, Type } from './symbol-table.js';

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };

export type BaseNodeMap = {
	root: { children: Node[] };
	main: { children: Node[]; statements: Node[]; scope: Scope };
	type: { children: [Node, Node]; symbol: Symbol };
	typeident: { symbol: Type };
	done: object;
	break: object;
	ident: { symbol: Symbol };
	string: object;
	number: { value: number };
	literal: { value: unknown; references?: Node[] };
	loop: object;
	next: {
		children?: [Node | undefined];
		owner: SymbolMap['function'];
	};
	comment: object;
	parameter: {
		children: [Token<'ident'> | undefined, Node | undefined, Node | undefined];
		label?: Token<'ident'>;
		symbol: SymbolMap['variable'];
		type?: Node;
		value?: Node;
	};
	propdef: {
		children: [
			Token<'ident'> | undefined,
			Node | undefined,
			Node | undefined,
		];
		label?: Token<'ident'>;
		symbol: SymbolMap['variable'];
		type?: Node;
		value?: Node;
	};
	def: {
		children: [Token<'ident'>, Node | undefined, Node];
		label: Token<'ident'>;
		symbol: SymbolMap['variable'];
		value: Node;
		type?: Node;
	};
	external: {
		children: [Token<'ident'>, Node];
		label: Token<'ident'>;
		symbol: SymbolMap['function'];
		type: Node;
	};
	'@': object;
	'=': { children: [Node, Node] };
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	$: object;
	negate: { children: [Node] };
	fn: {
		parameters?: NodeMap['parameter'][];
		statements?: Node[];
		children: Node[];
		symbol: SymbolMap['function'];
		returnType?: Node;
	};
	'[': { children: [Node, Node] };
	'(': { children: [Node] };
	':': { children: [Node, Node] };
	call: { children: [Node, Node | undefined] };
	data: {
		children: Node[];
	};
	'.': { children: [Node, Node] };
	',': { children: Node[] };
	'>>': { children: Node[] };
} & MakeInfix<
	| '||'
	| '&&'
	| '+'
	| '-'
	| '*'
	| '/'
	| '|'
	| '&'
	| '=='
	| '!='
	| '<'
	| '>'
	| '<='
	| '>='
	| '<:'
	| ':>'
	| '^'
	| 'is'
>;
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type Node = NodeMap[keyof NodeMap];
export type NodeKind = keyof NodeMap;
export type InfixNode = Extract<Node, Infix>;
