///<amd-module name="@cxl/gbc.compiler/node.js"/>
import { MakeNodeMap } from '@cxl/gbc.sdk';

import type { Flags, Scope, Symbol } from './symbol-table.js';

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };

/* eslint @typescript-eslint/ban-types:off */
export type BaseNodeMap = {
	root: { children: Node[] };
	main: { children: Node[]; statements: Node[] };
	type: { children: [Node] };
	return: { children?: [Node] };
	var: {};
	done: {};
	ident: { symbol?: Symbol; flags?: Flags };
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
	data: { children: Node[] };
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
	| '<<'
	| '<:'
	| ':>'
	| '^'
>;
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type Node = NodeMap[keyof NodeMap];
export type NodeKind = keyof NodeMap;
