import { TestApi, spec } from '@cxl/spec';
import { each, Token } from '../sdk/index.js';

import { scan, keywords, program } from './index.js';
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
			for (const tk of each(next)) {
				const expected = expect[i++]!;
				a.equalValues(
					{
						kind: tk.kind,
						start: tk.start,
						end: tk.end,
					},
					{
						kind: expected.kind,
						start: expected.start,
						end: expected.end,
					},
				);
			}
		}

		function kinds(src: string) {
			const { next } = scan(src);
			const result: string[] = [];
			for (const tk of each(next)) result.push(tk.kind);
			return result;
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

		it.should('scan command operators', a => {
			a.equalValues(kinds('echo hello | cat && grep foo || (sed edit)'), [
				'ident',
				'ident',
				'|',
				'ident',
				'&&',
				'ident',
				'ident',
				'||',
				'(',
				'ident',
				'ident',
				')',
			]);
		});

		it.should('scan comments and redirects', a => {
			a.equalValues(kinds('echo hi # note'), ['ident', 'ident', 'comment']);
			a.equalValues(kinds('cat < in txt > out'), [
				'ident',
				'<',
				'ident',
				'ident',
				'>',
				'ident',
			]);
		});

		it.should('compile bash-like commands', a => {
			const cmd = program();
			a.equalValues(
				cmd.compile(`git commit -m 'msg' | cat`).output,
				`git commit -m 'msg' | cat`,
			);
			a.equalValues(
				cmd.compile(`echo hello > out.txt && cat < out.txt`).output,
				`echo hello > out.txt && cat < out.txt`,
			);
			a.equalValues(
				cmd.compile(`(echo hello | cat)`).output,
				`(echo hello | cat)`,
			);
		});

		it.should('compile comments, redirects, and groups', a => {
			const cmd = program();
			a.equalValues(cmd.compile(`echo hi # note`).output, `echo hi`);
			a.equalValues(
				cmd.compile(`cat < in.txt > out.txt`).output,
				`cat < in.txt > out.txt`,
			);
			a.equalValues(
				cmd.compile(`echo hi\n# note\ncat`).output,
				`echo hi\ncat`,
			);
			a.equalValues(cmd.compile(`{ echo hi }`).output, `{ echo hi ; }`);
		});
	});
});
