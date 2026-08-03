import { ParserApi, Token, text } from '../sdk/index.js';

import { parseExpression } from './parser-expression.js';
import { parseType, typeParameters } from './parser-type.js';
import { Flags, SymbolTable, TypesSymbolTable } from './symbol-table.js';

import type { ScannerToken } from './scanner.js';
import type { Node, NodeMap } from './node.js';
import type { Symbol, SymbolMap, Type, TypeSymbol } from './symbol-table.js';

export type RootNode = ReturnType<typeof parse>;

/** A parsed `@` module reference: `@name` (library, via the import map) or
 * `@.seg.seg` (local file, relative to the importing file). */
export interface ModuleRef {
	dot: boolean;
	segs: string[];
}

/** Host-side module loader threaded into the parser: imports bind the
 * loaded module's actual export symbols at parse time, so downstream
 * symbol-identity machinery (codegen builder maps) needs no patching. */
export interface ModuleLoader {
	load(ref: ModuleRef): {
		symbol: SymbolMap['variable'];
		exports: Record<string, Symbol>;
		types: Record<string, TypeSymbol>;
	};
	setMap(entries: { name: string; path: string }[]): void;
}

export interface ParseOptions {
	loader?: ModuleLoader;
	/** Parsing an imported module: `main` is forbidden. */
	module?: boolean;
}

