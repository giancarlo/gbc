import {
	ParserApi,
	UnaryNode,
	Token,
	text,
	parserTable,
} from '../sdk/index.js';
import {
	EmptyFunction,
	ScopeOwner,
	Symbol,
	SymbolMap,
	SymbolTable,
	Flags,
} from './symbol-table.js';
import { BlockFlags, Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typeParser: () => Node | undefined,
) {
	const { current, error, expect, expectNode, optional, parseList } = api;

	function expectType() {
		return expectNode(typeParser(), 'Expected type expression');
	}
	function parameter(): NodeMap['parameter'] | undefined {
		const ident = optional('ident');
		if (!ident) return;
		let type: Node | undefined;
		const name = text(ident);

		if (optional(':')) type = expectNode(typeParser(), 'Expected type');

		const symbol: SymbolMap['variable'] = symbolTable.set(name, {
			name,
			kind: 'variable',
			flags: 0,
		});
		const nameNode = { ...ident, symbol };
		return (symbol.definition = {
			...ident,
			kind: 'parameter',
			symbol,
			name: nameNode,
			type,
			children: [nameNode, type],
		});
	}

	function blockParameters(node: NodeMap['fn']) {
		node.parameters = parseList(parameter, ',', n => !!n);
		if (node.symbol)
			node.symbol.parameters = node.parameters.map(p => p.symbol);
		expect(')');
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

	/**
	 * Parses a block of code, creating a new scope for it in the symbol table.
	 *
	 * This function takes a token indicating the start of a block and a callback
	 * to parse the block's children nodes. It creates a new scope for variables
	 * within the block using symbolTable.withScope.
	 *
	 * A node for the block is created. The block's statements are parsed and added
	 * as children nodes.
	 */
	function parseBlock(
		tk: ScannerToken,
		cb: (node: NodeMap['fn']) => Node[],
	): NodeMap['fn'] {
		return symbolTable.withScope(() => {
			const node: NodeMap['fn'] = {
				...tk,
				kind: 'fn',
				children: [],
				flags: 0,
				symbol: EmptyFunction,
			};
			const symbol = symbolTable.set(ScopeOwner, {
				kind: 'function',
				definition: node,
				flags: 0,
			});
			node.symbol = symbol;
			symbolTable.set('$', {
				name: '$',
				kind: 'variable',
				flags: 0,
			});
			node.statements = cb(node);
			node.children.push(...node.statements);
			return node;
		});
	}

	/**
	 * Function that defines a variable in the symbol table.
	 */
	function define(ident: Token<'ident'>, flags: Flags = 0): NodeMap['ident'] {
		const name = text(ident);
		const existing = symbolTable.get(name);
		if (existing)
			throw error(
				`Cannot redeclare block-scoped variable "${name}".`,
				ident,
			);
		const symbol = symbolTable.set(name, {
			name,
			kind: 'variable',
			flags,
		});
		return { ...ident, symbol };
	}

	function expectScopeOwner(): SymbolMap['function'] {
		const owner = symbolTable.get(ScopeOwner);
		if (!owner || owner.kind !== 'function')
			throw error('Invalid function scope.', current());
		return owner;
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
				prefix: tk =>
					parseBlock(tk, node => {
						if (optional('(')) {
							blockParameters(node);
							if (optional(':'))
								node.children.push(
									(node.returnType = expectType()),
								);
						}
						const inline = optional('=>');
						if (inline) {
							node.flags |= BlockFlags.Lambda;
							return [
								{
									...inline,
									kind: 'next',
									owner: expectScopeOwner(),
									children: [expectExpression()],
								},
							];
						}
						expect('{');
						const result = parseUntilKind(statement, '}');
						node.end = expect('}').end;
						return result;
					}),
			},
			'{': {
				prefix: tk =>
					parseBlock(tk, node => {
						node.flags = BlockFlags.Sequence;
						const result = parseUntilKind(statement, '}');
						node.end = expect('}').end;
						return result;
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
			'@': {
				prefix(tk) {
					const ident = optional('ident');
					if (ident) tk.end = ident.end;
					return tk;
				},
			},
			'.': {
				precedence: 17,
				infix(tk, left) {
					const right = expect('ident');
					const prop = text(right);

					let symbol: Symbol | undefined;

					// Handle module import operator '@'
					if (left.kind === '@') {
						const importName = text(left).slice(1);
						// We'll return a placeholder macro until the standard library is implemented.
						if (!importName) symbol = symbolTable.get('@');
					} else if (left.kind === 'ident') symbol = left.symbol;

					const propSymbol =
						symbol?.kind === 'data'
							? symbol?.members?.[prop]
							: undefined;

					if (!propSymbol)
						throw error(
							`Property "${prop}" does not exist in "${text(
								left,
							)}"`,
							right,
						);

					/*if (propSymbol.kind === 'macro')
						return {
							...tk,
							kind: 'macro',
							end: right.end,
							value: propSymbol.value,
						};*/

					return {
						...tk,
						start: left.start,
						children: [left, { ...right, symbol: propSymbol }],
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
					const right = expectExpression(1);
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
					const result: NodeMap['data'] = {
						...tk,
						kind: 'data',
						children: [expectExpression()],
						end: expect(']').end,
					};
					return result;
					/*return symbolTable.withScope(scope => {
						const result: NodeMap['data'] = {
							...tk,
							kind: 'data',
							scope,
							children: [expectExpression()],
							end: expect(']').end,
						};
						return result;
					});*/
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

			/*$: {
				prefix: n => {
					if (!symbolTable.getRef('$', n))
						throw error('$ not defined', n);
					return n;
				},
			},*/

			done: { prefix: n => n },
			next: {
				prefix(tk) {
					const owner = expectScopeOwner();
					const result: NodeMap['next'] = { ...tk, owner };
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
				prefix: n => {
					const name = text(n);
					const symbol = symbolTable.getWithReference(name, n);
					if (!symbol) throw error('Identifier not defined', n);
					return { ...n, symbol };
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
			start: tk.start,
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
	function statement(): Node | undefined {
		return definition() || exprParser();
	}

	return statement;
}
