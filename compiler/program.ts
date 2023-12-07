///<amd-module name="@cxl/gbc.compiler/program.js"/>
import { ParserApi } from '@cxl/gbc.sdk';
import { SymbolTable } from './symbol-table.js';
import { parse } from './parser.js';
import { scan } from './scanner.js';
import { compiler } from './compiler.js';

//import { compileWasm } from './target-wasm.js';

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

export function Program(options?: ProgramOptions) {
	const symbolTable = SymbolTable();
	const api = ParserApi(scan);

	function parser(src: string) {
		api.start(src);
		const scope = symbolTable.push();
		const root = parse(api, symbolTable);
		symbolTable.pop(scope);
		return { root, scope, errors: api.errors };
	}

	function compile(src: string) {
		const parsed = parser(src);
		return {
			output: compiler(parsed.root),
			ast: parsed.root,
			errors: parsed.errors,
		};
	}

	function compileAst(root: ReturnType<typeof parse>) {
		return compiler(root);
	}

	return {
		compile,
		compileAst,
		options,
		parser,
	};
}
