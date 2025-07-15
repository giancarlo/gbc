import { ParserApi, Token, parserTable, text } from 'gbc/sdk/index.js';

import type { NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';
import type { TypesSymbolTable } from './symbol-table.js';

export function parseType(
	api: ParserApi<ScannerToken>,
	symbolTable: TypesSymbolTable,
) {
	/**
	 * This helper function retrieves a symbol from the symbol table based on its name.
	 * It throws an error if the symbol is not found and adds a reference to the symbol.
	 */
	function expectSymbol(name: string, tk: Token<'ident'>) {
		const symbol = symbolTable.get(name);
		if (!symbol) throw api.error('Type not defined', tk);
		const node: NodeMap['typeident'] = { ...tk, kind: 'typeident', symbol };
		(symbol.references ||= []).push(node);
		return node;
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({ expect, expression, expectNode }) => ({
			ident: {
				prefix(n) {
					return expectSymbol(text(n), n);
				},
			},
			'(': {
				prefix(tk) {
					const result = tk as NodeMap['('];
					result.children = [
						expectNode(expression(), 'Expected expression'),
					];
					result.end = expect(')').end;
					return result;
				},
			},
		}),
	);
	return parser(api);
}
