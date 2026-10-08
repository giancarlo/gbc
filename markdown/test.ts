import { highlight } from './highlight.js';
import { TestApi, spec } from '@cxl/spec';
import { program } from './index.js';
import tests from './test-commonmark.js';

type MdTest = {
	md: string;
	html: string;
	section: string;
};

export default spec('markdown', (a: TestApi) => {
	a.test('public highlighting contract', it => {
		it.test('highlights an empty heading and a lone backtick within the source', a => {
			for (const [source, kind] of [['# ', 'heading'], ['`', 'text']] as const) {
				const tokens = [...highlight(source)];
				a.equalValues(
					tokens.map(({ kind, start, end }) => ({ kind, start, end })),
					[{ kind, start: 0, end: source.length }],
				);
			}
		});
		it.test('keeps incomplete Markdown spans ordered and within the source', a => {
			for (const source of ['## ', '#\t', '# ###', '  # ', '``', 'text `', '# `']) {
				const tokens = [...highlight(source)];
				a.equal(tokens.length > 0, true);
				let end = 0;
				for (const token of tokens) {
					a.equal(token.start >= end, true);
					a.equal(token.end > token.start, true);
					a.equal(token.end <= source.length, true);
					end = token.end;
				}
				a.equal(end, source.length);
			}
		});
		it.test('highlights Markdown syntax and leaves fenced code plain', a => {
			const source = '# Heading\n\n**bold** and `code`\n\n```ts\nconst value = 42;\n```\n';
			const tokens = [...highlight(source)];
			a.equal(tokens.some(token => token.kind === 'heading'), true);
			a.equal(tokens.filter(token => token.kind === 'strong').length, 2);
			a.equal(tokens.filter(token => token.kind === 'code').length, 2);
			a.equal(tokens.every(token => token.kind !== 'keyword'), true);
			a.equal(tokens.every(token => token.source === source), true);
			a.equal(tokens.every(token => token.line === source.slice(0, token.start).split('\n').length - 1), true);
			a.equalValues([...highlight('')], []);
		});
		it.test('preserves inline code offsets and accepts an unclosed fence', a => {
			const source = 'first\n\ntext `code`\n';
			const code = [...highlight(source)].find(token => token.kind === 'code');
			a.equal(code?.start, 12);
			a.equal(code?.end, 18);
			a.equal(code?.line, 2);
			a.equalValues([...highlight(source)], [...highlight(source)]);
			a.equal([...highlight('```ts\nconst value =')].length > 0, true);
		});
	});

	const sections: Record<string, MdTest[]> = {};
	const testProgram = program();

	for (const test of tests) {
		const testApi = (sections[test.section] ??= []);
		testApi.push(test);
	}

	for (const [section, tests] of Object.entries(sections)) {
		a.test(section, t => {
			for (const test of tests)
				t.test(JSON.stringify(test.md), t2 => {
					const { output, errors } = testProgram.compile(test.md);
					t2.equal(output, test.html, test.md);
					t2.equal(errors.length, 0, 'No errors');
					if (errors.length) t2.log(errors);
				});
		});
	}
});
