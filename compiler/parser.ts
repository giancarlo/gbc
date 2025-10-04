import { ParserApi, Token, text } from '../sdk/index.js';

import { parseExpression } from './parser-expression.js';
import { parseType } from './parser-type.js';
import { Flags, SymbolTable, TypesSymbolTable } from './symbol-table.js';

import type { ScannerToken } from './scanner.js';
import type { Node, NodeMap } from './node.js';

export type RootNode = ReturnType<typeof parse>;

export function parse(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: TypesSymbolTable,
) {
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
	const typeParser = parseType(api, typesTable);
	const expression = parseExpression(api, symbolTable, typeParser);

	function markExported(n: Node) {
		if (n.kind === 'ident' && n.symbol) n.symbol.flags |= Flags.Export;
		else throw 'Invalid Symbol';
	}

	function typeIdent(tk: Token<'ident'>) {
		const name = text(tk);
		const symbol = typesTable.set(name, { name, kind: 'type', flags: 0 });
		return {
			...tk,
			kind: 'typeident',
			symbol,
		} as const;
	}

	function typeDefinition(node: Token<'type'>) {
		const name = typeIdent(expect('ident'));
		expect('=');
		const def = expectNode(typeParser(), 'Expected type definition');
		const result: NodeMap['type'] = {
			...node,
			children: [name, def],
			symbol: name.symbol,
		};
		return result;
	}

	function definition() {
		const isExport = optional('export');
		const isType = optional('type');

		const expr = isType
			? typeDefinition(isType)
			: expectNodeKind(expression(), 'def', 'Expected definition');

		if (isExport) markExported(expr.children[0]);

		return expr;
	}

	function macro(token: Token<'macro'>): NodeMap['macro'] {
		next();
		const nameTk = expect('ident');
		const macroName = text(nameTk);
		const symbol = symbolTable.set(macroName, {
			name: macroName,
			kind: 'macro',
			flags: 0,
			value: '',
		});
		const name = { ...nameTk, symbol };

		return {
			...token,
			name,
			children: [name],
		};
	}

	function topStatement() {
		const token = current();
		if (token.kind === 'main') {
			next();
			expect('{');
			return symbolTable.withScope(scope => {
				const children = parseUntilKind(expression, '}');
				return {
					...token,
					scope,
					children,
					end: expect('}').end,
					statements: children,
				};
			});
		} else if (token.kind === 'comment') {
			next();
			return token;
		} else if (token.kind === 'macro') return macro(token);

		return definition();
	}

	const root = {
		...node('root'),
		children: parseUntilKind(topStatement, 'eof'),
	};
	return root;
}
