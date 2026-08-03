import {
	ParserApi,
	UnaryNode,
	Token,
	text,
	parserTable,
} from '../sdk/index.js';
import {
	EmptyFunction,
	OwnershipMode,
	ScopeOwner,
	Symbol,
	SymbolMap,
	SymbolTable,
	TypesSymbolTable,
	Type,
	Flags,
} from './symbol-table.js';
import { Node, NodeMap } from './node.js';
import { typeParameters } from './parser-type.js';
import type { ScannerToken } from './scanner.js';
import type { ModuleLoader, ModuleRef } from './parser.js';

export function parseExpression(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: TypesSymbolTable,
	typeParser: (precedence?: number) => Node | undefined,
	parseStatementBlock: (
		parser: () => Node | undefined,
		endKind: ScannerToken['kind'],
	) => Node[],
	loader?: ModuleLoader,
) {
	const { current, error, consume, expectNode, optional, parseList } = api;

	function expectType() {
		return expectNode(typeParser(2), 'Expected type expression');
	}

	/** `@name` (library) or `@.seg.seg` (local file). Local refs consume all
	 * dotted segments as the path; a library ref is the single mapped name —
	 * members are ordinary `.` access on the bound namespace. */
	function parseModuleRef(): (ModuleRef & { end: number }) | undefined {
		const at = current();
		if (at.kind !== '@') return undefined;
		api.next();
		if (current().kind === 'ident') {
			const nameTk = current();
			api.next();
			return { dot: false, segs: [text(nameTk)], end: nameTk.end };
		}
		if (String(current().kind) === '.') {
			const segs: string[] = [];
			let end = at.end;
			while (String(current().kind) === '.') {
				api.next();
				const seg = current();
				if (seg.kind !== 'ident')
					throw error('Expected a module path segment', seg);
				api.next();
				segs.push(text(seg));
				end = seg.end;
			}
			return { dot: true, segs, end };
		}
		api.backtrack(at);
		return undefined;
	}

	function requireLoader(tk: ScannerToken): ModuleLoader {
		if (!loader)
			throw error(
				'module references need a module-aware compile (compileFile)',
				tk,
			);
		return loader;
	}

	/** `(a, b) = @…` — bind each name directly to the module's export
	 * symbol, so references compile against the real definition. */
	function parseDestructureImport(
		open: ScannerToken,
		names: Token<'ident'>[],
	): NodeMap['import'] {
		const eq = current();
		api.next();
		const ref = parseModuleRef();
		if (!ref)
			throw error(
				'destructuring binds a module reference (`@lib` or `@.file`)',
				eq,
			);
		const { exports, types } = requireLoader(open).load(ref);
		for (const nameTk of names) {
			const name = text(nameTk);
			const sym = exports[name];
			const type = types[name];
			if (!sym && !type)
				throw error(`module does not export "${name}"`, nameTk);
			if (sym) symbolTable.set(name, sym);
			if (type) typesTable.set(name, type);
		}
		return { ...open, kind: 'import', children: [], end: ref.end };
	}

	/** Token lookahead for `(a, b) = …` — pure scan, no binding. */
	function scanDestructureNames(): Token<'ident'>[] | undefined {
		const first = current();
		if (first.kind !== 'ident') return undefined;
		const names: Token<'ident'>[] = [first];
		api.next();
		while (String(current().kind) === ',') {
			api.next();
			const n = current();
			if (n.kind !== 'ident') {
				api.backtrack(first);
				return undefined;
			}
			names.push(n);
			api.next();
		}
		if (String(current().kind) !== ')') {
			api.backtrack(first);
			return undefined;
		}
		api.next();
		if (String(current().kind) !== '=') {
			api.backtrack(first);
			return undefined;
		}
		// A single name `(a) = …` is ambiguous with a grouped assignment; only
		// a module-ref RHS (`@…`) makes it a destructure import.
		if (names.length < 2) {
			const eq = current();
			api.next();
			const isModule = String(current().kind) === '@';
			api.backtrack(eq);
			if (!isModule) {
				api.backtrack(first);
				return undefined;
			}
		}
		return names;
	}

	/**
	 * An unresolved ident in a deferred-execution region (fn body, `main`,
	 * `#test`) parses with a placeholder symbol and is re-resolved against
	 * the module scope at end of parse (forward refs / mutual recursion).
	 * The patch must reassign `node.symbol` — codegen maps are keyed by
	 * symbol identity. Top-level initializers run in source order, so
	 * misses there still throw.
	 */
	const forwardRefs: {
		node: NodeMap['ident'];
		token: Token<'ident'>;
		name: string;
		countRef: boolean;
	}[] = [];
	let deferDepth = 0;

	function deferred<T>(fn: () => T): T {
		deferDepth++;
		try {
			return fn();
		} finally {
			deferDepth--;
		}
	}

	function resolveForwardRefs() {
		for (const ref of forwardRefs) {
			const symbol = symbolTable.get(ref.name);
			if (symbol) {
				ref.node.symbol = symbol;
				if (ref.countRef) (symbol.references ||= []).push(ref.token);
			} else api.pushError(error('Identifier not defined', ref.token));
		}
		forwardRefs.length = 0;
	}

	/**
	 * After `:` has been consumed, parse the type slot.
	 * `var` is a slot-level access modifier (not a type).
	 */
	function slotType(
		symbol: SymbolMap['variable'],
		mode: 'field' | 'local' | 'parameter',
	) {
		if (current().kind === 'var') {
			if (mode === 'field')
				throw error(
					'`var` is valid only on local bindings and function parameters',
					current(),
				);
			api.next();
			if (mode === 'local') symbol.flags |= Flags.Variable;
			else symbol.ownership = 'var';
			return mode === 'local' && current().kind === '='
				? undefined
				: expectType();
		}
		if (current().kind === 'own') {
			if (mode !== 'parameter')
				throw error(
					'`own` is valid only on function parameters and results',
					current(),
				);
			api.next();
			symbol.ownership = 'own';
		}
		return expectType();
	}

	function resultType(): { mode: OwnershipMode; type: Node } {
		const mode =
			current().kind === 'var'
				? (api.next(), 'var' as const)
				: current().kind === 'own'
					? (api.next(), 'own' as const)
					: 'borrow';
		return { mode, type: expectType() };
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
			label: NodeMap['label'];
			symbol: SymbolMap['variable'];
			type?: Node;
			value?: Node;
		}) => N,
		valuePrec?: number,
		bindAfter?: boolean,
		mode: 'field' | 'local' | 'parameter' = 'field',
	): N {
		const name = text(ident);
		const symbol: SymbolMap['variable'] = bindAfter
			? { name, kind: 'variable', flags: 0 }
			: symbolTable.set(name, {
					name,
					kind: 'variable',
					flags: 0,
			  });
		if (mode === 'parameter') symbol.ownership = 'borrow';
		const type = optional(':') ? slotType(symbol, mode) : undefined;
		const value = optional('=')
			? expectNode(exprParser(valuePrec), 'Expected value')
			: undefined;
		if (bindAfter) symbolTable.set(name, symbol);
		const node = make({
			...ident,
			end: (value ?? type ?? ident).end,
			label: { ...ident, kind: 'label' },
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
			false,
			'parameter',
		);
	}

	function blockParameters(node: NodeMap['fn']) {
		node.parameters = parseList(parameter, ',', n => !!n);
		node.symbol.parameters = node.parameters.map(p => p.symbol);
		consume(')');
		node.children.push(...node.parameters);
	}

	function parseLambdaAfterOpenParen(tk: ScannerToken): NodeMap['fn'] {
		return parseBlock(tk, node => {
			blockParameters(node);
			if (optional(':')) {
				const result = resultType();
				const rt = result.type;
				// Bare `Void` here states nothing the body doesn't already:
				// return types are inferred. (`T | Void` and the `T:Void`
				// stage form carry meaning and stay.)
				if (
					rt.kind === 'typeident' &&
					rt.symbol.type.kind === 'type' &&
					rt.symbol.type.family === 'void'
				)
					throw error(
						'return types are inferred — a fn that produces no value needs no `: Void` annotation',
						rt,
					);
				node.returnOwnership = result.mode;
				node.symbol.returnOwnership = result.mode;
				node.children.push((node.returnType = rt));
			}
			consume('{');
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
			if (typeNode.kind === 'typeident') anonSym.type = typeNode.symbol.type;
			const result = optional(':') ? resultType() : undefined;
			const returnTypeNode = result?.type;
			// `T:R` asserts a real emitted type; "emits nothing" is inferred
			// from the body, so `T:Void` states nothing — same rule as fn
			// returns. (This was Void's last writable surface.)
			if (
				returnTypeNode?.kind === 'typeident' &&
				returnTypeNode.symbol.type.kind === 'type' &&
				returnTypeNode.symbol.type.family === 'void'
			)
				throw error(
					'return types are inferred — a stage that emits nothing needs no `:Void` annotation',
					returnTypeNode,
				);
			if (returnTypeNode) {
				node.returnType = returnTypeNode;
				node.returnOwnership = result.mode;
				node.symbol.returnOwnership = result.mode;
			}
			const param: NodeMap['parameter'] = {
				...tk,
				kind: 'parameter',
				symbol: anonSym,
				type: typeNode,
				children: [undefined, typeNode, returnTypeNode],
			};
			node.parameters = [param];
			node.children.push(param);
			consume('{');
			return parseFnBody(node);
		});
	}

	function parseFnBody(node: NodeMap['fn']): Node[] {
		const stmts = parseStatementBlock(statement, '}');
		node.end = consume('}').end;
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

	function numberNode(n: ScannerToken): NodeMap['number'] {
		const float = n.kind === 'float';
		const raw = text(n).replace(/_/g, '');
		let value: number | bigint = +raw;
		if (!float && !Number.isSafeInteger(value)) {
			value = BigInt(raw);
			if (value > (1n << 64n) - 1n)
				throw error('Integer literal is too large', n);
		}
		return { ...n, kind: 'number', value, float };
	}

	function prefixNumber(op: (n: number | bigint) => number | bigint) {
		return (n: UnaryNode<NodeMap>) => {
			const right = n.children[0];
			if (right.kind === 'number') {
				right.value = op(right.value);
				return right;
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
			node.statements = deferred(() => cb(node));
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
		const tk = consume('next');
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
		return tk.kind === 'done'
			? { ...tk, kind: 'done' }
			: { ...tk, kind: 'break' };
	}

	/**
	 * Parse a ternary branch: either a statement form (`next X`, `done`,
	 * `break`), or a value expression at the ternary precedence.
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
					true,
				);
			}
			api.backtrack(tk);
		}
		return expectNode(exprParser(), 'Expected expression');
	}

	function isLiteralValueData(typeNode: Node | undefined): boolean {
		if (!typeNode || typeNode.kind !== 'data') return false;
		const inner = typeNode.children[0];
		const items =
			inner?.kind === ',' ? inner.children : inner ? [inner] : [];
		const ms = items
			.map(item => (item.kind === 'propdef' ? item.symbol.type : undefined))
			.filter((t): t is Type => !!t);
		if (ms.length === 0) return false;
		return ms.every(
			t =>
				t.kind === 'type' &&
				t.family === 'literal' &&
				typeof t.value === 'number',
		);
	}

	const commaPrecedence = 1;
	const pipePrecedence = 1.5;
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
				precedence: pipePrecedence,
				infix(tk, left) {
					const right = expectExpression(pipePrecedence);
					const node: NodeMap['>>'] = {
						...tk,
						kind: '>>',
						start: left.start,
						end: right.end,
						children:
							left.kind === '>>'
								? [...left.children, right]
								: [left, right],
					};
					return node;
				},
			},
			'->': {
				precedence: pipePrecedence,
				infix(tk, left) {
					const right = expectExpression(pipePrecedence);
					if (right.kind !== 'call')
						throw error('`->` requires a function call on the right', right);
					const currentArgs = right.children[1];
					const prepended = left.kind === ',' ? left.children : [left];
					const existing =
						currentArgs?.kind === ','
							? currentArgs.children
							: currentArgs
								? [currentArgs]
								: [];
					const children = [...prepended, ...existing];
					const first = children[0];
					const last = children[children.length - 1];
					const args: Node | undefined =
						children.length === 1
							? first
							: first
								? {
										...tk,
										kind: ',',
										start: first.start,
										end: last?.end ?? first.end,
										children,
									}
								: undefined;
					return {
						...right,
						start: left.start,
						children: [right.children[0], args],
					};
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
			'<': {
				...infixOperator(9),
				prefix(tk: ScannerToken) {
					api.backtrack(tk);
					const tp = typeParameters(api, typesTable, typeParser);
					if (!tp) throw error('Expected type parameters', tk);
					const val = expectExpression(2);
					tp.pop();
					if (val.kind !== 'fn')
						throw error(
							'Type parameters must precede a function',
							tk,
						);
					val.typeParameters = tp.params;
					val.children = [tp.list, ...val.children];
					val.start = tk.start;
					return val;
				},
			},
			'>': infixOperator(9),
			'<=': infixOperator(9),
			'>=': infixOperator(9),
			'<:': infixOperator(10),
			':>': infixOperator(10),
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
			'%': infixOperator(12),
			'@': {
				prefix(tk) {
					if (loader) {
						api.backtrack(tk);
						const ref = parseModuleRef();
						if (ref) {
							const { symbol } = requireLoader(tk).load(ref);
							const node: NodeMap['ident'] = {
								...tk,
								kind: 'ident',
								symbol,
								end: ref.end,
							};
							return node;
						}
						api.next();
					}
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
					const right = consume('ident');
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
				precedence: commaPrecedence,
				infix(tk, left) {
					const right = expectExpression(commaPrecedence);
					const node: NodeMap[','] = {
						...tk,
						kind: ',',
						start: left.start,
						end: right.end,
						children:
							left.kind === ','
								? [...left.children, right]
								: [left, right],
					};
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
							type.symbol.type.kind === 'type' &&
							type.symbol.type.family !== 'literal' &&
							type.symbol.type.family !== 'union'
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
					const importNames = scanDestructureNames();
					if (importNames)
						return parseDestructureImport(tk, importNames);
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
					consume(')');
					return node;
				},
				infix(tk, left) {
					const cur = current();
					return {
						...tk,
						kind: 'call',
						children: [left, cur.kind === ')' ? undefined : expr()],
						start: left.start,
						end: consume(')').end,
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
						typeNode = typeParser(2);
					} catch {
						typeNode = undefined;
					}
					const hasLiteralValueMembers = isLiteralValueData(typeNode);
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
						end: consume(']').end,
					};
					return result;
				},
				infix(tk, left) {
					return {
						...tk,
						children: [left, expectExpression()],
						end: consume(']').end,
					};
				},
			},

			'?': {
				precedence: 2,
				infix(tk, left) {
					const truthy = parseBranchOrExpr(2);
					const falsy = optional(':')
						? parseBranchOrExpr(2)
						: undefined;
					const node: NodeMap['?'] = {
						...tk,
						kind: '?',
						start: left.start,
						end: (falsy ?? truthy).end,
						children: falsy ? [left, truthy, falsy] : [left, truthy],
					};
					return node;
				},
			},

			loop: {
				prefix: n => n,
			},
			number: { prefix: n => numberNode(n) },
			float: { prefix: n => numberNode(n) },
			string: { prefix: n => n },
			strhead: {
				prefix(tk) {
					const chunk = (t: ScannerToken) =>
						text(t).slice(1, t.kind === 'strtail' ? -1 : -2);
					const strings: string[] = [chunk(tk)];
					const children: Node[] = [];
					for (;;) {
						children.push(expectExpression());
						const cont = current();
						if (cont.kind === 'strmid') {
							strings.push(chunk(cont));
							api.next();
							continue;
						}
						if (cont.kind !== 'strtail')
							throw error(
								'Unterminated string interpolation',
								cont,
							);
						strings.push(chunk(cont));
						api.next();
						const node: NodeMap['interp'] = {
							...tk,
							kind: 'interp',
							children,
							strings,
							end: cont.end,
						};
						return node;
					}
				},
			},
			ident: {
				prefix: n => {
					const name = text(n);
					const symbol = symbolTable.getWithReference(name, n);
					if (symbol) return { ...n, symbol };
					if (typesTable.get(name)) {
						const savedErrors = api.errors.length;
						const savedRefs = forwardRefs.length;
						api.backtrack(n);
						let typeNode: Node | undefined;
						try {
							typeNode = typeParser(2);
						} catch {
							typeNode = undefined;
						}
						if (typeNode && current().kind === '{')
							return parseAnonymousSlotBlock(n, typeNode);
						if (typeNode && current().kind === ':')
							return parseAnonymousSlotBlock(n, typeNode);
						if (typeNode && current().kind === '(')
							return typeNode;
						api.errors.length = savedErrors;
						forwardRefs.length = savedRefs;
						api.backtrack(n);
						api.next();
					}
					const tk = current();
					if (tk.kind !== '=' && tk.kind !== ':') {
						if (deferDepth) {
							const node: NodeMap['ident'] = {
								...n,
								symbol: { name, kind: 'variable', flags: 0 },
							};
							forwardRefs.push({
								node,
								token: n,
								name,
								countRef: !symbolTable.ignoreReferences,
							});
							return node;
						}
						throw error('Identifier not defined', n);
					}
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
	 * Parses a definition statement (`var` is a type modifier, not a
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
		// (Shadowing is impossible by construction: `=` always assigns the
		// visible binding, and typed declarations reject any visible name.)
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
		}, undefined, false, 'local');
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

	return { statement, deferred, resolveForwardRefs };
}
