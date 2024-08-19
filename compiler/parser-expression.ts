///<amd-module name="@cxl/gbc.compiler/parser-expression.js"/>
import { ParserApi, UnaryNode, Token, text, parserTable } from '@cxl/gbc.sdk';
import { parseType } from './parser-type.js';
import { Flags, SymbolTable } from './symbol-table.js';

import { Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: SymbolTable,
) {
	const typeParser = parseType(api, typesTable);
	const { current, error, expect, expectNode, optional, parseList } = api;
	//let context: 'normal' | 'data' = 'normal';

	function parameter(): NodeMap['parameter'] {
		const ident = optional('ident');
		let type: Node | undefined;
		let symbol;
		let children: NodeMap['parameter']['children'];

		if (ident) {
			const name = text(ident);
			if (optional(':')) type = expectNode(typeParser(), 'Expected type');
			symbol = symbolTable.set(name, {
				name,
				kind: 'parameter',
				flags: 0,
			});
			children = [{ ...ident, symbol }, type];
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

	/**
	 * Function that defines a variable in the symbol table.
	 */
	function define(ident: Token<'ident'>, flags = 0): NodeMap['ident'] {
		const name = text(ident);
		const existing = symbolTable.get(name);
		if (existing) throw error('Symbol already defined', ident);

		const symbol = symbolTable.set(name, {
			name,
			kind: 'variable',
			flags,
		});
		return {
			...ident,
			symbol,
		};
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({
			parseUntilKind,
			expression: expr,
			infixOperator,
			infix,
			ternaryOptional,
			expectExpression,
			prefix,
			current,
		}) => ({
			'>>': {
				precedence: 1,
				infix(tk, left) {
					const node = tk as NodeMap['>>'];
					node.start = left.start;
					const right = expectExpression();
					node.children =
						right.kind === '>>'
							? [left, ...right.children]
							: [left, right];
					node.end = right.end;
					return node;
				},
			},
			fn: {
				prefix(tk) {
					return parseBlock(tk, node => {
						const tk = current();
						if (tk.kind === '(') blockParameters(node);
						expect('{');
						node.statements = parseUntilKind(statement, '}');
					});
				},
			},
			'{': {
				prefix: tk =>
					parseBlock(tk, node => {
						node.statements = parseUntilKind(statement, '}');
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
			comment: { prefix: n => n },
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
					const right = expectExpression(2);
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
					//const isDefinition = define(left);
					const right = expectExpression(1);

					/*if (isDefinition) {
						return {
							...tk,
							kind: 'def',
							children: [left, right],
							left,
							right,
							start: left.start,
							end: right.end,
						};
					}*/

					return {
						...tk,
						kind: '=',
						children: [left, right],
						start: left.start,
						end: right.end,
					};
				},
			},

			'(': {
				precedence: 20,
				prefix() {
					const node = expectExpression();
					expect(')');
					return node as NodeMap['('];
				},
				infix(tk, left) {
					const cur = current();
					return {
						...tk,
						kind: 'call',
						children: [left, cur.kind === ')' ? undefined : expr()],
						start: left.start,
						end: expect(')').end,
					};
				},
			},
			'[': {
				precedence: 17,
				prefix(tk) {
					//context = 'data';
					return symbolTable.withScope(scope => {
						const result: NodeMap['data'] = {
							...tk,
							kind: 'data',
							scope,
							children: [expectExpression()],
							end: expect(']').end,
						};
						//context = 'normal';
						return result;
					});
				},
				infix(tk, left) {
					return {
						...tk,
						children: [left, expectExpression()],
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
						result.children = [expr()];
						result.end = expect(')').end;
					}
					return result;
				},
			},
			loop: {
				prefix(tk) {
					expect('{');
					const child = expectExpression();
					return {
						...tk,
						children: [child],
						end: expect('}').end,
					};
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
					const symbol = symbolTable.getRef(name, n);
					if (!symbol) throw error('Identifier not defined', n);
					n.symbol = symbol;
					return n;
				},
			},
		}),
	);

	const exprParser = parser(api);

	/**
	 * Parses a definition statement. A definition statement can be in the form of:
	 *  - `identifier = expression`
	 *  - `var identifier = expression`
	 *  - `identifier : type = expression`
	 *  - `var identifier : type = expression`
	 *
	 * If the statement does not match a definition pattern, it returns undefined.
	 * This allows the caller to fallback to parsing a general expression.
	 */
	function definition(): NodeMap['def'] | undefined {
		let tk = current();
		let flags = 0;
		if (tk.kind !== 'ident' && tk.kind !== 'var') return;
		api.next();
		if (tk.kind === 'var') {
			flags = Flags.Variable;
			tk = expect('ident');
		}
		const next = optional(':') || optional('=');
		if (!next) {
			if (flags) throw api.error('Expected definition', tk);
			api.backtrack(tk);
			return;
		}

		// Check if a symbol with this identifier already exists in the symbol table.
		// If it does, and we are not explicitly defining a variable (with 'var'),
		// this is likely an assignment expression, not a definition.
		if (next.kind === '=' && !flags && symbolTable.get(text(tk))) {
			api.backtrack(tk);
			return;
		}

		const left = define(tk, flags);
		let type;
		if (next.kind === ':') {
			type = expectNode(typeParser(), 'Expected type');
			expect('=');
		}
		const right = expectNode(exprParser(), 'Expected expression');
		return {
			kind: 'def',
			children: type ? [left, type, right] : [left, right],
			left,
			right,
			type,
			start: left.start,
			end: right.end,
			source: left.source,
			line: left.line,
		};
	}

	/**
	 * This is the entry point for parsing a statement.
	 * It first attempts to parse a definition (e.g., `var x = 5` or `x: number = 5`).
	 * If a definition is not found, it falls back to parsing a general expression.
	 */
	function statement() {
		return definition() || exprParser();
	}

	return statement;
}
