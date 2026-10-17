import type { MakeNodeMap } from '@cxl/gbc.sdk';
import type { Symbol } from '@cxl/gbc.sdk';

export { analyze } from './analyze.js';
export type { Analysis, BasicSymbol, Scope, BasicType } from './analyze.js';

export interface TypeAnnotation {
	name: string;
	length?: number;
	symbol?: Symbol<Node>;
}

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };
type MakeArguments<T extends string> = {
	[K in T]: { children: NodeMap['argument'][] };
};

export type BaseNodeMap = {
	root: { children: Node[] };
	block: { children: Node[] };
	number: { value: number; text: string };
	string: { value: string };
	ident: { name: string; symbol?: Symbol<Node> };
	group: { children: [Node] };
	positive: { children: [Node] };
	negate: { children: [Node] };
	not: { children: [Node] };
	call: { children: [Node, ...NodeMap['argument'][]] };
	member: { children: [Node, NodeMap['ident']] };
	tuple: { children: Node[] };
	range: { children: [Node | undefined, Node | undefined] };
	argument: {
		children: [Node | undefined];
		separator: ',' | ';' | undefined;
	};
	expression: { children: [Node] };
	assign: { children: [Node, Node] };
	if: { children: NodeMap['branch'][] };
	branch: { children: [Node | undefined, NodeMap['block']] };
	for: {
		children: [
			Node,
			Node,
			Node,
			Node | undefined,
			NodeMap['block'],
		];
	};
	next: { children: NodeMap['ident'][] };
	do: {
		children: [Node | undefined, NodeMap['block'], Node | undefined];
		precondition: 'while' | 'until' | undefined;
		postcondition: 'while' | 'until' | undefined;
	};
	select: { children: [Node, ...NodeMap['case'][]] };
	case: {
		children: [...Node[], NodeMap['block']];
		testCount: number;
		isElse: boolean;
	};
	caseis: {
		children: [Node];
		operator: ComparisonOperator;
	};
	caserange: { children: [Node, Node] };
	label: { name: string; symbol?: Symbol<Node> };
	goto: { children: [NodeMap['ident']] };
	gosub: { children: [NodeMap['ident']] };
	return: { children: [NodeMap['ident'] | undefined] };
	exit: { target: 'do' | 'for' | 'function' | 'sub' };
	data: { children: Node[] };
	defaulttype: { name: string; ranges: [string, string][] };
	variable: {
		annotation?: TypeAnnotation;
		children: Node[];
		name: string;
		dimensionCount: number;
		array?: boolean;
		sharedOnly?: boolean;
		shared: boolean;
		static: boolean;
		redim: boolean;
		symbol?: Symbol<Node>;
	};
	constant: {
		children: [Node];
		name: string;
		symbol?: Symbol<Node>;
	};
	parameter: {
		annotation?: TypeAnnotation;
		name: string;
		array: boolean;
		symbol?: Symbol<Node>;
	};
	declare: {
		annotation?: TypeAnnotation;
		children: NodeMap['parameter'][];
		procedureKind: 'sub' | 'function';
		name: string;
		symbol?: Symbol<Node>;
	};
	procedure: {
		annotation?: TypeAnnotation;
		children: [...NodeMap['parameter'][], Node];
		procedureKind: 'sub' | 'function';
		name: string;
		parameterCount: number;
		expression: boolean;
		symbol?: Symbol<Node>;
	};
	type: {
		children: NodeMap['field'][];
		name: string;
		symbol?: Symbol<Node>;
	};
	field: {
		annotation?: TypeAnnotation;
		name: string;
		symbol?: Symbol<Node>;
	};
	onerror: {
		children: [NodeMap['ident'] | undefined];
		resumeNext: boolean;
	};
	resume: {
		children: [NodeMap['ident'] | undefined];
		next: boolean;
	};
} &
	MakeInfix<
		| '^'
		| '*'
		| '/'
		| '\\'
		| 'mod'
		| '+'
		| '-'
		| '='
		| '<>'
		| '<'
		| '<='
		| '>'
		| '>='
		| 'and'
		| 'or'
		| 'xor'
		| 'eqv'
		| 'imp'
	> &
	MakeArguments<
		| 'callstmt'
		| 'print'
		| 'input'
		| 'lineinput'
		| 'read'
		| 'restore'
		| 'randomize'
		| 'screen'
		| 'color'
		| 'locate'
		| 'cls'
		| 'pset'
		| 'preset'
		| 'line'
		| 'circle'
		| 'paint'
		| 'get'
		| 'put'
		| 'draw'
		| 'play'
		| 'sound'
		| 'beep'
		| 'out'
		| 'poke'
		| 'open'
		| 'close'
		| 'write'
		| 'width'
		| 'view'
		| 'window'
		| 'defseg'
		| 'bload'
		| 'bsave'
		| 'clear'
		| 'common'
		| 'end'
		| 'erase'
		| 'error'
		| 'let'
		| 'lock'
		| 'lprint'
		| 'lset'
		| 'option'
		| 'palette'
		| 'pcopy'
		| 'reset'
		| 'rset'
		| 'run'
		| 'seek'
		| 'shell'
		| 'sleep'
		| 'stop'
		| 'swap'
		| 'system'
		| 'unlock'
		| 'wait'
	>;

export type NodeMap = MakeNodeMap<{
	[K in keyof BaseNodeMap]: BaseNodeMap[K] & {
		scopeId?: number;
		resolved?: import('./analyze.js').BasicSymbol;
		dataOffset?: number;
	};
}>;
export type Node = NodeMap[keyof NodeMap];
export type NodeKind = keyof NodeMap;
export type InfixNode = Extract<Node, Infix>;
export type ComparisonOperator = '=' | '<>' | '<' | '<=' | '>' | '>=';
