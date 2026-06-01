import { CompilerError, ParserApi } from '../sdk/index.js';
import {
	Flags,
	ProgramSymbolTable,
	TypesSymbolTable,
} from './symbol-table.js';
import { parse } from './parser.js';
import { scan } from './scanner.js';
import { compileTypes } from './compiler-types.js';
import { compileWasm } from './target-wasm.js';
import { checker } from './checker.js';
import { STDLIB_SOURCE } from './stdlib-source.js';

import type { Node, NodeMap } from './node.js';
import type { Scope, Symbol, SymbolMap } from './symbol-table.js';

export type ExternalsMap = Map<string, SymbolMap['function']>;

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

interface Module {
	root: NodeMap['root'];
	scope: Scope;
	errors: CompilerError[];
}

/**
 * Parse + type-check one module from source, returning its AST root and
 * top-level symbol scope. Has no knowledge of "stdlib" — the same function
 * loads the prelude now and any `@module` once the module system lands.
 */
function loadModule(source: string): Module {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);
	api.start(source);
	const scope = symbolTable.push();
	const typeScope = typesTable.push();
	const root = parse(api, symbolTable, typesTable);
	if (!api.errors.length) checker({ root, errors: api.errors }).run();
	typesTable.pop(typeScope);
	symbolTable.pop(scope);
	return { root, scope, errors: api.errors };
}

const stdlib = loadModule(STDLIB_SOURCE);
if (stdlib.errors.length)
	throw new Error(
		`stdlib failed: ${stdlib.errors.map(e => e.message).join(', ')}`,
	);

// Host imports: the stdlib's `external` declarations.
const stdlibExternals: ExternalsMap = new Map();
for (const key of Object.keys(stdlib.scope)) {
	const sym = stdlib.scope[key];
	if (sym && sym.kind === 'function' && sym.flags & Flags.External)
		stdlibExternals.set(key, sym);
}

// Prelude = the stdlib's gb definitions. It is GLOBAL: its symbols are
// injected into every program's scope (like `error`/`length`) and its def
// nodes are prepended to the codegen root so their templates are inlinable.
// Imported modules (future `@module.name`) are NOT global — resolved via `@`.
const preludeSymbols: Record<string, Symbol> = {};
const preludeDefs: NodeMap['def'][] = [];
for (const child of stdlib.root.children)
	if (child.kind === 'def' && child.value.kind === 'fn') {
		if (child.symbol.name) preludeSymbols[child.symbol.name] = child.symbol;
		preludeDefs.push(child);
	}

function withPrelude(root: Node): Node {
	if (preludeDefs.length === 0 || root.kind !== 'root') return root;
	return { ...root, children: [...preludeDefs, ...root.children] };
}

export function Program(options?: ProgramOptions) {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);
	symbolTable.setSymbols(preludeSymbols);

	function parser(src: string) {
		api.start(src);
		const scope = symbolTable.push();
		const typeScope = typesTable.push();
		const root = parse(api, symbolTable, typesTable);
		typesTable.pop(typeScope);
		symbolTable.pop(scope);
		return { root, scope, errors: api.errors };
	}

	function compile(src: string) {
		const parsed = parser(src);
		checker(parsed).run();
		let bytes: Uint8Array | undefined;
		if (parsed.errors.length === 0) {
			try {
				bytes = compileWasm(withPrelude(parsed.root), stdlibExternals);
			} catch (e) {
				if (e instanceof CompilerError) parsed.errors.push(e);
				else if (e instanceof Error)
					parsed.errors.push(
						new CompilerError(e.message, parsed.root),
					);
				else throw e;
			}
		}
		return {
			ast: parsed.root,
			errors: parsed.errors,
			bytes,
		};
	}

	function compileAst(root: Node): Uint8Array {
		return compileWasm(withPrelude(root), stdlibExternals);
	}

	return {
		compile,
		compileAst,
		compileTypes,
		options,
		parse: parser,
		symbolTable,
	};
}
