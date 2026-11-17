import type {
	BinaryNodeShape,
	CallNodeShape,
	DefinitionNodeShape,
	ExternalNodeShape,
	FunctionNodeShape,
	NextNodeShape,
	ParameterNodeShape,
	ScopedBlockNodeShape,
	ConditionalNodeShape,
	IdentifierNodeShape,
	LiteralNodeShape,
	MakeNodeMap,
	NumberNodeShape,
	RootNodeShape,
	StringNodeShape,
	UnaryNodeShape,
} from '@cxl/gbc.sdk';

import type {
	OwnershipMode,
	ResolvedType,
	Symbol,
	SymbolMap,
	Scope,
	TypeSymbol,
} from './symbol-table.js';

interface NodeTypes {
	node: Node;
	label: NodeMap['label'];
	parameter: NodeMap['parameter'];
}

type Infix = BinaryNodeShape<NodeTypes>;
type MakeInfix<T extends string> = { [K in T]: Infix };

export type BaseNodeMap = {
	root: RootNodeShape<NodeTypes>;
	main: ScopedBlockNodeShape<NodeTypes, Scope>;
	test: ScopedBlockNodeShape<NodeTypes, Scope>;
	type: {
		children: [Node, Node] | [Node, Node, Node];
		typeParameters?: NodeMap['parameter'][];
		symbol: Symbol;
	};
	typeident: { symbol: TypeSymbol };
	done: object;
	break: object;
	ident: IdentifierNodeShape<Symbol>;
	label: object;
	string: StringNodeShape;
	number: NumberNodeShape;
	literal: LiteralNodeShape<NodeTypes>;
	interp: { children: Node[]; strings: string[] };
	extend: { children: [NodeMap['ident'], NodeMap['fn']] };
	/** A module import statement (destructure or `#importmap` entry) — all
	 * binding happened at parse time; inert for the checker and codegen. */
	import: { children: Node[] };
	loop: object;
	next: NextNodeShape<NodeTypes, SymbolMap['function']>;
	comment: object;
	parameter: ParameterNodeShape<NodeTypes, SymbolMap['variable']>;
	propdef: ParameterNodeShape<NodeTypes, SymbolMap['variable']>;
	def: DefinitionNodeShape<NodeTypes, SymbolMap['variable']>;
	external: ExternalNodeShape<NodeTypes, SymbolMap['function']>;
	'@': object;
	'=': BinaryNodeShape<NodeTypes>;
	'??': BinaryNodeShape<NodeTypes>;
	'?': ConditionalNodeShape<NodeTypes>;
	'~': UnaryNodeShape<NodeTypes>;
	'!': UnaryNodeShape<NodeTypes>;
	'+': UnaryNodeShape<NodeTypes>;
	$: object;
	negate: UnaryNodeShape<NodeTypes>;
	fn: FunctionNodeShape<NodeTypes, SymbolMap['function']> & {
		objectBacked?: true;
		returnOwnership?: OwnershipMode;
		returnOwnerships?: OwnershipMode[];
		returnRestOwnership?: OwnershipMode;
		returnVariantOwnerships?: OwnershipMode[][];
	};
	'[': BinaryNodeShape<NodeTypes>;
	'(': UnaryNodeShape<NodeTypes>;
	':': BinaryNodeShape<NodeTypes>;
	call: CallNodeShape<NodeTypes> & {
		/** Fn an inlined error-ctor call belongs to (trace attribution). */
		originFn?: string;
	};
	data: {
		children: Node[];
		/** Error-composed target this literal constructs — codegen lays out
		 * and fills the hidden `__trace` slot. */
		nominal?: ResolvedType;
		/** Fn the construction belongs to (survives template inlining). */
		originFn?: string;
	};
	'.': BinaryNodeShape<NodeTypes>;
	',': { children: Node[] };
	'>>': { children: Node[] };
	'->': { children: [Node, ...NodeMap['call'][]] };
} & MakeInfix<
	| '||'
	| '&&'
	| '+'
	| '-'
	| '*'
	| '/'
	| '%'
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

export function childNodes(node: Node): readonly (Node | undefined)[] {
	switch (node.kind) {
		case 'typeident':
		case 'done':
		case 'break':
		case 'ident':
		case 'label':
		case 'string':
		case 'number':
		case 'literal':
		case 'loop':
		case 'comment':
		case '@':
		case '$':
			return [];
		case 'next':
			return node.children ?? [];
		default:
			return node.children;
	}
}

export function syntheticNext(
	value: Node,
	owner: SymbolMap['function'],
): NodeMap['next'] {
	return {
		...value,
		kind: 'next',
		owner,
		implicit: true,
		children: [value],
	};
}
