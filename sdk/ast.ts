import type {
	BinaryNodeBase,
	MakeNodeMap,
	RootNodeBase,
	Token,
	UnaryNodeBase,
} from './index.js';

export interface RootNodeShape<Nodes extends { node: unknown }> {
	children: RootNodeBase<Nodes['node']>['children'];
}

export interface BinaryNodeShape<Nodes extends { node: unknown }> {
	children: BinaryNodeBase<Nodes['node']>['children'];
}

export interface UnaryNodeShape<Nodes extends { node: unknown }> {
	children: UnaryNodeBase<Nodes['node']>['children'];
}

export interface IdentifierNodeShape<ResolvedSymbol> {
	symbol: ResolvedSymbol;
}

export interface NumberNodeShape {
	value: number | bigint;
	float?: boolean;
}

export interface StringNodeShape {
	value?: string;
}

export interface LiteralNodeShape<Nodes extends { node: unknown }> {
	value: unknown;
	references?: Nodes['node'][];
}

export interface ConditionalNodeShape<Nodes extends { node: unknown }> {
	children: [Nodes['node'], Nodes['node'], (Nodes['node'] | undefined)?];
}

export interface CallNodeShape<Nodes extends { node: unknown }> {
	children: [Nodes['node'], Nodes['node'] | undefined];
}

export interface ScopedBlockNodeShape<Nodes extends { node: unknown }, Scope> extends RootNodeShape<Nodes> {
	statements: Nodes['node'][];
	scope: Scope;
}

export interface ParameterNodeShape<Nodes extends { node: unknown; label: unknown }, Variable> {
	children: [Nodes['label'] | undefined, Nodes['node'] | undefined, Nodes['node'] | undefined];
	label?: Nodes['label'];
	symbol: Variable;
	type?: Nodes['node'];
	value?: Nodes['node'];
}

export interface DefinitionNodeShape<Nodes extends { node: unknown; label: unknown }, Variable> {
	children: [Nodes['label'], Nodes['node'] | undefined, Nodes['node']];
	label: Nodes['label'];
	symbol: Variable;
	value: Nodes['node'];
	type?: Nodes['node'];
}

export interface ExternalNodeShape<Nodes extends { node: unknown; label: unknown }, Function> {
	children: [Nodes['label'], Nodes['node']];
	label: Nodes['label'];
	symbol: Function;
	type: Nodes['node'];
}

export interface FunctionNodeShape<Nodes extends { node: unknown; parameter: unknown }, Function> extends RootNodeShape<Nodes> {
	parameters?: Nodes['parameter'][];
	typeParameters?: Nodes['parameter'][];
	statements?: Nodes['node'][];
	symbol: Function;
	returnType?: Nodes['node'];
	returnTypes?: Nodes['node'][];
	returnRestType?: Nodes['node'];
	returnVariants?: Nodes['node'][][];
}

export interface NextNodeShape<Nodes extends { node: unknown }, Function> {
	children?: [Nodes['node'] | undefined];
	owner: Function;
	implicit?: true;
}

export interface AstContext {
	symbol: unknown;
	typeSymbol: unknown;
	variable: unknown;
	function: unknown;
	scope: unknown;
	resolvedType: unknown;
}

interface AstReferences<Context extends AstContext> {
	node: AstNode<Context>;
	label: AstNodeMap<Context>['label'];
	parameter: AstNodeMap<Context>['parameter'];
}

export type OwnershipMode = 'borrow' | 'var' | 'own';

