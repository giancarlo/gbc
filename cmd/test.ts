import { TestApi, spec } from '@cxl/spec';
import { each, Token } from '../sdk/index.js';

import { scan, program } from './index.js';
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

		it.should('scan shell words', a => {
			match(a, `'hello'`, {
				kind: 'word',
				start: 0,
				end: 7,
			});
			match(a, `'hello world'`, {
				kind: 'word',
				start: 0,
				end: 13,
			});
			match(a, `'single-quoted string'`, {
				kind: 'word',
				start: 0,
				end: 22,
			});
			match(a, `'escaped \\'quote\\''`, {
				kind: 'word',
				start: 0,
				end: 19,
			});
			match(a, `'template with \${expr}'`, {
				kind: 'word',
				start: 0,
				end: 23,
			});
		});

		it.should('scan unquoted shell words', a => {
			match(a, '123', { kind: 'word', start: 0, end: 3 });
			match(a, '0xf', { kind: 'word', start: 0, end: 3 });
			match(a, '0b1', { kind: 'word', start: 0, end: 3 });
			match(a, '0.456', { kind: 'word', start: 0, end: 5 });
		});

		it.should('scan command operators', a => {
			a.equalValues(kinds('echo hello | cat && grep foo || (sed edit)'), [
				'word',
				'word',
				'|',
				'word',
				'&&',
				'word',
				'word',
				'||',
				'(',
				'word',
				'word',
				')',
			]);
		});

		it.should('scan comments and redirects', a => {
			a.equalValues(kinds('echo hi # note'), ['word', 'word', 'comment']);
			a.equalValues(kinds('cat < in txt > out'), [
				'word',
				'<',
				'word',
				'word',
				'>',
				'word',
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

		it.should('compile POSIX command lists and shell words', a => {
			const cmd = program();
			a.equalValues(
				cmd.compile(
					`VAR=value command "two words" '$HOME' ${'$'}{name} ; (printf '%s\\n' "${'$'}VAR")`,
				).output,
				`VAR=value command "two words" '$HOME' ${'$'}{name} ; (printf '%s\\n' "${'$'}VAR")`,
			);
		});

		it.should('compile POSIX redirections with file descriptors', a => {
			const cmd = program();
			a.equalValues(
				cmd.compile(`command 2>>errors.log 0<&3 1>&2 <>input`).output,
				`command 2>> errors.log 0<& 3 1>& 2 <> input`,
			);
		});
	});
});
