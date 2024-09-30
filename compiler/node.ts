///<amd-module name="@cxl/gbc.compiler/node.js"/>
import { MakeNodeMap } from '@cxl/gbc.sdk';

import type { Scope, Symbol } from './symbol-table.js';

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
	type: { children: [Node] };
	var: { ident: NodeMap['ident'] };
	done: void;
	ident: { symbol: Symbol };
	string: void;
	number: { value: number };
	loop: { children: [Node] };
	next: { children: [Node | undefined] };
	comment: void;
	$: void;
	parameter: {
		children: [Node, Node | undefined] | [undefined, Node];
		symbol?: Symbol;
	};
	macro: { value: string };
	def: {
		children: [NodeMap['ident'], Node] | [NodeMap['ident'], Node, Node];
		left: NodeMap['ident'];
		right: Node;
		type?: Node;
	};
	'=': { children: [Node, Node] };
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	'++': { children: [Node] };
	'--': { children: [Node] };
	'-': { children: [Node] };
	'{': {
		parameters?: NodeMap['parameter'][];
		statements: Node[];
		scope: Scope;
		children: Node[];
		flags: BlockFlags;
	};
	'[': { children: [Node, Node] };
	'(': { children: [Node] };
	':': { children: [Node, Node] };
	call: { children: [Node, Node | undefined] };
	data: { children: Node[]; scope: Scope };
	'.': { children: [Node, Node]; symbol?: Symbol };
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