export type AstShapeMap<Context extends AstContext> = {
	root: RootNodeShape<AstReferences<Context>>;
	main: ScopedBlockNodeShape<AstReferences<Context>, Context['scope']>;
	test: ScopedBlockNodeShape<AstReferences<Context>, Context['scope']>;
	type: {
		children:
			| [AstNode<Context>, AstNode<Context>]
			| [AstNode<Context>, AstNode<Context>, AstNode<Context>];
		typeParameters?: AstNodeMap<Context>['parameter'][];
		symbol: Context['symbol'];
	};
	typeident: { symbol: Context['typeSymbol'] };
	done: object;
	break: object;
	ident: IdentifierNodeShape<Context['symbol']>;
	label: object;
	string: StringNodeShape;
	number: NumberNodeShape;
	literal: LiteralNodeShape<AstReferences<Context>>;
	interp: { children: AstNode<Context>[]; strings: string[] };
	extend: { children: [AstNodeMap<Context>['ident'], AstNodeMap<Context>['fn']] };
	/** A module import statement (destructure or `#importmap` entry) — all
	 * binding happened at parse time; inert for the checker and codegen. */
	import: { children: AstNode<Context>[] };
	loop: object;
	next: NextNodeShape<AstReferences<Context>, Context['function']>;
	comment: object;
	parameter: ParameterNodeShape<AstReferences<Context>, Context['variable']>;
	propdef: ParameterNodeShape<AstReferences<Context>, Context['variable']>;
	def: DefinitionNodeShape<AstReferences<Context>, Context['variable']>;
	external: ExternalNodeShape<AstReferences<Context>, Context['function']>;
	'@': object;
	'=': BinaryNodeShape<AstReferences<Context>>;
	'??': BinaryNodeShape<AstReferences<Context>>;
	'?': ConditionalNodeShape<AstReferences<Context>>;
	'~': UnaryNodeShape<AstReferences<Context>>;
	'!': UnaryNodeShape<AstReferences<Context>>;
	$: object;
	negate: UnaryNodeShape<AstReferences<Context>>;
	fn: FunctionNodeShape<AstReferences<Context>, Context['function']> & {
		objectBacked?: true;
		returnOwnership?: OwnershipMode;
		returnOwnerships?: OwnershipMode[];
		returnRestOwnership?: OwnershipMode;
		returnVariantOwnerships?: OwnershipMode[][];
	};
	'[': BinaryNodeShape<AstReferences<Context>>;
	'(': UnaryNodeShape<AstReferences<Context>>;
	':': BinaryNodeShape<AstReferences<Context>>;
	call: CallNodeShape<AstReferences<Context>> & {
		/** Fn an inlined error-ctor call belongs to (trace attribution). */
		originFn?: string;
	};
	data: {
		children: AstNode<Context>[];
		/** Error-composed target this literal constructs — codegen lays out
		 * and fills the hidden `__trace` slot. */
		nominal?: Context['resolvedType'];
		/** Fn the construction belongs to (survives template inlining). */
		originFn?: string;
	};
	'.': BinaryNodeShape<AstReferences<Context>>;
	',': { children: AstNode<Context>[] };
	'>>': { children: AstNode<Context>[] };
	'->': { children: [AstNode<Context>, ...AstNodeMap<Context>['call'][]] };
} & Record<
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
	| '^',
	BinaryNodeShape<AstReferences<Context>>
>;

export type AstNodeMap<Context extends AstContext = AstContext> =
	MakeNodeMap<AstShapeMap<Context>>;
export type AstNode<Context extends AstContext = AstContext> =
	AstNodeMap<Context>[keyof AstNodeMap<Context>];

export function astChildNodes<Context extends AstContext>(
	node: AstNode<Context>,
): readonly (AstNode<Context> | undefined)[] {
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

export function syntheticNext<Node extends Token<string>, Function>(
	value: Node,
	owner: Function,
): Token<'next'> & NextNodeShape<{ node: Node }, Function> {
	return {
		...value,
		kind: 'next',
		owner,
		implicit: true,
		children: [value],
	};
}

export type ScalarType =
	| { kind: 'type'; family: 'int' | 'uint'; size: 1 | 2 | 4 | 8 }
	| { kind: 'type'; family: 'float'; size: 4 | 8 }
	| { kind: 'type'; family: 'bool'; size: 1 };

export interface NumericOperationFacts<Type> {
	valueType: Type;
	floatType: Type | undefined;
	wide: boolean;
	unsigned: boolean;
	resultType: Type;
	errors: readonly Type[];
	zeroError: Type | undefined;
	overflowError: Type | undefined;
	signedMinimum: bigint;
}

