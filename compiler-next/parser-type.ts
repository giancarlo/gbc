///<amd-module name="@cxl/gbc.compiler/parser-type.js"/>
import { parserTable } from '@cxl/compiler/parser-table.js';
import { ParserApi } from '@cxl/compiler';

import type { NodeMap } from './parser.js';
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
			//',': infixOperator(3),
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
