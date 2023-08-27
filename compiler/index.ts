///<amd-module name="@cxl/gbc.compiler"/>
import { MakeNodeMap, Parser, parserTable } from '@cxl/compiler/parser.js';
import { Token, Scanner, keywords, operators } from '@cxl/compiler/scanner.js';
import { Compiler } from '@cxl/compiler/compiler.js';

export interface System {
	readFile(): string;
}

export interface ProgramOptions {
	sys: System;
}

export enum Flags {
	Variable = 1,
}

type NodeMap = MakeNodeMap<{
	root: { children: Node[] };
	main: { children: Node[] };
	ident: {};
	string: {};
	number: {};
	next: {};
	'>>': { children: [Node, Node] };
	'=': { children: [Node, Node]; flags: Flags };
	'.': { children: [Node, Node] };
	',': { children: [Node, Node] };
	'?': { children: [Node, Node, Node] };
	':': {};
	'{': {};
	'}': {};
	eof: {};
}>;
export type Node = NodeMap[keyof NodeMap];

const parse = parserTable<NodeMap>(
	(
		{ parseBlock, expectNodeKind, expectNodeParser, node, parseUntilKind },
		{ expression: expr, infix, ternary },
	) => ({
		main: {
			precedence: 1,
			prefix(token) {
				return {
					...token,
					children: parseBlock(
						'{',
						expectNodeParser(expr, 'Expected expression'),
						'}',
					),
				};
			},
		},
		var: {
			precedence: 0,
			prefix(tk: Token<string>) {
				const result = expectNodeKind(
					expr(0),
					'=',
					'Expected assignment',
				);
				result.flags |= Flags.Variable;
				result.start = tk.start;
				return result;
			},
		},
		next: { precedence: 1 },
		'>>': {
			precedence: 2,
			infix: infix(2),
		},
		'.': {
			precedence: 17,
			infix: infix(0),
		},
		',': {
			precedence: 3,
			infix: infix(3),
		},
		'=': {
			precedence: 2,
			infix: infix(0),
		},
		'?': {
			precedence: 2,
			infix: ternary(2, ':'),
		},

		number: { precedence: 0, prefix: n => n },
		string: { precedence: 0, prefix: n => n },
		ident: { precedence: 0, prefix: n => n },
		root: () => ({
			...node('root'),
			children: parseUntilKind(expr, 'eof'),
		}),
	}),
);

const runtime = `const std={ out:console.log.bind(console) };`;
const compiler = Compiler<NodeMap>({
	runtime,
	tableFn: ({ compileChildren, text }) => ({
		root: compileChildren,
		main: compileChildren,
		'.': _ => '.',
		',': _ => ',',
		'{': _ => '{',
		'}': _ => '}',
		'=': _ => '=',
		'?': _ => '?',
		':': _ => ':',
		string: text,
		ident: text,
		'>>': n => {
			const [l, r] = n.children;
			return `${text(r)}(${text(l)})`;
		},
		number: text,
		next: text,
		eof: text,
	}),
});

export function Program(options?: ProgramOptions) {
	const scanner = new Scanner({
		rules: {
			...keywords('main', 'next', 'var'),
			...operators('>>', '{', '}', '.', '=', ',', '?', ':'),
			string: s => s.matchEnclosed("'", "'", '\\'),
			eof: '',
			root: '',
			ident: s => s.matchFirstWhile(/[a-zA-Z_]/, /[\w_]/),
			comment: s => s.matchFirstWhile(/#/, /[^\n\r]/),
			number: s => {
				let first = s.char();
				let consumed = 0;

				if (first === '0') {
					if (s.char(1) === 'x')
						return s.matchWhile(/[\da-fA-F_]/, 2);
					else if (s.char(1) === 'b') return s.matchWhile(/[01_]/, 2);
					consumed = s.matchWhile(/[\d_]/, 1);
				} else if (/\d/.test(first)) {
					consumed = s.matchWhile(/[\d_]/);
				}

				if (consumed && s.char(consumed) === '.') {
					const decimals = s.matchWhile(/[\d_]/, consumed + 1);
					if (!decimals) throw s.error('Expected digit');
					consumed = decimals;
				}

				return consumed;
			},
		},
	});

	const parser = Parser({ scanner, parse });

	function sourceFile(src: string) {
		return parser.parse(src);
	}

	function compile(src: string) {
		const { root } = parser.parse(src);
		return compiler.compile(root);
	}

	return {
		compile,
		options,
		parser,
		sourceFile,
	};
}
