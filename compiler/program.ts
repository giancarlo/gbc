///<amd-module name="@cxl/gbc.compiler/program.js"/>
import { ParserApi } from '@cxl/gbc.sdk';
import { ProgramSymbolTable, TypesSymbolTable } from './symbol-table.js';
import { parse } from './parser.js';
import { scan } from './scanner.js';
import { compiler } from './compiler.js';
import { checker } from './checker.js';
import type { Node } from './node.js';

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

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
		return {
			output: compiler(parsed.root),
			ast: parsed.root,
			errors: parsed.errors,
		};
	}

	function compileAst(root: Node) {
		return compiler(root);
	}

	return {
		compile,
		compileAst,
		options,
		parse: parser,
		symbolTable,
	};
}
