import { TestApi, spec } from '@cxl/spec';
import {
	Flags,
	text,
	tokenize,
	type Symbol,
	type Type,
} from '../sdk/index.js';
import {
	childNodes,
	type NodeMap,
} from './index.js';
import { compatibilityCases, demoNames } from './test-corpus.js';
import { scan } from './scanner.js';

declare const fetch: (url: URL) => Promise<{
	ok: boolean;
	status: number;
	text(): Promise<string>;
}>;
declare class URL {
	constructor(path: string, base: string);
}
declare global {
	interface ImportMeta {
		url: string;
	}
}

export default spec('basic', (a: TestApi) => {
	a.test('scanner', it => {
		it.should('scan canonical keywords, suffixes, operators, and positions', a => {
			const source = 'pRiNt Value$ >= .5\nNEXT';
			const tokens = [...tokenize(scan, source)];
			a.equalValues(
				tokens.map(token => ({
					kind: token.kind,
					text: text(token),
					start: token.start,
					end: token.end,
					line: token.line,
				})),
				[
					{ kind: 'print', text: 'pRiNt', start: 0, end: 5, line: 0 },
					{ kind: 'ident', text: 'Value$', start: 6, end: 12, line: 0 },
					{ kind: '>=', text: '>=', start: 13, end: 15, line: 0 },
					{ kind: 'number', text: '.5', start: 16, end: 18, line: 0 },
					{ kind: 'eol', text: '\n', start: 18, end: 19, line: 0 },
					{ kind: 'next', text: 'NEXT', start: 19, end: 23, line: 1 },
				],
			);
		});

		it.should('scan labels, numeric formats, strings, comments, and continuations', a => {
			const source =
				'10 PRINT &H3C8, &O17, &B101, 1.2E-3!\nname: REM note\nvalue = _\r\n  "a\\"b"';
			const tokens = [...tokenize(scan, source)];
			a.equalValues(
				tokens.map(token => [token.kind, text(token), token.line]),
				[
					['label', '10', 0],
					['print', 'PRINT', 0],
					['number', '&H3C8', 0],
					[',', ',', 0],
					['number', '&O17', 0],
					[',', ',', 0],
					['number', '&B101', 0],
					[',', ',', 0],
					['number', '1.2E-3!', 0],
					['eol', '\n', 0],
					['label', 'name:', 1],
					['comment', 'REM note', 1],
					['eol', '\n', 1],
					['ident', 'value', 2],
					['=', '=', 2],
					['string', '"a\\"b"', 3],
				],
			);
		});

		it.should('preserve whitespace-only physical lines', a => {
			const tokens = [...tokenize(scan, '\n \r\nx')];
			a.equalValues(
				tokens.map(token => [token.kind, token.start, token.end, token.line]),
				[
					['eol', 0, 1, 0],
					['eol', 2, 4, 1],
					['ident', 4, 5, 2],
				],
			);
		});

		it.should('recover after malformed tokens', a => {
			const tokens = [...tokenize(scan, '&H\n` 1E+')];
			a.equalValues(
				tokens.map(token => token.kind),
				['tokenizer-error', 'eol', 'tokenizer-error', 'tokenizer-error'],
			);
		});
	});

	a.test('in-memory AST', it => {
		const source = 'x = 1 + 2';
		const x: NodeMap['ident'] = {
			kind: 'ident',
			name: 'x',
			start: 0,
			end: 1,
			line: 0,
			source,
		};
		const one: NodeMap['number'] = {
			kind: 'number',
			value: 1,
			text: '1',
			start: 4,
			end: 5,
			line: 0,
			source,
		};
		const two: NodeMap['number'] = {
			kind: 'number',
			value: 2,
			text: '2',
			start: 8,
			end: 9,
			line: 0,
			source,
		};
		const add: NodeMap['+'] = {
			kind: '+',
			children: [one, two],
			start: 4,
			end: 9,
			line: 0,
			source,
		};
		const assign: NodeMap['assign'] = {
			kind: 'assign',
			children: [x, add],
			start: 0,
			end: 9,
			line: 0,
			source,
		};

		it.should('use SDK kinds, children, and positions', a => {
			a.equal(assign.kind, 'assign');
			a.equalValues(childNodes(assign), [x, add]);
			a.equalValues(childNodes(add), [one, two]);
			a.equalValues(
				[assign.start, assign.end, assign.line, assign.source],
				[0, 9, 0, source],
			);
		});

		it.should('keep semantic links directly on in-memory nodes', a => {
			const integerType = {
				kind: 'type',
				name: 'integer',
			} as const satisfies Type;
			const declaration: NodeMap['variable'] = {
				kind: 'variable',
				children: [],
				name: 'x',
				dimensionCount: 0,
				shared: false,
				static: false,
				redim: false,
				start: 0,
				end: 1,
				line: 0,
				source,
			};
			const symbol: Symbol<typeof declaration, typeof integerType> = {
				name: 'x',
				kind: 'variable',
				definition: declaration,
				type: integerType,
				flags: Flags.None,
			};
			x.symbol = symbol;
			declaration.symbol = symbol;
			a.equal(x.symbol, symbol);
			a.equal(x.symbol.definition, declaration);
			a.equal(x.symbol.type, integerType);
		});
	});

	a.test('interpreter-oriented AST layouts', it => {
		const source = 'IF x THEN PRINT x';
		const position = { start: 0, end: source.length, line: 0, source };
		const x: NodeMap['ident'] = {
			...position,
			kind: 'ident',
			name: 'x',
		};
		const argument: NodeMap['argument'] = {
			...position,
			kind: 'argument',
			children: [x],
			separator: undefined,
		};
		const print: NodeMap['print'] = {
			...position,
			kind: 'print',
			children: [argument],
		};
		const body: NodeMap['block'] = {
			...position,
			kind: 'block',
			children: [print],
		};
		const branch: NodeMap['branch'] = {
			...position,
			kind: 'branch',
			children: [x, body],
		};
		const ifNode: NodeMap['if'] = {
			...position,
			kind: 'if',
			children: [branch],
		};
		const forNode: NodeMap['for'] = {
			...position,
			kind: 'for',
			children: [x, x, x, undefined, body],
		};
		const doNode: NodeMap['do'] = {
			...position,
			kind: 'do',
			children: [undefined, body, x],
			precondition: undefined,
			postcondition: 'until',
		};
		const caseNode: NodeMap['case'] = {
			...position,
			kind: 'case',
			children: [x, body],
			testCount: 1,
			isElse: false,
		};
		const select: NodeMap['select'] = {
			...position,
			kind: 'select',
			children: [x, caseNode],
		};

		it.should('make control-flow execution order explicit', a => {
			a.equalValues(childNodes(ifNode), [branch]);
			a.equalValues(childNodes(forNode), [x, x, x, undefined, body]);
			a.equalValues(childNodes(doNode), [undefined, body, x]);
			a.equalValues(childNodes(select), [x, caseNode]);
		});

		it.should('represent procedures, data, jumps, and runtime statements', a => {
			const parameter: NodeMap['parameter'] = {
				...position,
				kind: 'parameter',
				name: 'x',
				array: false,
			};
			const procedure: NodeMap['procedure'] = {
				...position,
				kind: 'procedure',
				children: [parameter, body],
				procedureKind: 'sub',
				name: 'test',
				parameterCount: 1,
				expression: false,
			};
			const label: NodeMap['ident'] = {
				...position,
				kind: 'ident',
				name: 'again',
			};
			const jump: NodeMap['goto'] = {
				...position,
				kind: 'goto',
				children: [label],
			};
			const data: NodeMap['data'] = {
				...position,
				kind: 'data',
				children: [x],
			};
			a.equalValues(childNodes(procedure), [parameter, body]);
			a.equalValues(childNodes(data), [x]);
			a.equalValues(childNodes(jump), [label]);
			a.equalValues(childNodes(print), [argument]);
		});
	});

	a.test('historical compatibility corpus', a => {
		a.ok(compatibilityCases.length > 0);
		a.equal(
			new Set(compatibilityCases.map(test => test.id)).size,
			compatibilityCases.length,
		);
		for (const test of compatibilityCases) {
			a.ok(test.source.trim().length > 0);
			const errors = [...tokenize(scan, test.source)].filter(
				token => token.kind === 'tokenizer-error',
			);
			a.equal(errors.length, 0, test.id);
		}
	});

	a.test('demo corpus', async a => {
		const demos = await Promise.all(
			demoNames.map(async file => {
				const response = await fetch(
					new URL(`../../basic/fixtures/demo/${file}`, import.meta.url),
				);
				return {
					file,
					ok: response.ok,
					status: response.status,
					source: await response.text(),
				};
			}),
		);
		for (const demo of demos) {
			a.ok(demo.ok, `${demo.file}: ${demo.status}`);
			a.ok(demo.source.trim().length > 0);
			const errors = [...tokenize(scan, demo.source)].filter(
				token => token.kind === 'tokenizer-error',
			);
			a.equal(errors.length, 0, demo.file);
		}
	});
});
