///<amd-module name="@cxl/gbc.compiler/parser-type.js"/>
import { ParserApi, parserTable } from '@cxl/gbc.sdk';

import type { NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';
import type { SymbolTable } from './symbol-table.js';

export function parseType(
	api: ParserApi<ScannerToken>,
	_symbolTable: SymbolTable,
) {
	const parser = parserTable<NodeMap, ScannerToken>(
		({ expect, expression, expectNode, infixOperator }) => ({
			':': infixOperator(2),
			ident: { prefix: n => n },
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
