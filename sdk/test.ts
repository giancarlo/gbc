import { spec } from '@cxl/spec';
import { ScannerApi } from './index.js';

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
	});
});
