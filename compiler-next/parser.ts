///<amd-module name="@cxl/gbc.compiler/parser.js"/>
import { MakeNodeMap } from '@cxl/compiler/parser-table.js';
import { ParserApi, text } from '@cxl/compiler';

import { parseExpression } from './parser-expression.js';

import type { ScannerToken } from './scanner.js';
import type { Symbol, SymbolTable } from './symbol-table.js';

export enum Flags {
	Variable = 1,
	Export = 2,
}

type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };
type Scope = SymbolTable['globalScope'];

/* eslint @typescript-eslint/ban-types:off */
export type BaseNodeMap = {
	root: { children: Node[] };
	main: { children: Node[]; statements: Node[] };
	type: { children: [Node] };
	var: {};
	done: {};
	ident: { symbol?: Symbol };
	string: {};
	number: {};
	next: {};
	comment: {};
	$: {};
	parameter: {
		children: [Node, Node | undefined] | [undefined, Node];
		symbol?: Symbol;
	};
	macro: { value: string };
	def: { children: [Node, Node]; flags: Flags };
	'=': { children: [Node, Node] };
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	'-': { children: [Node] };
	'{': {
		parameters: NodeMap['parameter'][] | undefined;
		statements: Node[];
		scope: Scope;
		children: Node[];
	};
	'(': { children: [Node] };
	':': { children: [Node, Node] };
	call: { children: [Node, Node | undefined] };
	'.': { children: [Node, Node]; symbol?: Symbol };
} & MakeInfix<
	| '>>'
	| ','
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
>;
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type Node = NodeMap[keyof NodeMap];

export function parse(api: ParserApi<ScannerToken>, symbolTable: SymbolTable) {
	const {
		current,
		expect,
		expectNode,
		expectNodeKind,
		optional,
		node,
		parseUntilKind,
		next,
	} = api;
	const expression = parseExpression(api, symbolTable);

	function definition() {
		const isExport = optional('export');
		const isVar = optional('var');
		const ident = expect('ident');
		expect('=');
		const name = text(ident);
		const symbol = symbolTable.set(name, { name, type: 'variable' });
		const expr = expectNode(expression(), 'Expected assignment expression');
		return (symbol.definition = {
			kind: 'def',
			children: [ident, expr],
			flags: (isVar ? Flags.Variable : 0) | (isExport ? Flags.Export : 0),
			start: (isExport || isVar || ident).start,
			line: (isExport || isVar || ident).line,
			end: expr.end,
			source: ident.source,
		} as NodeMap['def']);
	}

	function topStatement() {
		const token = current();
		if (token.kind === 'main') {
			next();
			const child = expectNode(
				statement(),
				'Expected statement or expression',
			);
			const children = child.kind === '{' ? child.children : [child];
			return {
				...token,
				children,
				end: child.end,
				statements: children,
			};
		}

		return definition();
	}

	function statement() {
		const token = current();
		if (token.kind === 'var') {
			next();
			const eq = expectNodeKind(expression(), '=', 'Expected assignment');
			return {
				...eq,
				kind: 'def',
				flags: Flags.Variable,
				start: token.start,
			} as NodeMap['def'];
		}

		return expression();
	}

	const root = {
		...node('root'),
		children: parseUntilKind(topStatement, 'eof'),
	};
	return root;
}
