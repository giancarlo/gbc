import { TestApi, spec } from '@cxl/spec';
import { each, findNodeAtIndex, Token, tokenize } from '../sdk/index.js';

import { IrKind, IrSeparator, IrWordFlags, scan, program } from './index.js';
//import { ast } from './debug.js';

export default spec('cmd', s => {
	s.test('Scanner', (it: TestApi) => {
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

		function word(src: string) {
			const root = program().parse(src).root;
			const list = root.children[0];
			it.assert(list?.kind === 'list', 'Expected command list');
			const command = list.children[0];
			it.assert(command?.kind === 'command', 'Expected command');
			const result = command.parts[0];
			it.assert(result?.kind === 'word', 'Expected word');
			return result;
		}

		function metadata(src: string) {
			const {
				kind,
				value,
				literal,
				hasExpansion,
				hasParameterExpansion,
				hasCommandSubstitution,
				hasBackticks,
				hasNonliteralConstruct,
			} = word(src);
			return {
				kind,
				value,
				literal,
				hasExpansion,
				hasParameterExpansion,
				hasCommandSubstitution,
				hasBackticks,
				hasNonliteralConstruct,
			};
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

		it.should('tokenize editor input through the SDK', a => {
			const source = "echo 'line\ntwo' | next # comment\n'unclosed";
			const tokens = [...tokenize(scan, source)];
			a.equalValues(
				tokens.map(token => token.kind),
				[
					'word',
					'word',
					'|',
					'word',
					'comment',
					'newline',
					'tokenizer-error',
				],
			);
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

		it.should('parse and compile POSIX function definitions', (a: TestApi) => {
			const compiled = program().compile(
				'greet() { echo hi; } 2>errors\nsubshell() (echo ok)',
			);
			const list = compiled.ast.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const greet = list.children[0];
			const subshell = list.children[1];
			a.assert(greet?.kind === 'function', 'Expected function definition');
			a.assert(subshell?.kind === 'function', 'Expected function definition');
			a.assert(greet.body && subshell.body, 'Expected function body');

			a.equalValues(
				{
					kind: greet.kind,
					name: greet.name.value,
					body: greet.body.opener,
					start: greet.start,
					end: greet.end,
					redirects: greet.redirects.map(redirect => redirect.operator),
				},
				{
					kind: 'function',
					name: 'greet',
					body: '{',
					start: 0,
					end: 29,
					redirects: ['>'],
				},
			);
			a.equalValues(greet.children, [
				greet.name,
				greet.body,
				...greet.redirects,
			]);
			a.equalValues(subshell.body.opener, '(');
			a.equalValues(compiled.errors, []);
			a.equalValues(
				compiled.output,
				'greet() { echo hi ; } 2> errors\nsubshell() (echo ok)',
			);
		});

		it.should('traverse function definitions through shared AST children', (a: TestApi) => {
			const root = program().parse('greet() { echo hi; }').root;
			const list = root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const fn = list.children[0];
			a.assert(fn?.kind === 'function', 'Expected function definition');

			a.equal(findNodeAtIndex(root, 0), fn.name);
			a.equal(findNodeAtIndex(root, 7), fn);
			a.equal(findNodeAtIndex(root, 8), fn.body);
			a.equal(findNodeAtIndex(root, 10)?.kind, 'word');
			a.equal(findNodeAtIndex(root, 19), fn.body);
		});

		it.should('report malformed POSIX function definitions', a => {
			const messages = (src: string) =>
				program()
					.parse(src)
					.errors.map(error => error.message);

			a.equalValues(messages('greet()'), ['Expected function body']);
			a.equalValues(messages('greet() { echo'), [
				'Expected "}" but got "eof"',
			]);
			a.equalValues(messages('not-portable() { echo; }')[0],
				'Expected portable function name',
			);
		});

		it.should('preserve POSIX parsing by default', (a: TestApi) => {
			const root = program().parse('type File = string').root;
			const list = root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const command = list.children[0];
			a.assert(command?.kind === 'command', 'Expected POSIX command');
			a.equalValues(
				command.parts.map(part => part.kind === 'word' ? part.value : undefined),
				['type', 'File', '=', 'string'],
			);
			const invocationRoot = program().parse('core.open! file').root;
			const invocationList = invocationRoot.children[0];
			a.assert(invocationList?.kind === 'list', 'Expected invocation list');
			const invocation = invocationList.children[0];
			a.assert(invocation?.kind === 'command', 'Expected POSIX invocation');
			a.equalValues(
				invocation.parts.map(part => part.kind === 'word' ? part.value : undefined),
				['core.open!', 'file'],
			);
		});

		it.should('expose typed declarations in the IDE dialect', (a: TestApi) => {
			const source = [
				'type File=string',
				'type Directory = string',
				'open(file: File, directory: Directory): string { echo ok; }',
				'open README.md src',
			].join('\n');
			const parsed = program({ dialect: 'ide' }).parse(source);
			const list = parsed.root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const [file, directory, fn, invocation] = list.children;
			a.assert(file?.kind === 'typealias', 'Expected File alias');
			a.assert(directory?.kind === 'typealias', 'Expected Directory alias');
			a.assert(fn?.kind === 'function', 'Expected typed function');
			a.assert(fn.returnType, 'Expected return type');
			a.assert(fn.body, 'Expected function body');
			a.assert(invocation?.kind === 'command', 'Expected function invocation');

			a.equalValues(
				{
					file: [file.name.value, file.target.name],
					directory: [directory.name.value, directory.target.name],
					name: fn.name.value,
					parameters: fn.parameters.map(parameter => [
						parameter.name.value,
						parameter.type.name,
					]),
					returnType: fn.returnType?.name,
					invocation: invocation.parts.map(part =>
						part.kind === 'word' ? part.value : undefined,
					),
				},
				{
					file: ['File', 'string'],
					directory: ['Directory', 'string'],
					name: 'open',
					parameters: [
						['file', 'File'],
						['directory', 'Directory'],
					],
					returnType: 'string',
					invocation: ['open', 'README.md', 'src'],
				},
			);
			a.equalValues(file.children, [file.name, file.target]);
			a.equalValues(fn.children, [
				fn.name,
				...fn.parameters,
				fn.returnType,
				fn.body,
			]);
			a.equal(findNodeAtIndex(parsed.root, source.lastIndexOf('File'))?.kind, 'type');
			a.equalValues(parsed.errors, []);
		});

		it.should('parse IDE command names and optional or rest parameters', (a: TestApi) => {
			const parsed = program({ dialect: 'ide' }).parse(
				'core.open!(file?: File, ...flags: string): string { echo ok; }',
			);
			const list = parsed.root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const fn = list.children[0];
			a.assert(fn?.kind === 'function', 'Expected typed function');

			a.equalValues(
				{
					name: fn.name.value,
					parameters: fn.parameters.map(parameter => ({
						name: parameter.name.value,
						type: parameter.type.name,
						optional: parameter.optional,
						rest: parameter.rest,
					})),
				},
				{
					name: 'core.open!',
					parameters: [
						{ name: 'file', type: 'File', optional: true, rest: false },
						{ name: 'flags', type: 'string', optional: false, rest: true },
					],
				},
			);
			a.equalValues(parsed.errors, []);
		});

		it.should('parse bodyless IDE built-in declarations', (a: TestApi) => {
			const cmd = program({ dialect: 'ide' });
			const parsed = cmd.parse([
				'type File = string',
				'core.open(file: File): string',
				'core.quit()',
			].join('\n'));
			const list = parsed.root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const open = list.children[1];
			const quit = list.children[2];
			a.assert(open?.kind === 'function', 'Expected open declaration');
			a.assert(quit?.kind === 'function', 'Expected quit declaration');

			a.equalValues(
				{
					openBody: open.body,
					quitBody: quit.body,
					separators: list.separators,
					errors: parsed.errors,
				},
				{
					openBody: undefined,
					quitBody: undefined,
					separators: ['newline', 'newline'],
					errors: [],
				},
			);
			a.equalValues(cmd.ir(parsed.root), [
				1,
				[
					IrKind.List,
					[IrSeparator.Newline, IrSeparator.Newline],
					[IrKind.TypeAlias, 'File', 'string'],
					[
						IrKind.Function,
						'core.open',
						[IrKind.Parameter, 'file', 'File'],
						[IrKind.Type, 'string'],
					],
					[IrKind.Function, 'core.quit'],
				],
			]);
		});

		it.should('report malformed IDE declarations', a => {
			const messages = (source: string) =>
				program({ dialect: 'ide' })
					.parse(source)
					.errors.map(error => error.message);

			a.equalValues(messages('type File = string\ntype File = string'), [
				'Duplicate type alias "File"',
			]);
			a.equalValues(
				messages('open(file: File, file: File) { echo; }'),
				['Duplicate parameter "file"'],
			);
			a.equalValues(messages('type Bad-Name = string')[0],
				'Expected type alias name',
			);
			a.equalValues(
				messages('open(first?: string, second: string) { echo; }'),
				['Required parameter cannot follow optional parameter'],
			);
			a.equalValues(
				messages('open(...values: string, next: string) { echo; }'),
				['Rest parameter must be last'],
			);
			a.equalValues(messages('open(...values?: string) { echo; }'), [
				'Rest parameter cannot be optional',
			]);
		});

		it.should('reject emitting IDE declarations as POSIX shell', a => {
			a.throws(
				() => program({ dialect: 'ide' }).compile('type File = string'),
				/Cannot emit IDE declaration/,
			);
			a.throws(
				() =>
					program({ dialect: 'ide' }).compile(
						'open(file: File): string { echo; }',
					),
				/Cannot emit typed function/,
			);
		});

		it.should('lower the full AST to compact execution IR', a => {
			const cmd = program({ dialect: 'ide' });
			const parsed = cmd.parse([
				'type File = string',
				'open(file?: File, ...flags: string): string { echo ok; }',
				"open 'README file'",
			].join('\n'));

			a.equalValues(cmd.ir(parsed.root), [
				1,
				[
					IrKind.List,
					[IrSeparator.Newline, IrSeparator.Newline],
					[IrKind.TypeAlias, 'File', 'string'],
					[
						IrKind.Function,
						'open',
						[IrKind.Parameter, 'file', 'File', 1],
						[IrKind.Parameter, 'flags', 'string', 2],
						[IrKind.Type, 'string'],
						[
							IrKind.Group,
							1,
							[
								IrKind.List,
								[IrSeparator.Semicolon],
								[IrKind.Command, [IrKind.Word, 'echo'], [IrKind.Word, 'ok']],
							],
						],
					],
					[IrKind.Command, [IrKind.Word, 'open'], [IrKind.Word, 'README file']],
				],
			]);
			a.equalValues(parsed.errors, []);
		});

		it.should('retain unsafe word behavior in compact IR flags', a => {
			const cmd = program();
			const parsed = cmd.parse('echo ${name} $(date) `date` *.ts');

			a.equalValues(cmd.ir(parsed.root), [
				1,
				[
					IrKind.List,
					[],
					[
						IrKind.Command,
						[IrKind.Word, 'echo'],
						[IrKind.Word, '${name}', IrWordFlags.ParameterExpansion],
						[IrKind.Word, '$(date)', IrWordFlags.CommandSubstitution],
						[
							IrKind.Word,
							'`date`',
							IrWordFlags.CommandSubstitution | IrWordFlags.Backticks,
						],
						[IrKind.Word, '*.ts', IrWordFlags.Other],
					],
				],
			]);
		});

		it.should('serialize IR substantially smaller than the full AST', a => {
			const cmd = program({ dialect: 'ide' });
			const parsed = cmd.parse(
				'core.open(file: File, directory?: Directory): string { echo ok; }\ncore.open README.md src',
			);
			const astSize = JSON.stringify(parsed.root).length;
			const irSize = JSON.stringify(cmd.ir(parsed.root)).length;

			a.equal(irSize < astSize / 4, true);
		});

		it.should('expose literal word values in the AST', a => {
			const literal = {
				kind: 'word',
				literal: true,
				hasExpansion: false,
				hasParameterExpansion: false,
				hasCommandSubstitution: false,
				hasBackticks: false,
				hasNonliteralConstruct: false,
			} as const;
			a.equalValues(metadata('plain'), { ...literal, value: 'plain' });
			a.equalValues(metadata("'$HOME'"), { ...literal, value: '$HOME' });
			a.equalValues(metadata('"two words"'), {
				...literal,
				value: 'two words',
			});
			const ansi = ["$'first", 'second\\nthird\\u0021\''].join('\n');
			a.equalValues(metadata(ansi), {
				...literal,
				value: 'first\nsecond\nthird!',
			});
		});

		it.should('mark unsafe shell words in the AST', a => {
			a.equalValues(metadata('${name}'), {
				kind: 'word',
				value: undefined,
				literal: false,
				hasExpansion: true,
				hasParameterExpansion: true,
				hasCommandSubstitution: false,
				hasBackticks: false,
				hasNonliteralConstruct: true,
			});
			a.equalValues(metadata('$(date)').hasCommandSubstitution, true);
			a.equalValues(metadata('`date`').hasBackticks, true);
			a.equalValues(metadata('$((1 + 1))').hasNonliteralConstruct, true);
			a.equalValues(metadata('$"localized"').literal, false);
			a.equalValues(metadata('*.ts').literal, false);
		});

		it.should('report malformed shell syntax with source spans', a => {
			const diagnostics = (src: string) =>
				program()
					.parse(src)
					.errors.map(({ message, position: { start, end } }) => ({
						message,
						start,
						end,
					}));

			a.equalValues(diagnostics('"hello'), [
				{ message: 'Unterminated string', start: 0, end: 6 },
			]);
			a.equalValues(diagnostics('echo ok &&'), [
				{ message: 'Expected command', start: 10, end: 10 },
			]);
			a.equalValues(diagnostics('echo >'), [
				{ message: 'Expected shell word', start: 6, end: 6 },
			]);
			a.equalValues(diagnostics('(echo'), [
				{ message: 'Expected ")" but got "eof"', start: 5, end: 5 },
			]);
			a.equalValues(diagnostics('echo )'), [
				{ message: 'Unexpected ")"', start: 5, end: 6 },
			]);
		});

		it.should('return a partial AST after malformed trailing syntax', (a: TestApi) => {
			const parsed = program().parse('echo ok &&');
			const list = parsed.root.children[0];
			a.assert(list?.kind === 'list', 'Expected command list');
			const command = list.children[0];
			a.assert(command?.kind === 'command', 'Expected command');
			a.equalValues(command.parts.map(part => part.kind === 'word' && part.value), [
				'echo',
				'ok',
			]);

			const recovered = program().parse('echo ) cat').root.children[0];
			a.assert(recovered?.kind === 'list', 'Expected recovered command list');
			a.equalValues(
				recovered.children.map(node =>
					node.kind === 'command' && node.parts[0]?.kind === 'word'
						? node.parts[0].value
						: undefined,
				),
				['echo', 'cat'],
			);
		});

		it.should('find the most specific node at an offset', (a: TestApi) => {
			const root = program().parse('echo hi | cat').root;
			const list = root.children[0]!;
			a.assert(list.kind === 'list', 'Expected list');
			const pipe = list.children[0]!;
			a.assert(pipe.kind === '|', 'Expected pipe');
			const left = pipe.children[0];
			const right = pipe.children[1];
			a.assert(
				left.kind === 'command' && right.kind === 'command',
				'Expected commands',
			);

			a.equal(findNodeAtIndex(root, 0), left.parts[0]);
			a.equal(findNodeAtIndex(root, 4), left);
			a.equal(findNodeAtIndex(root, 5), left.parts[1]);
			a.equal(findNodeAtIndex(root, 8), pipe);
			a.equal(findNodeAtIndex(root, 9), pipe);
			a.equal(findNodeAtIndex(root, 10), right.parts[0]);
		});

		it.should('find canonical redirect, group, and list children', (a: TestApi) => {
			const redirectRoot = program().parse('cat 2>out').root;
			const redirectList = redirectRoot.children[0]!;
			a.assert(redirectList.kind === 'list', 'Expected list');
			const command = redirectList.children[0]!;
			a.assert(command.kind === 'command', 'Expected command');
			const redirect = command.redirects[0]!;

			a.equalValues(command.children, [command.parts[0], redirect]);
			a.equalValues(redirect.children, [redirect.io, redirect.target]);
			a.equal(findNodeAtIndex(redirectRoot, 4), redirect.io);
			a.equal(findNodeAtIndex(redirectRoot, 5), redirect);
			a.equal(findNodeAtIndex(redirectRoot, 6), redirect.target);

			const groupRoot = program().parse('(echo)').root;
			const groupList = groupRoot.children[0]!;
			a.assert(groupList.kind === 'list', 'Expected list');
			const groupCommand = groupList.children[0]!;
			a.assert(groupCommand.kind === 'command', 'Expected command');
			const group = groupCommand.parts[0]!;
			a.assert(group.kind === 'group', 'Expected group');

			a.equal(findNodeAtIndex(groupRoot, 0), group);
			a.equal(findNodeAtIndex(groupRoot, 1)?.kind, 'word');
			a.equal(findNodeAtIndex(groupRoot, 5), group);

			const listRoot = program().parse('echo;cat').root;
			const list = listRoot.children[0]!;
			a.assert(list.kind === 'list', 'Expected list');
			a.equal(findNodeAtIndex(listRoot, 4), list);
			a.equal(findNodeAtIndex(listRoot, 5)?.kind, 'word');
		});

		it.should('handle source boundaries and empty input', a => {
			const root = program().parse('echo ').root;
			a.equalValues({ start: root.start, end: root.end }, { start: 0, end: 5 });
			a.equal(findNodeAtIndex(root, 4), root);
			a.equal(findNodeAtIndex(root, 5), undefined);
			a.equal(findNodeAtIndex(root, -1), undefined);
			a.equal(findNodeAtIndex(root, 6), undefined);

			const empty = program().parse('').root;
			a.equal(findNodeAtIndex(empty, 0), undefined);
			a.equal(findNodeAtIndex(empty, 1), undefined);
		});
	});
});
