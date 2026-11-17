import {
	astChildNodes,
	type AstNode,
	type AstNodeMap,
	type AstShapeMap,
	type InfixNode as SdkInfixNode,
} from '@cxl/gbc.sdk';

import type {
	ResolvedType,
	Scope,
	Symbol,
	SymbolMap,
	TypeSymbol,
} from './symbol-table.js';

export interface CompilerAstContext {
	symbol: Symbol;
	typeSymbol: TypeSymbol;
	variable: SymbolMap['variable'];
	function: SymbolMap['function'];
	scope: Scope;
	resolvedType: ResolvedType;
}

export type BaseNodeMap = AstShapeMap<CompilerAstContext>;
export type NodeMap = AstNodeMap<CompilerAstContext>;
export type Node = AstNode<CompilerAstContext>;
export type NodeKind = keyof NodeMap;
export type InfixNode = SdkInfixNode<NodeMap>;

export const childNodes = astChildNodes<CompilerAstContext>;
export { syntheticNext } from '@cxl/gbc.sdk';
