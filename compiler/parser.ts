///<amd-module name="@cxl/gbc.compiler/parser.js"/>
import { ParserApi } from '@cxl/gbc.sdk';

import { parseExpression } from './parser-expression.js';
import { Flags, SymbolTable } from './symbol-table.js';

import type { ScannerToken } from './scanner.js';
import type { Node } from './node.js';

export type RootNode = ReturnType<typeof parse>;

export function parse(api: ParserApi<ScannerToken>, symbolTable: SymbolTable) {
	const {
		current,
		expect,
		expectNodeKind,
		optional,
		node,
		parseUntilKind,
		next,
	} = api;
	const expression = parseExpression(api, symbolTable);

	function markExported(n: Node) {
		if (n.kind === 'ident' && n.symbol) n.symbol.flags |= Flags.Export;
		else throw 'Invalid Symbol';
	}

	function definition() {
		const isExport = optional('export');
		const expr = expectNodeKind(expression(), 'def', 'Expected definition');

		if (isExport) {
			if (expr.children[0].kind === ',') {
				for (const child of expr.children) markExported(child);
			} else markExported(expr.children[0]);
		}
		return expr;
	}

	function topStatement() {
		const token = current();
		if (token.kind === 'main') {
			next();
			expect('{');
			const children = parseUntilKind(expression, '}');
			return {
				...token,
				children,
				end: expect('}').end,
				statements: children,
			};
		}

		return definition();
	}

	const root = {
		...node('root'),
		children: parseUntilKind(topStatement, 'eof'),
	};
	return root;
}
