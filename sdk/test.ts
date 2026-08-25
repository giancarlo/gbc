import { spec } from '@cxl/spec';
import {
	BaseNode,
	BinaryNodeBase,
	childNodes,
	CompilerError,
	createCaseInsensitiveTrie,
	createTrie,
	findNodeAtIndex,
	Flags,
	LeafNode,
	matchers,
	RootNodeBase,
	ScannerApi,
	stringEscape,
	TernaryNodeBase,
	tokenize,
	UnaryNodeBase,
} from './index.js';
import type { Symbol, Type } from './index.js';

type TestLeaf = LeafNode<'leaf'>;
type TestRoot = RootNodeBase<TestLeaf>;
type TestUnary = UnaryNodeBase<TestLeaf>;
type TestBinary = BinaryNodeBase<TestLeaf>;
type TestTernary = TernaryNodeBase<TestLeaf>;
type TestOptional = TernaryNodeBase<TestLeaf, true>;

const _ident = /\w/;
const ident = (ch: string) => ch === '_' || _ident.test(ch);
const notIdent = (ch: string) => ch === undefined || !ident(ch);

export default spec('sdk', s => {
	s.test('shared AST and scanner helpers', a => {
		const source = 'ab';
		const leaf: BaseNode = { start: 0, end: 1, line: 0, source };
		const parent: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [leaf, undefined],
		};
		a.equal(childNodes(leaf), undefined);
		a.equalValues(childNodes(parent), [leaf, undefined]);
		a.equal(matchers.horizontalSpace('\t'), true);
		a.equal(matchers.lineBreak('\r'), true);
		a.equal(matchers.notLineBreak('x'), true);
		a.equal(matchers.notLineBreak('\n'), false);
		a.equal(matchers.octalDigit('7'), true);
		a.equal(matchers.octalDigit('8'), false);
	});

	s.test('shared semantic types', a => {
		const source = 'value';
		const definition: TestLeaf = {
			kind: 'leaf',
			start: 0,
			end: source.length,
			line: 0,
			source,
		};
		const type = { kind: 'type', name: 'Integer' } as const satisfies Type;
		const symbol: Symbol<typeof definition, typeof type> = {
			kind: 'variable',
			name: 'value',
			definition,
			type,
			flags: Flags.Variable,
		};
		a.equal(symbol.kind, 'variable');
		a.equal(symbol.definition, definition);
		a.equal(symbol.type, type);
		a.equal(symbol.flags, Flags.Variable);
	});

	s.test('findNodeAtIndex', it => {
		const source = 'ab';
		const left: BaseNode = { start: 0, end: 1, line: 0, source };
		const right: BaseNode = { start: 1, end: 2, line: 0, source };
		const branch: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [left, right],
		};
		const root: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [branch],
		};

		it.should('return the most specific nested node', a => {
			a.equal(findNodeAtIndex(root, 0), left);
		});

		it.should('use half-open source boundaries', a => {
			a.equal(findNodeAtIndex(branch, 1), right);
		});

		it.should('return undefined outside the node span', a => {
			a.equal(findNodeAtIndex(root, -1), undefined);
			a.equal(findNodeAtIndex(root, 2), undefined);
		});

		it.should('skip absent tuple children', a => {
			const leaf: TestLeaf = {
				kind: 'leaf',
				start: 0,
				end: 1,
				line: 0,
				source,
			};
			const rootShape: TestRoot = { children: [leaf] };
			const unaryShape: TestUnary = { children: [leaf] };
			const binaryShape: TestBinary = { children: [leaf, leaf] };
			const ternaryShape: TestTernary = { children: [leaf, leaf, leaf] };
			const optionalShape: TestOptional = {
				children: [leaf, leaf, undefined],
			};
			const optional: BaseNode = {
				start: 0,
				end: 2,
				line: 0,
				source,
				children: [left, right, undefined],
			};
			a.equalValues(
				[
					rootShape.children.length,
					unaryShape.children.length,
					binaryShape.children.length,
					ternaryShape.children.length,
					optionalShape.children.length,
				],
				[1, 1, 2, 3, 3],
			);
			a.equal(findNodeAtIndex(optional, 1), right);
		});
	});

	s.test('ScannerApi', s => {
		s.test('lineToken', a => {
			const api = ScannerApi({ source: '\r\nx' });
			const eol = api.lineToken('eol', 2);
			const ident = api.tk('ident', 1);
			a.equalValues(
				[eol.start, eol.end, eol.line, ident.start, ident.end, ident.line],
				[0, 2, 0, 2, 3, 1],
			);
		});

		s.test('createTrieMatcher', it => {
			it.should('parse keywords that contain each other', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'main' });
				const matcher = createTrieMatcher(
					createTrie('ma', 'main'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'main');
			});
			it.should('return undefined for no match', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'xtz' });
				const matcher = createTrieMatcher(
					createTrie('xy', 'xyz'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
			it.should('handle partial matches correctly', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'mat-ch' });
				const matcher = createTrieMatcher(
					createTrie('mat', 'match'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'mat');
			});
			it.should('match case-insensitive tries with canonical kinds', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'pRiNt' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'PRINT');
			});
			it.should('match overlapping case-insensitive keywords', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'gOtO' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('GO', 'GOTO'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'GOTO');
			});
			it.should('respect case-insensitive keyword boundaries', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'PRINTABLE' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
			it.should('reject case-insensitive non-matches', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'plot' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
		});

		s.test('matchEnclosed', it => {
			const notQuote = (ch: string) => ch !== "'";

			it.should('match a string at offset 0', a => {
				const { matchEnclosed } = ScannerApi({ source: "'abc'" });
				a.equal(matchEnclosed(notQuote, stringEscape), 4);
			});
			it.should('honor escape inside the enclosure', a => {
				const { matchEnclosed } = ScannerApi({
					source: "'a\\'b'",
				});
				a.equal(matchEnclosed(notQuote, stringEscape), 5);
			});
			it.should('honor escape when not at source start', a => {
				const { matchEnclosed, skip } = ScannerApi({
					source: "xx'a\\'b'",
				});
				skip(2);
				a.equal(matchEnclosed(notQuote, stringEscape), 5);
			});
			it.should(
				'stop at closing delimiter when no escape precedes it',
				a => {
					const { matchEnclosed, skip } = ScannerApi({
						source: "xx'line\\nA\\u{42}'",
					});
					skip(2);
					a.equal(matchEnclosed(notQuote, stringEscape), 14);
				},
			);
		});
	});

	s.test('tokenize', it => {
		it.should('retain positioned tokens and recover scanner errors', a => {
			const source = 'one ! two';
			const scanner = (value: string) => {
				const api = ScannerApi({ source: value });
				return {
					backtrack: api.backtrack,
					next() {
						api.skipWhitespace();
						if (api.eof()) return api.tk('eof', 0);
						if (api.current() === '!')
							throw api.error('Unexpected input', 1);
						return api.tk(
							'word',
							api.matchWhile(ch => ch !== ' ' && ch !== '!'),
						);
					},
				};
			};
			const tokens = [...tokenize(scanner, source)];
			a.equalValues(
				tokens.map(({ kind, start, end }) => ({ kind, start, end })),
				[
					{ kind: 'word', start: 0, end: 3 },
					{ kind: 'tokenizer-error', start: 4, end: 5 },
					{ kind: 'word', start: 6, end: 9 },
				],
			);
			a.ok(
				tokens[1]?.kind === 'tokenizer-error' &&
					tokens[1].error instanceof CompilerError,
			);
		});

		it.should('stop when an error cannot advance', a => {
			const tokens = [
				...tokenize(
					source => ({
						backtrack() {},
						next() {
							throw new CompilerError('Incomplete input', {
								start: 0,
								end: 0,
								line: 0,
								source,
							});
						},
					}),
					'',
				),
			];
			a.equalValues(
				tokens.map(({ kind, start, end }) => ({ kind, start, end })),
				[{ kind: 'tokenizer-error', start: 0, end: 0 }],
			);
		});
	});
});
