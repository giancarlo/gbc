import { ParserApi, type Token, parserTable, text } from '../sdk/index.js';

import { syntheticNext, type Node, type NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';
import {
	AnyData,
	BufferSymbol,
	VectorSymbol,
	Flags,
	bufferTypeOf,
	vectorTypeOf,
	fixedEmissionType,
	restEmissionType,
} from './symbol-table.js';
import type {
	OwnershipMode,
	ResolvedType,
	TypeSymbol,
	Symbol,
	SymbolMap,
	Type,
	SymbolTable,
	TypesSymbolTable,
} from './symbol-table.js';
import type { ModuleLoader } from './parser.js';

export function parseType(
	api: ParserApi<ScannerToken>,
	symbolTable: TypesSymbolTable,
	valueSymbols: SymbolTable,
	loader?: ModuleLoader,
) {
	const { current, optional } = api;

	function expectSymbol(name: string, tk: Token<'ident'>) {
		const symbol = symbolTable.get(name);
		if (!symbol) throw api.error('Type not defined', tk);
		const node: NodeMap['typeident'] = { ...tk, kind: 'typeident', symbol };
		(symbol.references ||= []).push(node);
		return node;
	}

	function expectModuleType(
		namespace: Symbol | undefined,
		moduleToken: Token<ScannerToken['kind']>,
		memberToken: Token<'ident'>,
	): NodeMap['typeident'] {
		const type = namespace?.type;
		if (
			!namespace ||
			!(namespace.flags & Flags.Module) ||
			type?.kind !== 'type' ||
			type.family !== 'data'
		)
			throw api.error('Type qualifier is not a module', moduleToken);
		const symbol = type.moduleTypes?.[text(memberToken)];
		if (!symbol)
			throw api.error(
				`Module does not export type "${text(memberToken)}"`,
				memberToken,
			);
		const node: NodeMap['typeident'] = {
			...memberToken,
			start: moduleToken.start,
			kind: 'typeident',
			symbol,
		};
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

	function nodeType(node: Node | undefined): Type | undefined {
		if (!node) return;
		if (node.kind === 'typeident') return node.symbol.type;
		if (node.kind === 'fn') return node.symbol;
	}

	function emissionType(types: Type[]): Type | undefined {
		const first = types[0];
		if (!first) return;
		if (types.every(type => type === first)) return first;
		const members = new Map<string, ResolvedType>();
		for (const type of types) {
			if (type.kind !== 'type') continue;
			if (type.family === 'union')
				for (const member of type.members)
					if (member.kind === 'type')
						members.set(member.name, member);
			else members.set(type.name, type);
		}
		const values = Array.from(members.values());
		if (values.length === 1) return values[0];
		return {
			kind: 'type',
			flags: 0,
			family: 'union',
			name: values.map(type => type.name).join(' | '),
			size: Math.max(...values.map(type => type.size)),
			members: values,
		};
	}

	function functionReturn(
		expression: (precedence?: number) => Node | undefined,
	): {
		returnOwnership?: OwnershipMode;
		returnOwnerships?: OwnershipMode[];
		returnVariantOwnerships?: OwnershipMode[][];
		returnType?: Node;
		returnTypes?: Node[];
		returnRestType?: Node;
		returnRestOwnership?: OwnershipMode;
		returnVariants?: Node[][];
	} {
		if (!optional(':')) return {};
		const arms: ReturnType<typeof functionReturnArm>[] = [];
		do arms.push(functionReturnArm(expression));
		while (optional('|'));
		const first = arms[0];
		if (arms.length === 1) return functionReturnSingle(first);
		const scalars = arms.map(arm => arm.types[0]);
		if (
			scalars.every(
				(node): node is NodeMap['typeident'] =>
					node?.kind === 'typeident' &&
					node.symbol.type.kind === 'type' &&
					node.symbol.type.family !== 'emission',
			)
		)
			return {
				returnOwnership: first?.ownerships[0],
				returnType: unionNode(scalars),
			};
		throw api.error(
			'Function results must have one fixed emission layout; use a union within an emission position',
			scalars[0] ?? current(),
		);
	}

	function functionReturnArm(
		expression: (precedence?: number) => Node | undefined,
	): {
		types: Node[];
		ownerships: OwnershipMode[];
		restType?: Node;
		restOwnership?: OwnershipMode;
	} {
		if (current().kind !== '{') {
			const ownership = resultOwnership();
			return {
				ownerships: [ownership],
				types: [api.expectNode(expression(5), 'Expected return type')],
			};
		}
		const open = api.consume('{');
		const types: Node[] = [];
		const ownerships: OwnershipMode[] = [];
		let restType: Node | undefined;
		let restOwnership: OwnershipMode | undefined;
		if (current().kind !== '}') {
			for (;;) {
				const rest = optional('...');
				const ownership = resultOwnership();
				const type = api.expectNode(expression(), 'Expected return type');
				if (rest) {
					const resolved = nodeType(type);
					if (
						resolved?.kind === 'type' &&
						(resolved.family === 'void' || resolved.family === 'emission')
					)
						throw api.error(
							resolved.family === 'void'
								? 'Void cannot be a rest emission type'
								: 'Nested emission sequences are not allowed',
							type,
						);
					restType = type;
					restOwnership = ownership;
					if (current().kind !== '}')
						throw api.error('Rest emission must be the final element', current());
				} else {
					ownerships.push(ownership);
					types.push(type);
				}
				if (!optional(',')) break;
			}
		}
		api.consume('}');
		if (!restType && types.length < 2)
			throw api.error(
				types.length === 0
					? 'Use `Void` for a function that emits nothing'
					: 'Use the element type directly for one emission',
				open,
			);
		return { ownerships, types, restType, restOwnership };
	}

	function functionReturnSingle(
		arm: ReturnType<typeof functionReturnArm> | undefined,
	): ReturnType<typeof functionReturn> {
		if (!arm) return {};
		if (arm.restType)
			return {
				returnOwnership: arm.ownerships[0] ?? arm.restOwnership,
				returnOwnerships: arm.ownerships,
				returnTypes: arm.types,
				returnRestType: arm.restType,
				returnRestOwnership: arm.restOwnership,
			};
		if (arm.types.length === 1)
			return {
				returnOwnership: arm.ownerships[0],
				returnType: arm.types[0],
			};
		return {
			returnOwnership: arm.ownerships[0],
			returnOwnerships: arm.ownerships,
			returnTypes: arm.types,
		};
	}

	function unionNode(nodes: NodeMap['typeident'][]): NodeMap['typeident'] {
		const types = nodes.map(node => node.symbol.type);
		const type = emissionType(types);
		const first = nodes[0];
		if (!first || type?.kind !== 'type')
			throw new Error('Invalid function return union');
		const last = nodes[nodes.length - 1];
		return {
			...first,
			end: last?.end ?? first.end,
			symbol: resolvedSymbol(type),
		};
	}

	function resolvedFunctionReturn(
		returnType: Node | undefined,
		returnTypes: Node[] | undefined,
		returnRestType: Node | undefined,
		returnOwnership?: OwnershipMode,
		returnOwnerships?: OwnershipMode[],
		returnRestOwnership?: OwnershipMode,
		returnVariants?: Node[][],
	): Pick<
		SymbolMap['function'],
		| 'emissionType'
		| 'returnType'
		| 'returnTypes'
		| 'returnVariants'
		| 'returnOwnerships'
	> {
		const variants = returnVariants?.map(variant =>
			variant.map(nodeType).filter((type): type is Type => !!type),
		);
		if (variants)
			return {
				returnType: emissionType(variants.flat()),
				returnVariants: variants,
			};
		const sequence = returnTypes
			?.map(nodeType)
			.filter((type): type is Type => !!type);
		const rest = nodeType(returnRestType);
		if (sequence && rest)
			return {
				emissionType: restEmissionType(
					sequence,
					returnOwnerships ?? [],
					rest,
					returnRestOwnership,
				),
				returnType: emissionType([...sequence, rest]),
				returnTypes: sequence,
				returnOwnerships,
			};
		if (sequence)
			return {
				emissionType: fixedEmissionType(sequence, returnOwnerships),
				returnType: emissionType(sequence),
				returnTypes: sequence,
				returnOwnerships,
			};
		const single = nodeType(returnType);
		if (!single) return {};
		if (single.kind === 'type' && single.family === 'emission')
			return {
				emissionType: single,
				returnType: emissionType(single.elements),
				returnTypes: single.elements,
				returnOwnerships: single.ownerships,
			};
		if (single.kind === 'type' && single.family === 'void')
			return {
				emissionType: fixedEmissionType([]),
				returnType: single,
				returnTypes: [],
				returnOwnerships: [],
			};
		return {
			emissionType: fixedEmissionType([single], [returnOwnership ?? 'borrow']),
			returnType: single,
			returnTypes: [single],
		};
	}

	function functionParameters(
		expression: (precedence?: number) => Node | undefined,
	): { named: boolean; params: NodeMap['parameter'][] } {
		const params: NodeMap['parameter'][] = [];
		let named = false;
		if (current().kind === ')') return { named, params };
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
			const type = api.expectNode(expression(), 'Expected parameter type');
			const label: NodeMap['label'] | undefined = labelTok
				? { ...labelTok, kind: 'label' }
				: undefined;
			params.push({
				start: type.start,
				end: type.end,
				line: type.line,
				source: type.source,
				kind: 'parameter',
				label,
				symbol: {
					kind: 'variable',
					name: labelTok ? text(labelTok) : '',
					flags: 0,
					ownership,
					type: nodeType(type),
				},
				type,
				value: undefined,
				children: [label, type, undefined],
			});
		} while (optional(','));
		return { named, params };
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
			return {
				...t,
				elem: substituteType(t.elem, subst),
				components: t.components?.map(component =>
					substituteType(component, subst),
				),
			};
		if (t.family === 'vector')
			return {
				...t,
				elem: substituteType(t.elem, subst),
			};
		if (t.family === 'union')
			return { ...t, members: t.members.map(m => substituteType(m, subst)) };
		if (t.family === 'emission')
			return {
				...t,
				elements: t.elements.map(element => substituteType(element, subst)),
				rest: t.rest ? substituteType(t.rest, subst) : undefined,
			};
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
		if (sym === VectorSymbol) {
			const a = argNodes[0];
			const elem = a?.kind === 'typeident' ? a.symbol.type : AnyData;
			return {
				...node,
				symbol: {
					kind: 'type',
					name: sym.name,
					flags: 0,
					type: vectorTypeOf(elem),
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
					if (current().kind === '.') {
						const namespace = valueSymbols.get(name);
						if ((namespace?.flags ?? 0) & Flags.Module) {
							api.next();
							const node = expectModuleType(
								namespace,
								n,
								consume('ident'),
							);
							if (
								node.symbol.typeParams?.length &&
								current().kind === '<'
							)
								return applyTypeArgs(node, node.symbol, expression);
							return node;
						}
					}
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
			'@': {
				prefix(tk) {
					const moduleToken = consume('ident');
					const name = text(moduleToken);
					const namespace =
						valueSymbols.get(`@${name}`) ??
						loader?.load({ dot: false, segs: [name] }).symbol;
					consume('.');
					const node = expectModuleType(
						namespace,
						tk,
						consume('ident'),
					);
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
					const { named, params } = functionParameters(expression);
					const close = consume(')');
					const {
						returnOwnership,
						returnOwnerships,
						returnRestOwnership,
						returnVariantOwnerships,
						returnType,
						returnTypes,
						returnRestType,
						returnVariants,
					} = functionReturn(expression);
					// A single unnamed type with no return is a parenthesized
					// type, not a function type: `(T)` == `T`.
					if (
						!returnType &&
						!returnTypes &&
						!returnRestType &&
						!returnVariants &&
						!named &&
						params.length === 1
					) {
						const only = params[0];
						if (only?.type) return only.type;
					}
					const resolvedReturn = resolvedFunctionReturn(
						returnType,
						returnTypes,
						returnRestType,
						returnOwnership,
						returnOwnerships,
						returnRestOwnership,
						returnVariants,
					);
					const fnSymbol: SymbolMap['function'] = {
						kind: 'function',
						name: '',
						flags: 0,
						parameters: params.map(p => p.symbol),
						...resolvedReturn,
						returnOwnership,
						returnOwnerships:
							returnOwnerships ?? resolvedReturn.returnOwnerships,
						returnVariantOwnerships,
					};
					setReturnBorrowOrigins(fnSymbol, params);
					return {
						...tk,
						kind: 'fn',
						end: (returnRestType ?? returnVariants?.flat().at(-1) ?? returnTypes?.at(-1) ?? returnType ?? close).end,
						parameters: params,
						returnType,
						returnTypes,
						returnRestType,
						returnVariants,
						returnOwnership,
						returnOwnerships,
						returnRestOwnership,
						returnVariantOwnerships,
						symbol: fnSymbol,
						children: [
							...params,
							...(returnVariants?.flat() ??
								returnTypes ??
								(returnType ? [returnType] : [])),
							...(returnRestType ? [returnRestType] : []),
						],
					};
				},
			},
			'{': {
				prefix(tk) {
					const types: Type[] = [];
					const ownerships: OwnershipMode[] = [];
					let rest: Type | undefined;
					let restOwnership: OwnershipMode | undefined;
					if (current().kind !== '}') {
						for (;;) {
							const isRest = optional('...');
							const ownership = resultOwnership();
							const node = expectNode(expression(), 'Expected emission type');
							const type = nodeType(node);
							if (!type) throw api.error('Expected emission type', node);
							if (type.kind === 'type' && type.family === 'emission')
								throw api.error('Nested emission sequences are not allowed', node);
							if (isRest) {
								if (type.kind === 'type' && type.family === 'void')
									throw api.error('Void cannot be a rest emission type', node);
								rest = type;
								restOwnership = ownership;
								if (current().kind !== '}')
									throw api.error('Rest emission must be the final element', current());
							} else {
								ownerships.push(ownership);
								types.push(type);
							}
							if (!optional(',')) break;
						}
					}
					const close = consume('}');
					if (!rest && types.length < 2)
						throw api.error(
							types.length === 0
								? 'Use `Void` for a function that emits nothing'
								: 'Use the element type directly for one emission',
							tk,
						);
					return {
						...tk,
						kind: 'typeident',
						end: close.end,
						symbol: resolvedSymbol(
							rest
								? restEmissionType(
										types,
										ownerships,
										rest,
										restOwnership,
								  )
								: fixedEmissionType(types, ownerships),
						),
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
					if (
						members.some(
							member => member.kind === 'type' && member.family === 'emission',
						)
					)
						throw api.error(
							'Emission sequences cannot be unioned; use a union within an emission position',
							tk,
						);
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
					const stageSymbol: SymbolMap['function'] = {
						kind: 'function',
						name: '',
						flags: Flags.None,
					};
					const emission = syntheticNext(body, stageSymbol);
					const stage: NodeMap['fn'] = {
						...tk,
						kind: 'fn',
						parameters: [slot],
						statements: [emission],
						symbol: stageSymbol,
						children: [slot, emission],
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
