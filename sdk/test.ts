import { spec } from '@cxl/spec';
import { ScannerApi, stringEscape } from './index.js';

const _ident = /\w/;
const ident = (ch: string) => ch === '_' || _ident.test(ch);
const notIdent = (ch: string) => ch === undefined || !ident(ch);

export default spec('sdk', s => {
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
