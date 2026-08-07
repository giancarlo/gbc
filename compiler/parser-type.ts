import { ParserApi, Token, parserTable, text } from '../sdk/index.js';

import type { Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';
import {
	AnyData,
	BufferSymbol,
	Flags,
	bufferTypeOf,
} from './symbol-table.js';
import type {
	OwnershipMode,
	TypeSymbol,
	Symbol,
	SymbolMap,
	Type,
	TypesSymbolTable,
} from './symbol-table.js';

export function parseType(
	api: ParserApi<ScannerToken>,
	symbolTable: TypesSymbolTable,
) {
	const { current, optional } = api;

	function expectSymbol(name: string, tk: Token<'ident'>) {
		const symbol = symbolTable.get(name);
		if (!symbol) throw api.error('Type not defined', tk);
		const node: NodeMap['typeident'] = { ...tk, kind: 'typeident', symbol };
		(symbol.references ||= []).push(node);
		return node;
	}

	function resolvedSymbol(type: Type): TypeSymbol {
		return { kind: 'type', name: type.name, flags: 0, type };
	}

	function slotOwnership(): OwnershipMode {
		if (current().kind === 'own') {
			api.next();
			return 'own';
		}
		if (current().kind === 'var') {
			api.next();
			return 'var';
		}
		return 'borrow';
	}

	function resultOwnership(): OwnershipMode {
		if (current().kind === 'var') return api.next(), 'var';
		return current().kind === 'own' ? (api.next(), 'own') : 'borrow';
	}

	function setReturnBorrowOrigins(
		fn: SymbolMap['function'],
		params: NodeMap['parameter'][],
	): void {
		if (fn.returnOwnership !== 'var') return;
		fn.returnBorrowOrigins = params
			.map((parameter, index) =>
				parameter.symbol.ownership === 'var' ? index : -1,
			)
			.filter(index => index >= 0);
	}

	function collectUnionMembers(n: Node, out: Type[]) {
		if (n.kind !== 'typeident') return;
		const s = n.symbol.type;
		if (s.kind !== 'type') return;
		if (s.family === 'union') for (const m of s.members) out.push(m);
		else out.push(s);
	}

	function substituteType(t: Type, subst: Map<string, Type>): Type {
		if (t.kind !== 'type') return t;
		if (t.family === 'unknown' && t.name) {
			const sub = subst.get(t.name);
			if (sub !== undefined) return sub;
		}
		if (t.family === 'data') {
			const members: Record<string, Symbol> = {};
			for (const [k, m] of Object.entries(t.members))
				members[k] =
					m.kind === 'variable' && m.type
						? { ...m, type: substituteType(m.type, subst) }
						: m;
			return { ...t, members };
		}
		if (t.family === 'buffer')
			return bufferTypeOf(substituteType(t.elem, subst));
		if (t.family === 'union')
			return { ...t, members: t.members.map(m => substituteType(m, subst)) };
		return t;
	}

	function applyTypeArgs(
		node: NodeMap['typeident'],
		sym: TypeSymbol,
		expression: () => Node | undefined,
	): NodeMap['typeident'] {
		const params = sym.typeParams ?? [];
		api.next(); // consume `<`
		const argNodes: Node[] = [];
		do {
			const a = expression();
			if (a) argNodes.push(a);
		} while (api.optional(','));
		api.consume('>');
		if (argNodes.length !== params.length)
			throw api.error(
				`type "${sym.name}" expects ${params.length} type argument(s), got ${argNodes.length}`,
				node,
			);
		// `Buffer<T>` builds a runtime-length collection type whose `elem` is the
		// argument (a type param placeholder for a generic `Buffer<T>` param —
		// substituted at monomorphization).
		if (sym === BufferSymbol) {
			const a = argNodes[0];
			const elem = a?.kind === 'typeident' ? a.symbol.type : AnyData;
			return {
				...node,
				symbol: {
					kind: 'type',
					name: sym.name,
					flags: 0,
					type: bufferTypeOf(elem),
				},
			};
		}
		// Chain-defined or forward-declared recursive type functions
		// reduce on demand in the checker — defer as an application symbol
		// carrying the arg nodes (composes inside unions/data). Concrete
		// data/union aliases substitute eagerly here.
		if (sym.type.kind === 'type' && sym.type.family === 'unknown') {
			const appSym: Type = {
				kind: 'type',
				flags: 0,
				name: sym.name ?? '',
				family: 'unknown',
				size: 4,
				application: { fn: sym, argNodes },
			};
			return {
				...node,
				symbol: {
					kind: 'type',
					name: sym.name,
					flags: 0,
					type: appSym,
				},
			};
		}
		const subst = new Map<string, Type>();
		params.forEach((p, i) => {
			const a = argNodes[i];
			if (p.name && a?.kind === 'typeident') subst.set(p.name, a.symbol.type);
		});
		return {
			...node,
			symbol: {
				kind: 'type',
				name: sym.name,
				flags: 0,
				type: substituteType(sym.type, subst),
			},
		};
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({ consume, expression, expectNode }) => ({
			ident: {
				prefix(n) {
					const name = text(n);
					if (name === 'true' || name === 'false') {
						return {
							...n,
							kind: 'typeident',
							symbol: {
								kind: 'type',
								name,
								flags: 0,
								type: {
									kind: 'type',
									flags: 0,
									family: 'literal',
									name,
									size: 1,
									value: name === 'true',
								},
							},
						};
					}
					const node = expectSymbol(name, n);
					// Generic type application `Name<arg, ...>`.
					if (
						node.symbol.typeParams?.length &&
						current().kind === '<'
					)
						return applyTypeArgs(node, node.symbol, expression);
					return node;
				},
			},
			'(': {
				prefix(tk) {
					const params: NodeMap['parameter'][] = [];
					let named = false;
					if (current().kind !== ')') {
						do {
							let labelTok: Token<'ident'> | undefined;
							const first = current();
							if (first.kind === 'ident') {
								api.next();
								if (current().kind === ':') {
									labelTok = first;
									named = true;
									api.next();
								} else api.backtrack(first);
							}
							const ownership = slotOwnership();
							const pt = expectNode(
								expression(),
								'Expected parameter type',
							);
							const labelNode: NodeMap['label'] | undefined =
								labelTok
									? { ...labelTok, kind: 'label' }
									: undefined;
							params.push({
								start: pt.start,
								end: pt.end,
								line: pt.line,
								source: pt.source,
								kind: 'parameter',
								label: labelNode,
								symbol: {
									kind: 'variable',
									name: labelTok ? text(labelTok) : '',
									flags: 0,
									ownership,
									type:
										pt.kind === 'typeident'
											? pt.symbol.type
											: undefined,
								},
								type: pt,
								value: undefined,
								children: [labelNode, pt, undefined],
							});
						} while (optional(','));
					}
					const close = consume(')');
					let returnOwnership: OwnershipMode | undefined;
					const returnType = optional(':')
						? ((returnOwnership = resultOwnership()),
							expectNode(expression(), 'Expected return type'))
						: undefined;
					// A single unnamed type with no return is a parenthesized
					// type, not a function type: `(T)` == `T`.
					if (!returnType && !named && params.length === 1) {
						const only = params[0];
						if (only?.type) return only.type;
					}
					const fnSymbol: SymbolMap['function'] = {
						kind: 'function',
						name: '',
						flags: 0,
						parameters: params.map(p => p.symbol),
						returnType:
							returnType?.kind === 'typeident'
								? returnType.symbol.type
								: undefined,
						returnTypes:
							returnType?.kind === 'typeident'
								? returnType.symbol.type.kind === 'type' &&
									returnType.symbol.type.family === 'void'
									? []
									: [returnType.symbol.type]
								: undefined,
						returnOwnership,
					};
					setReturnBorrowOrigins(fnSymbol, params);
					return {
						...tk,
						kind: 'fn',
						end: (returnType ?? close).end,
						parameters: params,
						returnType,
						returnOwnership,
						symbol: fnSymbol,
						children: returnType
							? [...params, returnType]
							: [...params],
					};
				},
			},
			// String literal as a type: `'on' | 'off'` etc.
			string: {
				prefix(tk) {
					const raw = text(tk);
					return {
						...tk,
						kind: 'typeident',
						symbol: resolvedSymbol({
							kind: 'type',
							flags: 0,
							family: 'literal',
							name: raw,
							size: 0,
							value: raw.slice(1, -1),
						}),
					};
				},
			},
			number: {
				prefix(tk) {
					const raw = text(tk).replace(/_/g, '');
					return {
						...tk,
						kind: 'typeident',
						symbol: resolvedSymbol({
							kind: 'type',
							flags: 0,
							family: 'literal',
							name: raw,
							size: 4,
							value: +raw,
						}),
					};
				},
			},
			'|': {
				precedence: 5,
				infix(tk, left) {
					const right = expectNode(
						expression(5),
						'Expected type after `|`',
					);
					const members: Type[] = [];
					collectUnionMembers(left, members);
					collectUnionMembers(right, members);
					if (members.some(m => m.kind === 'type' && m.family === 'void'))
						throw api.error(
							'Void is the union identity; remove the redundant `Void` arm',
							tk,
						);
					return {
						...tk,
						kind: 'typeident',
						start: left.start,
						end: right.end,
						symbol: resolvedSymbol({
							kind: 'type',
							flags: 0,
							family: 'union',
							name: '',
							size: 4,
							members,
						}),
					};
				},
			},
			'&': {
				precedence: 6,
				infix(tk, left) {
					const right = expectNode(
						expression(6),
						'Expected type after `&`',
					);
					const result: NodeMap['&'] = {
						...tk,
						kind: '&',
						start: left.start,
						end: right.end,
						children: [left, right],
					};
					return result;
				},
			},
			'>>': {
				precedence: 1,
				infix(tk, left) {
					consume('[');
					const scope = symbolTable.push();
					const binds: NodeMap['parameter'][] = [];
					do {
						const bid = api.consume('ident');
						const bname = text(bid);
						symbolTable.set(bname, {
							kind: 'type',
							name: bname,
							flags: 0,
							type: {
								kind: 'type',
								name: bname,
								flags: 0,
								family: 'unknown',
								size: 4,
							},
						});
						const blabel: NodeMap['label'] = { ...bid, kind: 'label' };
						binds.push({
							...bid,
							kind: 'parameter',
							label: blabel,
							symbol: { kind: 'variable', name: bname, flags: 0 },
							type: undefined,
							value: undefined,
							children: [blabel, undefined, undefined],
						});
					} while (api.optional(','));
					const close = consume(']');
					const firstBind = binds[0];
					const lastBind = binds[binds.length - 1];
					if (!firstBind || !lastBind)
						throw api.error('Expected at least one binding', tk);
					const inner: NodeMap[','] = {
						...firstBind,
						kind: ',',
						end: lastBind.end,
						children: binds,
					};
					const pattern: NodeMap['data'] = {
						...firstBind,
						kind: 'data',
						end: close.end,
						children: [inner],
					};
					const slot: NodeMap['parameter'] = {
						...tk,
						kind: 'parameter',
						label: undefined,
						symbol: { kind: 'variable', name: '', flags: 0 },
						type: pattern,
						value: undefined,
						children: [undefined, pattern, undefined],
					};
					consume('{');
					const body = expectNode(expression(), 'Expected stage body');
					const end = consume('}').end;
					symbolTable.pop(scope);
					const stage: NodeMap['fn'] = {
						...tk,
						kind: 'fn',
						parameters: [slot],
						statements: [body],
						symbol: {
							kind: 'function',
							name: '',
							flags: Flags.Sequence,
						},
						children: [slot, body],
						end,
					};
					return {
						...tk,
						kind: '>>',
						start: left.start,
						end,
						children: [left, stage],
					};
				},
			},
			'[': {
				prefix(tk) {
					if (current().kind === ']') {
						const close = consume(']');
						return {
							...tk,
							kind: 'typeident',
							symbol: resolvedSymbol(AnyData),
							end: close.end,
						};
					}
					const propdefs: NodeMap['propdef'][] = [];
					do {
						let label: Token<'ident'> | undefined;
						const first = current();
						if (first.kind === 'ident') {
							api.next();
							if (current().kind === ':') {
								label = first;
								api.next();
							} else api.backtrack(first);
						}
						if (current().kind === 'var')
							throw api.error(
								'`var` is valid only on local bindings and function parameters',
								current(),
							);
						if (current().kind === 'own')
							throw api.error(
								'`own` is valid only on function parameters and results',
								current(),
							);
						const pt = expectNode(
							expression(),
							'Expected member type',
						);
						if (pt.kind !== 'typeident' && pt.kind !== 'fn')
							throw api.error('Expected member type', first);
						const sym: SymbolMap['variable'] = {
							kind: 'variable',
							name: label ? text(label) : '',
							flags: 0,
							type:
								pt.kind === 'typeident'
									? pt.symbol.type
									: pt.symbol,
						};
						const labelNode: NodeMap['label'] | undefined = label
							? { ...label, kind: 'label' }
							: undefined;
						propdefs.push({
							...(label ?? pt),
							kind: 'propdef',
							label: labelNode,
							symbol: sym,
							type: pt,
							children: [labelNode, pt, undefined],
						});
					} while (optional(','));
					const close = consume(']');
					const first = propdefs[0];
					const inner: NodeMap[','] | NodeMap['propdef'] =
						propdefs.length === 1 && first
							? first
							: {
									...tk,
									kind: ',',
									children: propdefs,
								};
					const result: NodeMap['data'] = {
						...tk,
						kind: 'data',
						children: [inner],
						end: close.end,
					};
					return result;
				},
			},
		}),
	);
	return parser(api);
}

// Parse `<T, U: Constraint, ...>`, registering each param as a
// placeholder type in a pushed scope (caller pops after parsing the body).
// Returns the param nodes plus a `,` list node wrapping them (the single
// typeParameters child shared by `type X<...>` and value `<...>(`).
export function typeParameters(
	api: ParserApi<ScannerToken>,
	symbolTable: TypesSymbolTable,
	parseTypeExpr: () => Node | undefined,
):
	| { params: NodeMap['parameter'][]; list: NodeMap[',']; pop: () => void }
	| undefined {
	const lt = api.optional('<');
	if (!lt) return undefined;
	const scope = symbolTable.push();
	const params: NodeMap['parameter'][] = [];
	do {
		const pid = api.consume('ident');
		const name = text(pid);
		const placeholder: Type = {
			kind: 'type',
			name,
			flags: 0,
			family: 'unknown',
			size: 4,
		};
		symbolTable.set(name, {
			kind: 'type',
			name,
			flags: 0,
			type: placeholder,
		});
		const constraint = api.optional(':') ? parseTypeExpr() : undefined;
		const labelNode: NodeMap['label'] = { ...pid, kind: 'label' };
		// symbol.type is the placeholder (same object value params bind to, so
		// monomorphization substitutes one place). The constraint lives on the
		// `type` node for the checker.
		params.push({
			...pid,
			kind: 'parameter',
			label: labelNode,
			symbol: {
				kind: 'variable',
				name,
				flags: 0,
				type: placeholder,
			},
			type: constraint,
			value: undefined,
			children: [labelNode, constraint, undefined],
		});
	} while (api.optional(','));
	api.consume('>');
	const firstParam = params[0];
	const lastParam = params[params.length - 1];
	if (!firstParam || !lastParam)
		throw api.error('Expected at least one type parameter', lt);
	const list: NodeMap[','] = {
		...lt,
		kind: ',',
		start: firstParam.start,
		end: lastParam.end,
		children: params,
	};
	return { params, list, pop: () => symbolTable.pop(scope) };
}
