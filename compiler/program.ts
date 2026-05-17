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

import type { Node } from './node.js';
import type { SymbolMap } from './symbol-table.js';

export type ExternalsMap = Map<string, SymbolMap['function']>;

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

function parseStdlib(): ExternalsMap {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);
	api.start(STDLIB_SOURCE);
	const scope = symbolTable.push();
	const typeScope = typesTable.push();
	parse(api, symbolTable, typesTable);
	typesTable.pop(typeScope);
	symbolTable.pop(scope);
	if (api.errors.length)
		throw new Error(
			`stdlib parse failed: ${api.errors
				.map(e => e.message)
				.join(', ')}`,
		);
	const externals: ExternalsMap = new Map();
	for (const key of Object.keys(scope)) {
		const sym = scope[key];
		if (sym && sym.kind === 'function' && sym.flags & Flags.External)
			externals.set(key, sym);
	}
	return externals;
}

const stdlibExternals = parseStdlib();

export function Program(options?: ProgramOptions) {
	const symbolTable = ProgramSymbolTable();
	const typesTable = TypesSymbolTable();
	const api = ParserApi(scan);

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
				bytes = compileWasm(parsed.root, stdlibExternals);
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
		return compileWasm(root, stdlibExternals);
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
