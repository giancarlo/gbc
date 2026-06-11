import { ParserApi, Token, text } from '../sdk/index.js';

import { parseExpression } from './parser-expression.js';
import { parseType, typeParameters } from './parser-type.js';
import { Flags, SymbolTable, TypesSymbolTable } from './symbol-table.js';

import type { ScannerToken } from './scanner.js';
import type { Node, NodeMap } from './node.js';
import type { SymbolMap, Type } from './symbol-table.js';

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
		next,
		catchAndRecover,
		skipUntil,
	} = api;
	const typeParser = parseType(api, typesTable);

	/**
	 * D30 statement separator: `fn` and `main` blocks self-terminate; every
	 * other statement requires `;`. Returns `true` to continue, `false` to
	 * stop the list. Throws on missing `;` or stray `;` after a block.
	 */
	function parseStatementBlock(
		parser: () => Node | undefined,
		endKind: ScannerToken['kind'],
	): Node[] {
		return catchAndRecover(
			() => {
				const result: Node[] = [];
				let multi = false;
				let nonBlockCount = 0;
				while (
					current().kind !== endKind &&
					current().kind !== 'eof'
				) {
					const stmt = parser();
					if (!stmt)
						throw api.error('Unexpected token', current());
					result.push(stmt);
					if (stmt.kind === 'main' || stmt.kind === 'test') {
						if (current().kind === ';')
							throw api.error(
								'";" is not allowed after a block statement',
								current(),
							);
						continue;
					}
					if (stmt.kind === 'comment') continue;
					nonBlockCount++;
					const consumed = optional(';');
					const after = current().kind;
					const atEnd = after === endKind || after === 'eof';
					if (consumed) {
						if (atEnd && nonBlockCount === 1)
							throw api.error(
								'";" is not allowed after a single statement',
								stmt,
							);
						multi = true;
					} else if (multi)
						throw api.error(
							'Expected ";" after statement',
							current(),
						);
					else if (!atEnd)
						throw api.error('Expected ";"', current());
				}
				return result;
			},
			() => {
				skipUntil(
					() =>
						current().kind === endKind ||
						current().kind === 'eof',
				);
				return [];
			},
		);
	}

	const expression = parseExpression(
		api,
		symbolTable,
		typesTable,
		typeParser,
		parseStatementBlock,
	);

	function markExported(node: NodeMap['def'] | NodeMap['type']) {
		node.symbol.flags |= Flags.Export;
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
				if (it.kind !== 'propdef' || !it.label) continue;
				const sym = it.symbol;
				if (sym.name) out[sym.name] = sym;
			}
			return;
		}
		if (n.kind === '&') {
			addDataMembers(n.children[0], out);
			addDataMembers(n.children[1], out);
		}
	}

	function addComponents(n: Node, out: Type[]): void {
		if (n.kind === 'typeident') {
			if (n.symbol.kind === 'type') out.push(n.symbol);
			return;
		}
		if (n.kind === '&') {
			addComponents(n.children[0], out);
			addComponents(n.children[1], out);
		}
	}

	function buildTypeSymbol(
		def: Node,
		name: string,
	): Type | undefined {
		if (def.kind === 'typeident' && def.symbol.kind === 'type')
			return { ...def.symbol, name, components: [def.symbol] };
		if (def.kind === 'fn' && def.symbol.kind === 'function')
			return { ...def.symbol, name };
		if (def.kind === '>>')
			return {
				kind: 'type',
				flags: 0,
				name,
				family: 'unknown',
				size: 4,
				definition: def,
			};
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
			const components: Type[] = [];
			addComponents(def, components);
			return {
				kind: 'type',
				flags: 0,
				name,
				family: 'data',
				size: 4,
				members,
				components,
			};
		}
		return undefined;
	}

	function typeDefinition(node: Token<'type'>) {
		const ident = expect('ident');
		const name = text(ident);
		const stub: Type = {
			kind: 'type',
			flags: 0,
			name,
			family: 'unknown',
			size: 4,
		};
		typesTable.set(name, stub);
		const tp = typeParameters(api, typesTable, typeParser);
		if (tp)
			stub.typeParams = tp.params
				.map(p => p.symbol.type)
				.filter((t): t is Type => !!t);
		expect('=');
		const def = expectNode(typeParser(), 'Expected type definition');
		tp?.pop();
		const built = buildTypeSymbol(def, name);
		if (!built) throw api.error('Expected type definition', ident);
		// Mutate the forward-declared stub in place so recursive references
		// captured during the body parse (e.g. `Reverse<R>`) see the completed
		// definition. typeParams set on the stub above are preserved.
		const { typeParams } = stub;
		Object.assign(stub, built);
		if (typeParams) stub.typeParams = typeParams;
		const symbol = stub;
		const label: NodeMap['label'] = { ...ident, kind: 'label' };
		const result: NodeMap['type'] = {
			...node,
			children: tp ? [label, tp.list, def] : [label, def],
			typeParameters: tp?.params,
			symbol,
		};
		return result;
	}

	function definition() {
		const isExport = optional('export');
		const isType = optional('type');

		let expr: Node | undefined;
		if (isType) expr = typeDefinition(isType);
		else {
			const parsed = expression();
			const found = current();
			expr = expectNodeKind(
				parsed,
				'def',
				`Expected a definition (\`name = value\`), but got a "${
					parsed?.kind ?? 'nothing'
				}" expression (stalled at "${
					found.kind === 'eof' ? 'end of input' : text(found)
				}")`,
			);
		}

		if (isExport) markExported(expr);

		return expr;
	}

	function externalDecl(token: Token<'external'>): NodeMap['external'] {
		next();
		const ident = expect('ident');
		expect(':');
		const type = expectNode(typeParser(), 'Expected type');
		if (type.kind !== 'fn' || type.symbol.kind !== 'function')
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
		const label: NodeMap['label'] = { ...ident, kind: 'label' };
		return {
			...token,
			kind: 'external',
			label,
			symbol,
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
				const children = parseStatementBlock(expression, '}');
				return {
					...token,
					scope,
					children,
					end: expect('}').end,
					statements: children,
				};
			});
		} else if (token.kind === '#test') {
			next();
			expect('{');
			const prev = symbolTable.ignoreReferences;
			symbolTable.ignoreReferences = true;
			try {
				return symbolTable.withScope(scope => {
					const children = parseStatementBlock(expression, '}');
					return {
						...token,
						kind: 'test' as const,
						scope,
						children,
						end: expect('}').end,
						statements: children,
					};
				});
			} finally {
				symbolTable.ignoreReferences = prev;
			}
		} else if (token.kind === 'comment') {
			next();
			return token;
		} else if (token.kind === 'external') return externalDecl(token);

		return definition();
	}

	function validateTestPlacement(children: Node[]) {
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child?.kind !== 'test') continue;
			let j = i + 1;
			while (children[j]?.kind === 'test') j++;
			const target = children[j];
			if (target?.kind !== 'def' || target.value.kind !== 'fn')
				api.pushError(
					api.error(
						'`#test` must immediately precede a function definition',
						child,
					),
				);
		}
	}

	const children = parseStatementBlock(topStatement, 'eof');
	validateTestPlacement(children);
	const root = {
		...node('root'),
		children,
	};
	return root;
}
