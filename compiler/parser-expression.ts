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
	TypesSymbolTable,
	Type,
	Flags,
} from './symbol-table.js';
import { Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: TypesSymbolTable,
	typeParser: () => Node | undefined,
	parseStatementBlock: (
		parser: () => Node | undefined,
		endKind: ScannerToken['kind'],
	) => Node[],
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
			label: Token<'ident'>;
			symbol: SymbolMap['variable'];
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
		const type = optional(':') ? maybeVarType(symbol) : undefined;
		const value = optional('=')
			? expectNode(exprParser(valuePrec), 'Expected value')
			: undefined;
		const node = make({
			...ident,
			end: (value ?? type ?? ident).end,
			label: ident,
			symbol,
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
		node.symbol.parameters = node.parameters.map(p => p.symbol);
		expect(')');
		node.children.push(...node.parameters);
	}

	function parseLambdaAfterOpenParen(tk: ScannerToken): NodeMap['fn'] {
		return parseBlock(tk, node => {
			blockParameters(node);
			if (optional(':'))
				node.children.push(
					(node.returnType = expectType()),
				);
			expect('{');
			return parseFnBody(node);
		});
	}

	function parseAnonymousSlotBlock(
		tk: ScannerToken,
		typeNode: Node,
	): NodeMap['fn'] {
		return parseBlock(tk, node => {
			const anonSym: SymbolMap['variable'] = {
				kind: 'variable',
				name: '',
				flags: 0,
			};
			if (typeNode.kind === 'typeident' && typeNode.symbol.kind === 'type')
				anonSym.type = typeNode.symbol;
			const returnTypeNode = optional(':') ? expectType() : undefined;
			if (returnTypeNode) node.returnType = returnTypeNode;
			const param: NodeMap['parameter'] = {
				...tk,
				kind: 'parameter',
				symbol: anonSym,
				type: typeNode,
				children: [undefined, typeNode, returnTypeNode],
			};
			node.parameters = [param];
			node.children.push(param);
			expect('{');
			return parseFnBody(node);
		});
	}

	function parseFnBody(node: NodeMap['fn']): Node[] {
		const stmts = parseStatementBlock(statement, '}');
		node.end = expect('}').end;
		const only = stmts.length === 1 ? stmts[0] : undefined;
		const isAutoEmit =
			stmts.length === 0 ||
			(only !== undefined &&
				only.kind !== 'def' &&
				only.kind !== 'next' &&
				only.kind !== 'done' &&
				only.kind !== 'break');
		if (isAutoEmit) node.symbol.flags |= Flags.Sequence;
		return stmts;
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

	/**
	 * Parse a `next <expr>` statement. The statement keywords `next`, `done`,
	 * and `break` are intentionally absent from the Pratt prefix table — that
	 * keeps them out of arbitrary expression positions (`x = next 1`,
	 * `f(next 1)`, `next next 1`, etc.). They reach the AST only through
	 * `statement()` and through `?:` ternary branches via `parseBranchOrExpr`.
	 */
	function parseNextStmt(): NodeMap['next'] {
		const tk = expect('next');
		const owner = expectScopeOwner();
		const value = expectNode(exprParser(), 'Expected expression');
		return {
			...tk,
			owner,
			children: [value],
			end: value.end,
		};
	}

	function parseSimpleStmt(): Node {
		const tk = current();
		api.next();
		return tk as Node;
	}

	/**
	 * Parse a ternary branch: either a statement form (`next X`, `done`,
	 * `break`) per D33, or a value expression at the ternary precedence.
	 */
	function parseBranchOrExpr(prec: number): Node {
		const k = current().kind;
		if (k === 'next')
			throw api.error(
				'`next` is not allowed in `?:` branches; use `next cond ? X : Y` instead.',
				current(),
			);
		if (k === 'done' || k === 'break') return parseSimpleStmt();
		return expectNode(exprParser(prec), 'Expected expression');
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
			expression: expr,
			infixOperator,
			infix,
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
			'{': {
				prefix: tk => parseBlock(tk, parseFnBody),
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

					let leftSymbol: Symbol | undefined;
					if (left.kind === '@') {
						const importName = text(left).slice(1);
						if (!importName) leftSymbol = symbolTable.get('@');
					} else if (left.kind === 'ident') leftSymbol = left.symbol;

					const propSymbol =
						leftSymbol?.kind === 'data'
							? leftSymbol.members[prop]
							: undefined;

					if (leftSymbol?.kind === 'data' && !propSymbol)
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
					let type: Node | undefined;
					const symbol: SymbolMap['variable'] = {
						kind: 'variable',
						name: '',
						flags: 0,
					};
					if (current().kind === 'var') {
						api.next();
						symbol.flags |= Flags.Variable;
					} else {
						type = expectType();
					}
					if (type && current().kind === '{') {
						if (
							type.kind === 'typeident' &&
							type.symbol.kind === 'type' &&
							type.symbol.family !== 'literal' &&
							type.symbol.family !== 'union'
						)
							throw error(
								`":${type.symbol.name} { ... }" is not a literal-type prefix; use \`${type.symbol.name}\` for Shape 2.`,
								tk,
							);
						return parseAnonymousSlotBlock(tk, type);
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
				prefix(tk) {
					const tk1 = current();
					if (tk1.kind === ':')
						throw error(
							'Parens around a single anonymous slot are not allowed; use `:T { ... }` or `T { ... }`',
							tk,
						);
					let isLambda = tk1.kind === ')';
					if (tk1.kind === 'ident') {
						api.next();
						const tk2 = current();
						if (tk2.kind === ':' || tk2.kind === ',')
							isLambda = true;
						else if (tk2.kind === ')') {
							api.next();
							const tk3 = current();
							isLambda =
								tk3.kind === '{' || tk3.kind === ':';
						}
						api.backtrack(tk1);
					}
					if (isLambda) return parseLambdaAfterOpenParen(tk);
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
					const savedErrors = api.errors.length;
					api.backtrack(tk);
					let typeNode: Node | undefined;
					try {
						typeNode = typeParser();
					} catch {
						typeNode = undefined;
					}
					const hasLiteralValueMembers = (() => {
						if (!typeNode || typeNode.kind !== 'data') return false;
						const inner = typeNode.children[0];
						const items =
							inner?.kind === ',' ? inner.children : inner ? [inner] : [];
						const ms = items
							.map(item =>
								item.kind === 'propdef' ? item.symbol.type : undefined,
							)
							.filter((t): t is Type => !!t);
						if (ms.length === 0) return false;
						return ms.every(
							t =>
								t.kind === 'type' &&
								t.family === 'literal' &&
								typeof t.value === 'number',
						);
					})();
					if (typeNode && !hasLiteralValueMembers && current().kind === '{')
						return parseAnonymousSlotBlock(tk, typeNode);
					if (hasLiteralValueMembers && current().kind === '{')
						throw api.error(
							'expected type, got value-like data block as type prefix',
							tk,
						);
					api.errors.length = savedErrors;
					api.backtrack(tk);
					api.next();
					const items: Node[] = [];
					const seenLabels = new Set<string>();
					if (current().kind !== ']') {
						do {
							items.push(parseDataItem(seenLabels));
						} while (optional(','));
					}
					let inner: Node | undefined;
					const itemFirst = items[0];
					if (items.length === 1 && itemFirst) inner = itemFirst;
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
				infix(tk, left) {
					const truthy = parseBranchOrExpr(2);
					const node = {
						...tk,
						kind: '?' as const,
						start: left.start,
						end: truthy.end,
						children: [left, truthy] as Node[],
					};
					if (optional(':')) {
						const falsy = parseBranchOrExpr(2);
						node.children.push(falsy);
						node.end = falsy.end;
					}
					return node as NodeMap['?'];
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
					if (typesTable.get(name)) {
						const savedErrors = api.errors.length;
						api.backtrack(n);
						let typeNode: Node | undefined;
						try {
							typeNode = typeParser();
						} catch {
							typeNode = undefined;
						}
						if (typeNode && current().kind === '{')
							return parseAnonymousSlotBlock(n, typeNode);
						if (typeNode && current().kind === ':')
							return parseAnonymousSlotBlock(n, typeNode);
						api.errors.length = savedErrors;
						api.backtrack(n);
						api.next();
					}
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
	 * Parses a definition statement (D6 — `var` is a type modifier, not a
	 * binding modifier):
	 *  - `identifier = expression`
	 *  - `identifier : type = expression`
	 *  - `identifier : var = expression`
	 *  - `identifier : var type = expression`
	 *
	 * If the statement does not match a definition pattern, it returns undefined.
	 * This allows the caller to fallback to parsing a general expression.
	 */
	function definition(): NodeMap['def'] | undefined {
		const tk = current();
		if (tk.kind !== 'ident') return;
		api.next();
		const nextKind = current().kind;
		if (nextKind !== ':' && nextKind !== '=') {
			api.backtrack(tk);
			return;
		}

		// Symbol already declared in scope ⇒ this is an assignment, not a def.
		if (nextKind === '=' && symbolTable.get(text(tk))) {
			api.backtrack(tk);
			return;
		}

		checkRedeclare(tk);
		return parseSlot(tk, slot => {
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
	 * Entry point for parsing a statement. Handles the statement-only
	 * keywords (`next`, `done`, `break`) explicitly — they are not in the
	 * Pratt prefix table, so they're unreachable from any expression
	 * position. Falls back to a definition or a general expression.
	 */
	function statement(): Node | undefined {
		const k = current().kind;
		if (k === 'next') return parseNextStmt();
		if (k === 'done' || k === 'break') return parseSimpleStmt();
		return definition() || exprParser();
	}

	return statement;
}
