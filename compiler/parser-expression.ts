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
import { Node, NodeMap } from './node.js';
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

	/**
	 * After `:` has been consumed, parse the type slot.
	 * `var` is a slot-level modifier (not a type) — when present it sets
	 * the Variable flag on the provided slot symbol; otherwise we parse a
	 * regular type expression.
	 */
	function maybeVarType(symbol: SymbolMap['variable']) {
		if (current().kind === 'var') {
			api.next();
			symbol.flags |= Flags.Variable;
			return undefined;
		}
		return expectType();
	}

	/**
	 * Parses `ident [: var | type] [= value]` given a pre-consumed ident,
	 * then hands the slot data to `make` to build the wrapping AST node
	 * (`parameter`, `propdef`, `def`, ...). Wires the slot symbol's
	 * `definition` to the produced node.
	 */
	function parseSlot<N extends Node>(
		ident: Token<'ident'>,
		make: (slot: {
			start: number;
			end: number;
			line: number;
			source: string;
			label: NodeMap['ident'];
			type?: Node;
			value?: Node;
		}) => N,
		valuePrec?: number,
	): N {
		const name = text(ident);
		const symbol: SymbolMap['variable'] = symbolTable.set(name, {
			name,
			kind: 'variable',
			flags: 0,
		});
		const label: NodeMap['ident'] = { ...ident, symbol };
		const type = optional(':') ? maybeVarType(symbol) : undefined;
		const value = optional('=')
			? expectNode(exprParser(valuePrec), 'Expected value')
			: undefined;
		const node = make({
			...ident,
			end: (value ?? type ?? label).end,
			label,
			type,
			value,
		});
		symbol.definition = node;
		return node;
	}

	function parameter(): NodeMap['parameter'] | undefined {
		const ident = optional('ident');
		if (!ident) return;
		return parseSlot(
			ident,
			slot => ({
				...slot,
				kind: 'parameter',
				children: [slot.label, slot.type, slot.value],
			}),
			2,
		);
	}

	function blockParameters(node: NodeMap['fn']) {
		node.parameters = parseList(parameter, ',', n => !!n);
		node.symbol.parameters = node.parameters.map(p => p.label.symbol);
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
	 * Throws when a name is already defined in the current scope.
	 */
	function checkRedeclare(ident: Token<'ident'>) {
		const name = text(ident);
		if (symbolTable.get(name))
			throw error(
				`Cannot redeclare block-scoped variable "${name}".`,
				ident,
			);
	}

	function expectScopeOwner(): SymbolMap['function'] {
		const owner = symbolTable.get(ScopeOwner);
		if (!owner || owner.kind !== 'function')
			throw error('Invalid function scope.', current());
		return owner;
	}

	function parseDataItem(seenLabels: Set<string>): Node {
		const tk = current();
		if (tk.kind === 'ident') {
			api.next();
			const after = current();
			if (after.kind === '=' || after.kind === ':') {
				const name = text(tk);
				if (seenLabels.has(name))
					api.pushError(
						error(`Duplicate label "${name}"`, tk),
					);
				else seenLabels.add(name);
				return parseSlot(
					tk,
					slot => ({
						...slot,
						kind: 'propdef',
						children: [slot.label, slot.type, slot.value],
					}),
					2,
				);
			}
			api.backtrack(tk);
		}
		return expectNode(exprParser(), 'Expected expression');
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
							node.symbol.flags |= Flags.Lambda;
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
						if (!result.length)
							throw error(
								'Empty `fn(...) { }` body is not allowed; use `{ }` for a no-op function.',
								tk,
							);
						return result;
					}),
			},
			'{': {
				prefix: tk =>
					parseBlock(tk, node => {
						node.symbol.flags = Flags.Sequence;
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
			is: {
				precedence: 9,
				infix(tk, left) {
					const right = expectType();
					return {
						...tk,
						kind: 'is',
						children: [left, right],
						start: left.start,
						end: right.end,
					};
				},
			},
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
				prefix: tk => {
					const right = expectExpression(14);
					const result: NodeMap['negate'] = {
						...tk,
						kind: 'negate',
						children: [right],
						end: right.end,
					};
					return prefixNumber(n => -n)(result);
				},
				infix: infix(11),
			},
			'~': {
				prefix: prefix(
					14,
					prefixNumber(n => ~n),
				),
			},
			$: {
				prefix: n => n,
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
					const numTk = optional('number');
					if (numTk) {
						const numNode: NodeMap['number'] = {
							...numTk,
							kind: 'number',
							value: +text(numTk).replace(/_/g, ''),
						};
						return {
							...tk,
							start: left.start,
							children: [left, numNode],
							end: numTk.end,
						};
					}
					const right = expect('ident');
					const prop = text(right);

					let symbol: Symbol | undefined;
					if (left.kind === '@') {
						const importName = text(left).slice(1);
						if (!importName) symbol = symbolTable.get('@');
					} else if (left.kind === 'ident') symbol = left.symbol;

					const propSymbol =
						symbol?.kind === 'data'
							? symbol.members[prop]
							: undefined;

					if (symbol?.kind === 'data' && !propSymbol)
						throw error(
							`Property "${prop}" does not exist in "${text(
								left,
							)}"`,
							right,
						);

					const placeholder: SymbolMap['variable'] = {
						name: prop,
						kind: 'variable',
						flags: 0,
					};
					const rightNode: NodeMap['ident'] = {
						...right,
						symbol: propSymbol ?? placeholder,
					};
					return {
						...tk,
						start: left.start,
						children: [left, rightNode],
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
			':': {
				prefix(tk) {
					// Unlabeled slot: `:type = value` or `:var = value`.
					// For `var`, synthesize a slot symbol on the propdef
					// so the Variable flag has a home (parallel to how
					// labeled propdefs use label.symbol).
					let type: Node | undefined;
					let symbol: SymbolMap['variable'] | undefined;
					if (current().kind === 'var') {
						api.next();
						symbol = {
							kind: 'variable',
							name: '',
							flags: Flags.Variable,
						};
					} else {
						type = expectType();
					}
					const value = optional('=')
						? expectNode(exprParser(2), 'Expected value')
						: undefined;
					const propdef: NodeMap['propdef'] = {
						...tk,
						kind: 'propdef',
						type,
						value,
						symbol,
						children: [undefined, type, value],
						end: (value ?? type ?? tk).end,
					};
					return propdef;
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
					const items: Node[] = [];
					const seenLabels = new Set<string>();
					if (current().kind !== ']') {
						do {
							items.push(parseDataItem(seenLabels));
						} while (optional(','));
					}
					let inner: Node | undefined;
					const first = items[0];
					if (items.length === 1 && first) inner = first;
					else if (items.length > 1) {
						const comma: NodeMap[','] = {
							...tk,
							kind: ',',
							children: items,
						};
						inner = comma;
					}
					const result: NodeMap['data'] = {
						...tk,
						kind: 'data',
						children: inner ? [inner] : [],
						end: expect(']').end,
					};
					return result;
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
			break: { prefix: n => n },
			next: {
				prefix(tk) {
					const owner = expectScopeOwner();
					const result: NodeMap['next'] = { ...tk, owner };
					const value = expr(0);
					if (value) {
						result.children = [value];
						result.end = value.end;
					}
					return result;
				},
			},
			loop: {
				prefix: n => n,
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
					if (symbol) return { ...n, symbol };
					const tk = current();
					if (tk.kind !== '=' && tk.kind !== ':')
						throw error('Identifier not defined', n);
					return parseSlot(
						n,
						slot => ({
							...slot,
							kind: 'propdef',
							children: [slot.label, slot.type, slot.value],
						}),
						2,
					);
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
		const nextKind = current().kind;
		if (nextKind !== ':' && nextKind !== '=') {
			if (flags) throw api.error('Expected definition', tk);
			api.backtrack(tk);
			return;
		}

		// Check if a symbol with this identifier already exists in the symbol table.
		// If it does, and we are not explicitly defining a variable (with 'var'),
		// this is likely an assignment expression, not a definition.
		if (nextKind === '=' && !flags && symbolTable.get(text(tk))) {
			api.backtrack(tk);
			return;
		}

		checkRedeclare(tk);
		return parseSlot(tk, slot => {
			if (flags) slot.label.symbol.flags |= flags;
			if (!slot.value)
				throw api.error(
					`"${text(tk)}" declaration without value`,
					tk,
				);
			const value = slot.value;
			return {
				...slot,
				kind: 'def',
				children: [slot.label, slot.type, value],
				value,
			};
		});
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
