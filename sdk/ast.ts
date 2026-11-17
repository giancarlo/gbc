import type { BinaryNodeBase, RootNodeBase, UnaryNodeBase } from './index.js';

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

