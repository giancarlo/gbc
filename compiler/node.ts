///<amd-module name="@cxl/gbc.compiler/node.js"/>
import { MakeNodeMap } from '@cxl/gbc.sdk';

import type { Scope, Symbol } from './symbol-table.js';

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };

/* eslint @typescript-eslint/ban-types:off */
export type BaseNodeMap = {
	root: { children: Node[] };
	main: { children: Node[]; statements: Node[]; scope: Scope };
	type: { children: [Node] };
	var: { ident: NodeMap['ident'] };
	done: {};
	ident: { symbol?: Symbol };
	string: {};
	number: { value: number };
	loop: { children: Node[] };
	next: { children: [Node | undefined] };
	comment: {};
	$: {};
	parameter: {
		children: [Node, Node | undefined] | [undefined, Node];
		symbol?: Symbol;
	};
	macro: { value: string };
	def: { children: [Node, Node] };
	propdef: { children: [Node, Node] };
	'=': { children: [Node, Node] };
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	'++': { children: [Node] };
	'--': { children: [Node] };
	'-': { children: [Node] };
	'{': {
		parameters: NodeMap['parameter'][] | undefined;
		statements: Node[];
		scope: Scope;
		children: Node[];
	};
	'[': { children: [Node, Node] };
	'(': { children: [Node] };
	':': { children: [Node, Node] };
	call: { children: [Node, Node | undefined] };
	data: { children: Node[]; scope: Scope };
	'.': { children: [Node, Node]; symbol?: Symbol };
	',': { children: Node[] };
} & MakeInfix<
	| '>>'
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
