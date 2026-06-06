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
import { STDLIB_SOURCE, TEST_SOURCE } from './stdlib-source.js';

import type { Node, NodeMap } from './node.js';
import type { Scope, Symbol, SymbolMap, Type } from './symbol-table.js';

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
function loadModule(
	source: string,
	extraSymbols?: Record<string, Symbol>,
	extraTypes?: Record<string, Type>,
): Module {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	if (extraSymbols) symbolTable.setSymbols(extraSymbols);
	if (extraTypes) typesTable.setSymbols(extraTypes);
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
		`stdlib failed: ${stdlib.errors
			.map(e => `line ${e.position.line + 1}: ${e.message}`)
			.join(', ')}`,
	);

// Host imports: the stdlib's `external` declarations.
const stdlibExternals: ExternalsMap = new Map();
for (const [key, sym] of stdlib.scope) {
	if (
		typeof key === 'string' &&
		sym.kind === 'function' &&
		sym.flags & Flags.External
	)
		stdlibExternals.set(key, sym);
}

// Prelude = the stdlib's gb definitions. It is GLOBAL: its symbols are
// injected into every program's scope (like `error`/`length`) and its def
// nodes are prepended to the codegen root so their templates are inlinable.
// Imported modules (future `@module.name`) are NOT global — resolved via `@`.
function collectDefs(module: Module): {
	symbols: Record<string, Symbol>;
	defs: NodeMap['def'][];
} {
	const symbols: Record<string, Symbol> = {};
	const defs: NodeMap['def'][] = [];
	for (const child of module.root.children)
		if (
			child.kind === 'def' &&
			(child.value.kind === 'fn' ||
				child.value.kind === '|' ||
				child.value.kind === 'data')
		) {
			if (child.symbol.name) symbols[child.symbol.name] = child.symbol;
			defs.push(child);
		}
	return { symbols, defs };
}

function collectTypes(module: Module): Record<string, Type> {
	const types: Record<string, Type> = {};
	for (const child of module.root.children) {
		if (child.kind !== 'type') continue;
		const sym = child.symbol;
		if ((sym.kind === 'type' || sym.kind === 'function') && sym.name)
			types[sym.name] = sym;
	}
	return types;
}

const { symbols: preludeSymbols, defs: preludeDefs } = collectDefs(stdlib);
const preludeTypes = collectTypes(stdlib);

// The test module (assert helpers for `#test` blocks). Loaded with the stdlib
// prelude in scope (it calls `out`/`toString`). Its symbols are always
// resolvable (so `#test` bodies parse), but its def nodes are prepended to the
// codegen root ONLY in test mode — normal builds never carry them.
const testModule = loadModule(TEST_SOURCE, preludeSymbols, preludeTypes);
if (testModule.errors.length)
	throw new Error(
		`test module failed: ${testModule.errors
			.map(e => `line ${e.position.line + 1}: ${e.message}`)
			.join(', ')}`,
	);
const { symbols: testSymbols, defs: testDefs } = collectDefs(testModule);

function withPrelude(root: Node, testMode = false): Node {
	if (root.kind !== 'root') return root;
	const head = testMode ? [...preludeDefs, ...testDefs] : preludeDefs;
	if (head.length === 0) return root;
	return { ...root, children: [...head, ...root.children] };
}

export function Program(options?: ProgramOptions) {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);
	symbolTable.setSymbols(preludeSymbols);
	symbolTable.setSymbols(testSymbols);
	typesTable.setSymbols(preludeTypes);

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

	function compileAst(root: Node, testMode = false): Uint8Array {
		return compileWasm(withPrelude(root, testMode), stdlibExternals, testMode);
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
