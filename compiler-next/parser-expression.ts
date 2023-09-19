///<amd-module name="@cxl/gbc.compiler-next/parser-expression.js"/>
import { parserTable } from '@cxl/compiler/parser-table.js';
import { ParserApi, text } from '@cxl/compiler';
import { parseType } from './parser-type.js';

import type { NodeMap, Node } from './parser.js';
import type { ScannerToken } from './scanner.js';
import type { SymbolTable } from './symbol-table.js';

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
) {
	const typeParser = parseType(api, symbolTable);
	const { current, error, expect, expectNode, optional, parseList } = api;

	function parameter(): NodeMap['parameter'] {
		const ident = optional('ident');
		let type: Node | undefined;
		let symbol;
		let children: NodeMap['parameter']['children'];

		if (ident) {
			const name = text(ident);
			symbol = symbolTable.set(name, { name, type: 'parameter' });
			if (optional(':')) type = expectNode(typeParser(), 'Expected type');
			children = [ident, type];
		} else {
			expect(':');
			type = expectNode(typeParser(), 'Expected type');
			children = [undefined, type];
		}
		const pos = ident || type;

		if (!children || !pos)
			throw error('Invalid parameter definition', current());

		return {
			...pos,
			kind: 'parameter',
			children,
			symbol,
		};
	}

	function blockParameters(node: NodeMap['{']) {
		const params = expect('(') as NodeMap['('];
		node.parameters = parseList(parameter, ',', n => !!n);
		params.end = expect(')').end;
		node.children.push(...node.parameters);
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({
			parseUntilKind,
			expression: expr,
			infixOperator,
			infix,
			ternaryOptional,
			unary,
			current,
		}) => ({
			'>>': infixOperator(2),
			'{': {
				prefix(node: NodeMap['{']) {
					const tk = current();
					node.children = [];
					symbolTable.withScope(scope => {
						node.scope = scope;
						if (tk.kind === '(') blockParameters(node);
						else
							symbolTable.set('$', {
								name: '$',
								type: 'variable',
							});
						node.statements = parseUntilKind(expr, '}');
						node.children.push(...node.statements);
						node.end = expect('}').end;
					});
					return node;
				},
			},
			'||': infixOperator(3),
			'&&': infixOperator(4),
			'|': infixOperator(5),
			'^': infixOperator(6),
			'&': infixOperator(7),
			'==': infixOperator(8),
			'!=': infixOperator(8),
			'<': infixOperator(9),
			'>': infixOperator(9),
			'<=': infixOperator(9),
			'>=': infixOperator(9),
			'+': {
				precedence: 11,
				prefix: unary(14),
				infix: infix(11),
			},
			'-': {
				precedence: 11,
				prefix: unary(14),
				infix: infix(11),
			},
			'~': {
				prefix: unary(14),
			},
			'!': {
				prefix: unary(14),
			},
			'/': infixOperator(12),
			'*': infixOperator(12),

			'.': {
				precedence: 17,
				infix(tk, left) {
					const right = expect('ident') as NodeMap['ident'];
					let symbol;

					if (
						left.kind === 'ident' &&
						left.symbol?.type === 'namespace'
					) {
						const prop = text(right);
						symbol = left.symbol.members[prop];
						if (!symbol)
							throw error(
								`Property "${prop}" does not exist in "${left.symbol.name}"`,
								right,
							);

						right.symbol = symbol;

						if (symbol.type === 'native')
							return {
								...tk,
								kind: 'macro',
								children: [left, right],
								end: right.end,
								value: symbol.replace,
							} as unknown as NodeMap['.'];
					}

					return {
						...tk,
						start: left.start,
						children: [left, right],
						end: right.end,
						symbol,
					};
				},
			},
			',': infixOperator(3),
			'=': infixOperator(2, 0),

			'(': {
				precedence: 20,
				prefix() {
					const node = expectNode(expr(0), 'Expected expression');
					expect(')');
					return node as NodeMap['('];
				},
				infix(tk, left) {
					return {
						...tk,
						kind: 'call',
						children: [left, expr()],
						end: expect(')').end,
					};
				},
			},

			'?': {
				precedence: 2,
				infix: ternaryOptional(2, ':'),
			},

			$: {
				prefix: n => {
					if (!symbolTable.getRef('$', n))
						throw error('$ not defined', n);
					return n;
				},
			},
			done: { prefix: n => n },
			number: { prefix: n => n },
			string: { prefix: n => n },
			ident: {
				prefix(n: NodeMap['ident']) {
					const name = text(n);
					const symbol = symbolTable.getRef(name, n);
					if (!symbol)
						throw error(`Unexpected identifier "${name}"`, n);
					n.symbol = symbol;
					return n;
				},
			},
		}),
	);
	return parser(api);
}
