///<amd-module name="@cxl/gbc.compiler/parser.js"/>
import { ParserApi, text } from '@cxl/compiler';

import type { Token, scan } from './scanner.js';
import type { Symbol, SymbolTable } from './symbol-table.js';

export enum Flags {
	Variable = 1,
	Export = 2,
}

type ScannerToken = ReturnType<ReturnType<typeof scan>>;
/* eslint @typescript-eslint/ban-types:off */
export type NodeMap = MakeNodeMap<
	{
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
		call: { children: [Node, Node] };
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
	>
>;
export type Node = NodeMap[keyof NodeMap];

function buildParser(
	api: ParserApi<ScannerToken>,
	prefixOp: (
		token: ScannerToken,
	) => ((token: ScannerToken) => Node) | undefined,
	nextOp: (
		precedence: number,
		token: ScannerToken,
	) => undefined | ((token: ScannerToken, left: Node) => Node),
) {
	const { current, next } = api;

	function prefixOperator(left: ScannerToken) {
		const operator = prefixOp(left);
		if (operator) {
			next();
			return operator(left);
		}
	}

	function expression(precedence = 0) {
		const left = current();
		let result = prefixOperator(left);

		while (result) {
			const n = current();
			const operator = nextOp(precedence, n);
			if (operator) {
				next();
				result = operator(n, result);
			} else break;
		}

		return result;
	}

	function infix(rightBindingPower: number, cb?: (node: Node) => void) {
		return (node: Node, left: Node) => {
			node.start = left.start;
			const right = expression(rightBindingPower);
			if (!right) throw api.error('Expected expression', node);
			node.children = [left, right];
			node.end = right.end;
			cb?.(node);
			return node;
		};
	}

	return { expression, infix };
}

export function parseType(
	api: ParserApi<ScannerToken>,
	_symbolTable: SymbolTable,
) {
	const { expect, expectNode } = api;
	const { expression, infix } = buildParser(
		api,
		left => {
			switch (left.kind) {
				case '(':
					return left => {
						const result = left as NodeMap['('];
						result.children = [
							expectNode(expression(), 'Expected expression'),
						];
						result.end = expect(')').end;
						return result;
					};
				default:
			}
		},
		(precedence, token) => {
			switch (token.kind) {
				case ':':
					if (precedence < 2) return infix(2);
				default:
			}
		},
	);

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

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
) {
	const typeParser = parseType(api, symbolTable);
	const { current, error, expect, expectNode, next, optional, parseList } =
		api;

	const expression = buildParser(api, prefixOperator, nextOperator);

	function prefixOperator(left: ScannerToken) {
		let op;
		switch (left.kind) {
			default:
				return;
		}
		next();
		return op(left);
	}

	function nextOperator(precedence: number, n: ScannerToken) {
		switch (n.kind) {
			case '>>':
				return precedence < 2 ? infix : undefined;
			default:
				return;
		}
	}

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
