import { ParserApi, Token, text } from '../sdk/index.js';

import { parseExpression } from './parser-expression.js';
import { parseType } from './parser-type.js';
import { Flags, SymbolTable, TypesSymbolTable } from './symbol-table.js';

import type { ScannerToken } from './scanner.js';
import type { Node, NodeMap } from './node.js';
import type { SymbolMap } from './symbol-table.js';

export type RootNode = ReturnType<typeof parse>;

export function parse(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: TypesSymbolTable,
) {
	const {
		current,
		expect,
		expectNode,
		expectNodeKind,
		optional,
		node,
		parseUntilKind,
		next,
	} = api;
	const typeParser = parseType(api, typesTable);
	const expression = parseExpression(api, symbolTable, typeParser);

	function markExported(label: Node) {
		if (label.kind === 'ident' || label.kind === 'typeident')
			label.symbol.flags |= Flags.Export;
		else throw 'Invalid Symbol';
	}

	function addDataMembers(
		n: Node,
		out: Record<string, SymbolMap['variable']>,
	): void {
		if (n.kind === 'typeident') {
			const s = n.symbol;
			if (s.kind === 'type' && s.family === 'data')
				Object.assign(out, s.members);
			return;
		}
		if (n.kind === 'data') {
			const inner = n.children[0];
			const items =
				inner?.kind === ','
					? inner.children
					: inner
						? [inner]
						: [];
			for (const it of items) {
				if (it?.kind !== 'propdef' || !it.label) continue;
				const sym = it.label.symbol;
				if (sym?.kind === 'variable' && sym.name)
					out[sym.name] = sym;
			}
			return;
		}
		if (n.kind === '&') {
			addDataMembers(n.children[0], out);
			addDataMembers(n.children[1], out);
		}
	}

	function buildTypeSymbol(
		def: Node,
		name: string,
	): SymbolMap['type'] | undefined {
		if (def.kind === 'typeident' && def.symbol.kind === 'type')
			return { ...def.symbol, name };
		if (def.kind === 'data') {
			const members: Record<string, SymbolMap['variable']> = {};
			addDataMembers(def, members);
			return {
				kind: 'type',
				flags: 0,
				name,
				family: 'data',
				size: 0,
				members,
			};
		}
		if (def.kind === '&') {
			const members: Record<string, SymbolMap['variable']> = {};
			addDataMembers(def, members);
			return {
				kind: 'type',
				flags: 0,
				name,
				family: 'data',
				size: 4,
				members,
			};
		}
		return undefined;
	}

	function typeDefinition(node: Token<'type'>) {
		const ident = expect('ident');
		const name = text(ident);
		expect('=');
		const def = expectNode(typeParser(), 'Expected type definition');
		const symbol = buildTypeSymbol(def, name);
		if (!symbol) throw api.error('Expected type definition', ident);
		typesTable.set(name, symbol);
		const label: NodeMap['ident'] = { ...ident, symbol };
		const result: NodeMap['type'] = {
			...node,
			children: [label, def],
			symbol,
		};
		return result;
	}

	function definition() {
		const isExport = optional('export');
		const isType = optional('type');

		const expr = isType
			? typeDefinition(isType)
			: expectNodeKind(expression(), 'def', 'Expected definition');

		if (isExport) markExported(expr.children[0]);

		return expr;
	}

	function externalDecl(token: Token<'external'>): NodeMap['external'] {
		next();
		const ident = expect('ident');
		expect(':');
		const type = expectNode(typeParser(), 'Expected type');
		if (type.kind !== 'typeident' || type.symbol.kind !== 'function')
			throw api.error(
				'External must declare a function type',
				ident,
			);
		const name = text(ident);
		const symbol: SymbolMap['function'] = symbolTable.set(name, {
			name,
			kind: 'function',
			flags: Flags.External,
			parameters: type.symbol.parameters,
			returnType: type.symbol.returnType,
		});
		const label: NodeMap['ident'] = { ...ident, symbol };
		return {
			...token,
			kind: 'external',
			label,
			type,
			children: [label, type],
			end: type.end,
		};
	}

	function topStatement() {
		const token = current();
		if (token.kind === 'main') {
			next();
			expect('{');
			return symbolTable.withScope(scope => {
				const children = parseUntilKind(expression, '}');
				return {
					...token,
					scope,
					children,
					end: expect('}').end,
					statements: children,
				};
			});
		} else if (token.kind === 'comment') {
			next();
			return token;
		} else if (token.kind === 'external') return externalDecl(token);

		return definition();
	}

	const root = {
		...node('root'),
		children: parseUntilKind(topStatement, 'eof'),
	};
	return root;
}
