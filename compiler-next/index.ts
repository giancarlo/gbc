///<amd-module name="@cxl/gbc.compiler"/>
import { ParserApi } from '@cxl/compiler/parser.js';
import { Compiler } from '@cxl/compiler/compiler.js';
import { text } from '@cxl/compiler/scanner.js';
import { InfixNode, TernaryNode } from '@cxl/compiler/parser-table.js';
import { SymbolTable } from './symbol-table.js';

import { scan } from './scanner.js';
import { NodeMap, Flags, parse } from './parser.js';

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

const runtime = ``; //const std={ out:console.log.bind(console) };`;
const compiler = Compiler<NodeMap>({
	runtime,
	tableFn: ({ compile, compileEach, compileChildren }) => {
		const infix = (n: InfixNode<NodeMap>) =>
			`${compile(n.children[0])}${n.kind}${compile(n.children[1])}`;
		const nop = () => '';
		const block = (n: NodeMap['{'] | NodeMap['main']) =>
			`${n.statements.length === 1 ? 'return ' : ''}${compileEach(
				n.statements,
			)}`;

		return {
			def: n =>
				`${n.flags & Flags.Variable ? 'let' : 'const'} ${compile(
					n.children[0],
				)}=${compile(n.children[1])};`,
			root: compileChildren,
			main: block,
			parameter: text,
			type: nop,
			'.': infix,
			'==': infix,
			'!=': infix,
			'=': infix,
			'|': infix,
			'&&': infix,
			'||': infix,
			'&': infix,
			'+': infix,
			'-': infix,
			'/': infix,
			'*': infix,
			'>': infix,
			'<': infix,
			'>=': infix,
			'<=': infix,
			':': nop,
			',': infix,
			$: () => '$',
			'{': n => {
				const defaultParam = n.scope.$?.references?.length ? '$' : '';
				return `(${
					n.parameters ? compileEach(n.parameters, ',') : defaultParam
				})=>{${block(n)}}`;
			},
			'?': (n: TernaryNode<NodeMap, true>) =>
				`${compile(n.children[0])} ? ${compile(n.children[1])} : ${
					n.children[2] ? compile(n.children[2]) : undefined
				}`,
			call: n =>
				`${compile(n.children[0])}(${
					n.children[1] ? compile(n.children[1]) : ''
				})`,
			'~': _ => '~',
			'!': _ => '!',
			'(': _ => '(',
			done: () => '',
			macro: n => n.value,
			comment: _ => '',
			var: text,
			string: text,
			ident: text,
			'>>': n => {
				const [l, r] = n.children;
				const left =
					r.kind === 'ident' || r.kind === 'macro'
						? compile(r)
						: `(${compile(r)})`;
				return `${left}(${compile(l)})`;
			},
			number: text,
			next: text,
			eof: text,
		};
	},
});

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
		return compiler.compile(parsed.root);
	}

	function compileAst(root: ReturnType<typeof parse>) {
		return compiler.compile(root);
	}

	return {
		compile,
		compileAst,
		options,
		parser,
	};
}