export function parse(
	api: ParserApi<ScannerToken>,
	symbolTable: SymbolTable,
	typesTable: TypesSymbolTable,
	options: ParseOptions = {},
) {
	const {
		current,
		consume,
		expectNode,
		expectNodeKind,
		optional,
		node,
		next,
		catchAndRecover,
	} = api;
	const typeParser = parseType(api, typesTable);

	/**
	 * Statement separator: `;` separates statements and the trailing `;` is
	 * optional. A `main`/`test` block statement self-terminates (no `;` after).
	 */
	function parseStatementBlock(
		parser: () => Node | undefined,
		endKind: ScannerToken['kind'],
	): Node[] {
		const result: Node[] = [];
		while (current().kind !== endKind && current().kind !== 'eof') {
			const stmt = catchAndRecover(
				() => {
					const stmt = parser();
					if (!stmt)
						throw api.error('Unexpected token', current());
					if (stmt.kind === 'main' || stmt.kind === 'test') {
						if (current().kind === ';')
							throw api.error(
								'";" is not allowed after a block statement',
								current(),
							);
						return stmt;
					}
					if (stmt.kind === 'comment') return stmt;
					const consumed = optional(';');
					const after = current().kind;
					const atEnd = after === endKind || after === 'eof';
					if (!consumed && !atEnd)
						throw api.error('Expected ";"', current());
					return stmt;
				},
				() => {
					let depth = 0;
					while (current().kind !== 'eof') {
						const kind = current().kind;
						if (
							depth === 0 &&
							(kind === endKind || kind === ';')
						)
							break;
						if (kind === '(' || kind === '[' || kind === '{')
							depth++;
						else if (
							depth > 0 &&
							(kind === ')' || kind === ']' || kind === '}')
						)
							depth--;
						next();
					}
					optional(';');
					return undefined;
				},
			);
			if (stmt) result.push(stmt);
		}
		return result;
	}

	const {
		statement: expression,
		deferred,
		resolveForwardRefs,
	} = parseExpression(
		api,
		symbolTable,
		typesTable,
		typeParser,
		parseStatementBlock,
		options.loader,
	);

	function markExported(node: NodeMap['def'] | NodeMap['type']) {
		node.symbol.flags |= Flags.Export;
	}

	function addDataMembers(
		n: Node,
		out: Record<string, SymbolMap['variable']>,
	): void {
		if (n.kind === 'typeident') {
			const s = n.symbol.type;
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
			out.push(n.symbol.type);
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
		if (def.kind === 'typeident')
			return { ...def.symbol.type, name, components: [def.symbol.type] };
		if (def.kind === 'fn') return { ...def.symbol, name };
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
		const ident = consume('ident');
		const name = text(ident);
		const stub: TypeSymbol = {
			kind: 'type',
			flags: 0,
			name,
			type: {
				kind: 'type',
				flags: 0,
				name,
				family: 'unknown',
				size: 4,
			},
		};
		typesTable.set(name, stub);
		const tp = typeParameters(api, typesTable, typeParser);
		if (tp)
			stub.typeParams = tp.params
				.map(p => p.symbol.type)
				.filter((t): t is Type => !!t);
		consume('=');
		const def = expectNode(typeParser(), 'Expected type definition');
		tp?.pop();
		const built = buildTypeSymbol(def, name);
		if (!built) throw api.error('Expected type definition', ident);
		// A type with no structure is Void itself (`[]` is Void) — it can
		// have no values, so naming one is always a latent error.
		const emptyDef =
			(def.kind === 'typeident' &&
				def.symbol.type.kind === 'type' &&
				(def.symbol.type.family === 'void' ||
					def.symbol.type.name === '[]')) ||
			(def.kind === 'data' && !def.children[0]);
		if (emptyDef)
			throw api.error(
				`"${name}" has no structure — \`[]\` is Void and has no values`,
				ident,
			);
		// Mutate the forward-declared stub in place so recursive references
		// captured during the body parse (e.g. `Reverse<R>`) see the completed
		// definition. typeParams set on the stub above are preserved.
		const { typeParams } = stub;
		stub.type = built;
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
			if (parsed?.kind === 'import') return parsed;
			// `name = …` parses as an assignment (not a def) only when `name` is
			// already bound: a built-in/prelude (in the global scope) or an
			// earlier definition. Neither can be redefined — say which, and
			// point at `extend` for adding an overload arm.
			if (parsed?.kind === '=') {
				const lhs = parsed.children[0];
				const name = text(lhs);
				const builtin = symbolTable.globalScope.has(name);
				throw api.error(
					builtin
						? `"${name}" is a built-in; add an arm with \`extend ${name} (…) { … }\` or rename`
						: `"${name}" is already defined; rename or use \`extend\``,
					lhs,
				);
			}
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
		const ident = consume('ident');
		consume(':');
		const type = expectNode(typeParser(), 'Expected type');
		if (type.kind !== 'fn')
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

	function extendDecl(token: Token<'extend'>): NodeMap['extend'] {
		next();
		const identTk = consume('ident');
		const name = text(identTk);
		const symbol = symbolTable.getWithReference(name, identTk);
		const identNode: NodeMap['ident'] = {
			...identTk,
			symbol: symbol ?? { name, kind: 'variable', flags: 0 },
		};
		const arm = expectNodeKind(
			expression(),
			'fn',
			'extend requires a `(params): Ret { body }` arm',
		);
		return {
			...token,
			kind: 'extend',
			children: [identNode, arm],
			end: arm.end,
		};
	}

	function importMapDecl(token: ScannerToken): Node {
		next();
		consume('{');
		const entries: { name: string; path: string }[] = [];
		while (current().kind !== '}' && current().kind !== 'eof') {
			consume('@');
			const nameTk = consume('ident');
			consume('=');
			const pathTk = current();
			if (pathTk.kind !== 'string')
				throw api.error('Expected a path string', pathTk);
			next();
			entries.push({
				name: text(nameTk),
				path: text(pathTk).slice(1, -1),
			});
			optional(';');
		}
		const end = consume('}').end;
		if (!options.loader)
			throw api.error(
				'`#importmap` requires a module-aware compile (an entry file)',
				token,
			);
		options.loader.setMap(entries);
		// Inert comment node: self-terminating (no `;` after the block) and
		// invisible to the checker/codegen — the entries live in the loader.
		return { ...token, kind: 'comment' as const, end };
	}

	function topStatement() {
		const token = current();
		if (token.kind === 'extend') return extendDecl(token);
		if (token.kind === '#importmap') return importMapDecl(token);
		if (token.kind === 'main') {
			if (options.module)
				throw api.error(
					'a library module cannot declare `main` — `main` belongs to the program entry',
					token,
				);
			next();
			consume('{');
			return symbolTable.withScope(scope => {
				const children = deferred(() =>
					parseStatementBlock(expression, '}'),
				);
				return {
					...token,
					scope,
					children,
					end: consume('}').end,
					statements: children,
				};
			});
		} else if (token.kind === '#test') {
			next();
			consume('{');
			const prev = symbolTable.ignoreReferences;
			symbolTable.ignoreReferences = true;
			try {
				return symbolTable.withScope(scope => {
					const children = deferred(() =>
						parseStatementBlock(expression, '}'),
					);
					return {
						...token,
						kind: 'test' as const,
						scope,
						children,
						end: consume('}').end,
						statements: children,
					};
				});
			} finally {
				symbolTable.ignoreReferences = prev;
			}
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
	// Merge each `extend name arm` into `name`'s dispatch: rewrite the target
	// def's value to `<old value> | arm`, so all dispatch machinery (resolution,
	// uniform-return/ambiguity checks, codegen) handles it unchanged.
	const defsByName = new Map<string, NodeMap['def']>();
	for (const c of children)
		if (c.kind === 'def' && c.symbol.name) defsByName.set(c.symbol.name, c);
	const mergedChildren: Node[] = [];
	for (const c of children) {
		if (c.kind === 'extend') {
			const targetName = text(c.children[0]);
			const def = defsByName.get(targetName);
			const arm = c.children[1];
			if (def && (def.value.kind === 'fn' || def.value.kind === '|')) {
				const merged: NodeMap['|'] = {
					...c,
					kind: '|',
					children: [def.value, arm],
					start: def.value.start,
					end: arm.end,
				};
				def.value = merged;
				def.children[2] = merged;
				continue;
			}
			// Extending a type's constructor: keep the node; the checker and
			// codegen resolve the arm against the type's constructor dispatch.
			if (typesTable.get(targetName)) {
				mergedChildren.push(c);
				continue;
			}
			api.pushError(
				api.error(`"${targetName}" is not a dispatch to extend`, c),
			);
			continue;
		}
		mergedChildren.push(c);
	}
	resolveForwardRefs();
	validateTestPlacement(mergedChildren);
	const root = {
		...node('root'),
		children: mergedChildren,
	};
	return root;
}
