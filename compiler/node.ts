import { MakeNodeMap } from '../sdk/index.js';

import type { Symbol, SymbolMap, Scope, Type } from './symbol-table.js';

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };

export enum BlockFlags {
	Default = 0,
	Lambda = 1,
	Sequence = 2,
}

export type BaseNodeMap = {
	root: { children: Node[] };
	main: { children: Node[]; statements: Node[]; scope: Scope };
	type: { children: [Node, Node]; symbol: Symbol };
	typeident: { symbol: Type };
	done: void;
	ident: { symbol: Symbol };
	string: void;
	number: { value: number };
	literal: { value: unknown; references?: Node[] };
	loop: { children: [Node] };
	next: {
		children?: [Node | undefined];
		generator?: boolean;
		owner: SymbolMap['function'];
	};
	comment: void;
	parameter: {
		children: [Node, Node | undefined];
		symbol: Symbol;
		name: Node;
		type?: Node;
	};
	macro: {
		children: [Node];
		name: Node;
	};
	def: {
		children: [NodeMap['ident'], Node] | [NodeMap['ident'], Node, Node];
		left: NodeMap['ident'];
		right: Node;
		type?: Node;
	};
	'@': void;
	'=': { children: [Node, Node] };
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	'++': { children: [Node] };
	'--': { children: [Node] };
	'-': { children: [Node] };
	fn: {
		parameters?: NodeMap['parameter'][];
		statements?: Node[];
		children: Node[];
		symbol: SymbolMap['function'];
		flags: BlockFlags;
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
>;
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type Node = NodeMap[keyof NodeMap];
export type NodeKind = keyof NodeMap;
export type InfixNode = Extract<Node, Infix>;
