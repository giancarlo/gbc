import { spec } from '@cxl/spec';
import {
	BaseNode,
	BinaryNodeBase,
	findNodeAtIndex,
	LeafNode,
	RootNodeBase,
	ScannerApi,
	stringEscape,
	TernaryNodeBase,
	UnaryNodeBase,
} from './index.js';

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
		s.test('createTrieMatcher', it => {
			it.should('parse keywords that contain each other', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'main' });
				const matcher = createTrieMatcher(['ma', 'main'], notIdent);
				a.equal(matcher()?.kind, 'main');
			});
			it.should('return undefined for no match', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'xtz' });
				const matcher = createTrieMatcher(['xy', 'xyz'], notIdent);
				a.equal(matcher()?.kind, undefined);
			});
			it.should('handle partial matches correctly', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'mat-ch' });
				const matcher = createTrieMatcher(['mat', 'match'], notIdent);
				a.equal(matcher()?.kind, 'mat');
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
});
