import { TestApi, spec } from '@cxl/spec';
import { each, Token } from '@cxl/gbc.sdk';

import { scan, keywords } from './index.js';
//import { ast } from './debug.js';

export default spec('cmd', s => {
	s.test('Scanner', it => {
		function match(
			a: TestApi,
			src: string,
			...expect: Partial<Token<string>>[]
		) {
			const { next } = scan(src);
			let i = 0;
			for (const tk of each(next)) a.equalValues(tk, expect[i++]);
		}

		it.should('scan keywords', a => {
			for (const key of keywords) {
				match(a, key, { kind: key, start: 0, end: key.length });
				match(a, `${key}\n`, { kind: key, start: 0, end: key.length });
				match(a, `${key}_`, {
					kind: 'ident',
					start: 0,
					end: key.length + 1,
				});
				match(a, `${key}5`, {
					kind: 'ident',
					start: 0,
					end: key.length + 1,
				});
				match(a, `${key}_test`, {
					kind: 'ident',
					start: 0,
					end: key.length + 5,
				});
				match(a, `  ${key}\t\n`, {
					kind: key,
					start: 2,
					end: 2 + key.length,
				});
			}
		});

		it.should('scan strings', a => {
			match(a, `'hello'`, {
				kind: 'string',
				start: 0,
				end: 7,
			});
			match(a, `'hello world'`, {
				kind: 'string',
				start: 0,
				end: 13,
			});
			match(a, `'single-quoted string'`, {
				kind: 'string',
				start: 0,
				end: 22,
			});
			match(a, `'escaped \\'quote\\''`, {
				kind: 'string',
				start: 0,
				end: 19,
			});
			match(a, `'template with \${expr}'`, {
				kind: 'string',
				start: 0,
				end: 23,
			});
		});

		it.should('scan numbers', a => {
			match(a, '123', { kind: 'number', start: 0, end: 3 });
			match(a, '0xf', { kind: 'number', start: 0, end: 3 });
			match(a, '0b1', { kind: 'number', start: 0, end: 3 });
			match(a, '0.456', { kind: 'number', start: 0, end: 5 });
		});

		it.should('detect errors in numbers', a => {
			a.throws(() => match(a, '0x3h 10'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '0b12'), {
				position: { start: 0, end: 4 },
			});
			a.throws(() => match(a, '  12f2'), {
				position: { start: 2, end: 5 },
			});
		});
	});
});
