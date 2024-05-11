///<amd-module name="@cxl/gbc.compiler/parser-expression.js"/>
import { ParserApi, UnaryNode, text, parserTable } from '@cxl/gbc.sdk';
import { parseType } from './parser-type.js';
import { Flags, SymbolTable } from './symbol-table.js';

import { Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';

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
			symbol = symbolTable.set(name, {
				name,
				kind: 'parameter',
				flags: 0,
			});
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

	function prefixNumber(op: (n: number) => number) {
		return (n: UnaryNode<NodeMap>) => {
			const right = n.children[0];
			if (right.kind === 'number') {
				right.value = op(right.value);
				return right as Node;
			}
			return n;
		};
	}

	function parseBlock(tk: ScannerToken, cb: (node: NodeMap['{']) => void) {
		const node = tk as NodeMap['{'];
		node.kind = '{';
		node.children = [];
		symbolTable.withScope(scope => {
			node.scope = scope;
			symbolTable.set('$', {
				name: '$',
				kind: 'variable',
				flags: 0,
			});
			cb(node);
			node.children.push(...node.statements);
			node.end = expect('}').end;
		});
		return node;
	}

	function define(n: Node, isDef = false) {
		const ident =
			n.kind === 'var' ? n.ident : n.kind === 'ident' ? n : undefined;

		if (!ident) throw error('Expected identifier', n);
		const name = text(ident);
		const existing = symbolTable.getRef(name, n);

		if (isDef && existing)
			throw error('Cannot mix assignment and defitions', n);

		const symbol =
			existing ||
			symbolTable.set(name, {
				name,
				kind: 'variable',
				flags: n.kind === 'var' ? Flags.Variable : 0,
			});
		ident.symbol = symbol;

		return !existing;
	}

	function unexpected() {
		return {
			prefix(tk: ScannerToken) {
				throw error('Unexpected token', tk);
			},
		};
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({
			parseUntilKind,
			expression: expr,
			infixOperator,
			infix,
			ternaryOptional,
			prefix,
			current,
		}) => ({
			'>>': infixOperator(1, 0),
			fn: {
				prefix(tk) {
					return parseBlock(tk, node => {
						const tk = current();
						if (tk.kind === '(') blockParameters(node);
						expect('{');
						node.statements = parseUntilKind(expr, '}');
					});
				},
			},
			var: {
				prefix(tk: NodeMap['var']) {
					tk.ident = expect('ident') as NodeMap['ident'];
					tk.end = tk.ident.end;
					return tk;
				},
			},
			'{': {
				prefix: tk =>
					parseBlock(tk, node => {
						node.statements = parseUntilKind(expr, '}');
						node.lambda = true;
					}),
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
			//'<<': infixOperator(10),
			'<:': infixOperator(10),
			':>': infixOperator(10),
			'++': {
				precedence: 15,
				infix(tk, left) {
					const result = tk as NodeMap['++'];
					result.children = [left];
					return result;
				},
			},
			'+': {
				precedence: 11,
				infix: infix(11),
			},
			'-': {
				precedence: 11,
				prefix: prefix(
					14,
					prefixNumber(n => -n),
				),
				infix: infix(11),
			},
			'~': {
				prefix: prefix(
					14,
					prefixNumber(n => ~n),
				),
			},
			'!': {
				prefix: prefix(14),
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
						left.symbol?.kind === 'namespace'
					) {
						const prop = text(right);
						symbol = left.symbol.members[prop];
						if (!symbol)
							throw error(
								`Property "${prop}" does not exist in "${left.symbol.name}"`,
								right,
							);

						right.symbol = symbol;

						if (symbol.kind === 'native')
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
			',': {
				precedence: 1,
				infix(tk, left) {
					const node = tk as NodeMap[','];
					node.start = left.start;
					const right = expectNode(expr(1), 'Expected expression');
					node.children =
						left.kind === ','
							? [...left.children, right]
							: [left, right];
					node.end = right.end;
					return node;
				},
			},
			'=': {
				precedence: 2,
				infix(tk, left) {
					const node = tk as NodeMap['='];
					let isDefinition = define(left);
					const right = expectNode(expr(1), 'Expected expression');
					if (isDefinition)
						(node as Node).kind =
							symbolTable.context === 'data' ? 'propdef' : 'def';

					node.children = [left, right];
					node.start = left.start;
					node.end = right.end;

					return node;
				},
			},

			'(': {
				precedence: 20,
				prefix() {
					const node = expectNode(expr(0), 'Expected expression');
					expect(')');
					return node as NodeMap['('];
				},
				infix(tk, left) {
					const cur = current();
					return {
						...tk,
						kind: 'call',
						children: [left, cur.kind === ')' ? undefined : expr()],
						end: expect(')').end,
					};
				},
			},
			'[': {
				precedence: 17,
				prefix(tk) {
					symbolTable.context = 'data';
					return symbolTable.withScope(scope => {
						const result: NodeMap['data'] = {
							...tk,
							kind: 'data',
							scope,
							children: [
								expectNode(expr(), 'Expected expression'),
							],
							end: expect(']').end,
						};
						symbolTable.context = 'normal';
						return result;
					});
				},
				infix(tk, left) {
					return {
						...tk,
						children: [
							left,
							expectNode(expr(), 'Expected expression'),
						],
						end: expect(']').end,
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
			next: {
				prefix(tk) {
					const result = tk as NodeMap['next'];
					if (optional('(')) {
						result.children = [
							expectNode(expr(), 'Expected expression'),
						];
						result.end = expect(')').end;
					}
					return result;
				},
			},
			loop: {
				prefix(tk) {
					const result = tk as NodeMap['loop'];
					const child = expectNode(expr(), 'Expected expression');
					result.children = [child];
					result.end = child.end;
					return result;
				},
			},
			number: {
				prefix: n => {
					(n as NodeMap['number']).value = +text(n).replace(/_/g, '');
					return n as NodeMap['number'];
				},
			},
			string: { prefix: n => n },
			ident: {
				prefix(n: NodeMap['ident']) {
					const name = text(n);
					if (!n.symbol) {
						const symbol = symbolTable.getRef(name, n);
						//if (!symbol) throw error(`Unexpected identifier "${name}"`, n);
						n.symbol = symbol;
					}
					return n;
				},
			},
			')': unexpected(),
			']': unexpected(),
		}),
	);
	return parser(api);
}
