import { ParserApi, Token, parserTable, text } from '../sdk/index.js';

import type { Node, NodeMap } from './node.js';
import type { ScannerToken } from './scanner.js';
import type {
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

	function collectUnionMembers(n: Node, out: Type[]) {
		if (n.kind !== 'typeident') return;
		const s = n.symbol;
		if (s.kind !== 'type') return;
		if (s.family === 'union') for (const m of s.members) out.push(m);
		else out.push(s);
	}

	const parser = parserTable<NodeMap, ScannerToken>(
		({ expect, expression, expectNode }) => ({
			ident: {
				prefix(n) {
					return expectSymbol(text(n), n);
				},
			},
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
			// String literal as a type (D14): `'on' | 'off'` etc.
			string: {
				prefix(tk) {
					const raw = text(tk);
					return {
						...tk,
						kind: 'typeident',
						symbol: {
							kind: 'type',
							flags: 0,
							family: 'literal',
							name: raw,
							size: 0,
							value: raw.slice(1, -1),
						},
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
					return {
						...tk,
						kind: 'typeident',
						start: left.start,
						end: right.end,
						symbol: {
							kind: 'type',
							flags: 0,
							family: 'union',
							name: '',
							size: 4,
							members,
						},
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
			'[': {
				prefix(tk) {
					const propdefs: NodeMap['propdef'][] = [];
					if (current().kind !== ']') {
						do {
							const ident = expect('ident');
							expect(':');
							const pt = expectNode(
								expression(),
								'Expected member type',
							);
							if (pt.kind !== 'typeident')
								throw api.error('Expected typeident', ident);
							const sym: SymbolMap['variable'] = {
								kind: 'variable',
								name: text(ident),
								flags: 0,
								type: pt.symbol,
							};
							const label: NodeMap['ident'] = {
								...ident,
								symbol: sym,
							};
							propdefs.push({
								...ident,
								kind: 'propdef',
								label,
								type: pt,
								children: [label, pt, undefined],
							});
						} while (optional(','));
					}
					const close = expect(']');
					const inner: NodeMap[','] | NodeMap['propdef'] =
						propdefs.length === 1
							? propdefs[0]!
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
			// Function type literal: `fn(name: Type, ...): ReturnType`.
			// The whole signature is represented as a single typeident
			// whose symbol is a function symbol carrying parameters
			// and returnType. Consumers (e.g. `external` declarations)
			// pull the function info from `symbol`.
			fn: {
				prefix(tk) {
					expect('(');
					const params: SymbolMap['variable'][] = [];
					if (current().kind !== ')') {
						do {
							const ident = expect('ident');
							expect(':');
							const pt = expectNode(
								expression(),
								'Expected parameter type',
							);
							if (pt.kind !== 'typeident')
								throw api.error(
									'Expected typeident',
									ident,
								);
							params.push({
								kind: 'variable',
								name: text(ident),
								flags: 0,
								type: pt.symbol,
							});
						} while (optional(','));
					}
					const closeParen = expect(')');
					let returnType: Type | undefined;
					let end = closeParen.end;
					if (optional(':')) {
						const rt = expectNode(
							expression(),
							'Expected return type',
						);
						if (rt.kind !== 'typeident')
							throw api.error(
								'Expected return typeident',
								closeParen,
							);
						returnType = rt.symbol;
						end = rt.end;
					}
					const fnSymbol: SymbolMap['function'] = {
						kind: 'function',
						name: '',
						flags: 0,
						parameters: params,
						returnType,
					};
					return {
						...tk,
						kind: 'typeident',
						end,
						symbol: fnSymbol,
					};
				},
			},
		}),
	);
	return parser(api);
}
