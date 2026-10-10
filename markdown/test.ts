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
		it.test('marks fold boundaries without folding literal delimiters', a => {
			const cases: [string, [string, number, number][]][] = [
				[
					'# One\ntext\n## Two\nbody\n# Three\nlast',
					[
						['# ', 1, 0],
						['## ', 1, 0],
						['\n', 0, 2],
						['# ', 1, 0],
						['last', 0, 1],
					],
				],
				['```js\nconst x = {};\n```\n', [['```js\nconst x = {};\n```', 1, 1]]],
				['Title\n=====\ntext', [['Title', 1, 0], ['text', 0, 1]]],
				['# `code`', [['# ', 1, 0], ['`code`', 0, 1]]],
				['    one\n    two\n\ntext', [['    one', 1, 0], ['\n\n', 0, 1]]],
				['    one\n    two', [['    one', 1, 0], ['    two', 0, 1]]],
			];
			for (const [source, expected] of cases) {
				const tokens = [...highlight(source)];
				a.equalValues(
					tokens.filter(token => token.foldStart || token.foldEnd)
						.map(token => [source.slice(token.start, token.end), token.foldStart, token.foldEnd]),
					expected,
				);
				const iterator = highlight(source);
				const first = iterator.next();
				if (!first.done) {
					const snapshot = { ...first.value };
					const other = highlight(source);
					other.next();
					a.equalValues([first.value, ...iterator], tokens);
					a.equalValues(first.value, snapshot);
					a.equalValues([...other], tokens.slice(1));
				}
				a.equalValues([...highlight(source)], tokens);
			}
		});
		it.test('highlights an empty heading and a lone backtick within the source', a => {
			for (const [source, kind] of [['# ', 'heading'], ['`', 'text']] as const) {
				const tokens = [...highlight(source)];
				a.equalValues(
					tokens.map(({ highlight: kind, start, end }) => ({ kind, start, end })),
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
			a.equal(tokens.some(token => token.highlight === 'heading'), true);
			a.equal(tokens.filter(token => token.highlight === 'strong').length, 2);
			a.equal(tokens.filter(token => token.highlight === 'code').length, 2);
			a.equal(tokens.every(token => token.highlight !== 'keyword'), true);
			a.equal(tokens.every(token => token.source === source), true);
			a.equal(tokens.every(token => token.line === source.slice(0, token.start).split('\n').length - 1), true);
			a.equalValues([...highlight('')], []);
		});
		it.test('preserves inline code offsets and accepts an unclosed fence', a => {
			const source = 'first\n\ntext `code`\n';
			const code = [...highlight(source)].find(token => token.highlight === 'code');
			a.equal(code?.start, 12);
			a.equal(code?.end, 18);
			a.equal(code?.line, 2);
			a.equalValues([...highlight(source)], [...highlight(source)]);
			a.equal([...highlight('```ts\nconst value =')].length > 0, true);
		});
	});

	const sections: Record<string, MdTest[]> = {};
	const testProgram = program();
	a.test('link destinations', it => {
		const cases: [string, string][] = [
			[
				'[CAROLS.BAS](https://debuggerjs.com/basic/?tab=0&e=s:/.www/public/demo/carols.bas) (by Greg Rismoen).',
				'<p><a href="https://debuggerjs.com/basic/?tab=0&amp;e=s:/.www/public/demo/carols.bas">CAROLS.BAS</a> (by Greg Rismoen).</p>\n',
			],
			[
				'[GORILLA.BAS](https://basic.bellido.us/?e=/.www%2Fdemo%2Fgorilla.bas&a=0).',
				'<p><a href="https://basic.bellido.us/?e=/.www%2Fdemo%2Fgorilla.bas&amp;a=0">GORILLA.BAS</a>.</p>\n',
			],
			['[link](/url "title") (after)', '<p><a href="/url" title="title">link</a> (after)</p>\n'],
			['[link](</url> (title))', '<p><a href="/url" title="title">link</a></p>\n'],
			['[link](/url) "after"', '<p><a href="/url">link</a> &quot;after&quot;</p>\n'],
			['[link](/url) (after)', '<p><a href="/url">link</a> (after)</p>\n'],
			['[link](/url "unclosed)', '<p>[link](/url &quot;unclosed)</p>\n'],
			['[link](/%2f%252F%20?q=%26&x=%zz%)', '<p><a href="/%2f%252F%20?q=%26&amp;x=%25zz%25">link</a></p>\n'],
			['[link][ref]\n\n[ref]: /%2F?q=%26&x=0\n', '<p><a href="/%2F?q=%26&amp;x=0">link</a></p>\n'],
			['<https://example.com/%2F?q=%26&x=0>', '<p><a href="https://example.com/%2F?q=%26&amp;x=0">https://example.com/%2F?q=%26&amp;x=0</a></p>\n'],
			['![image](/%2F?q=%26&x=0)', '<p><img src="/%2F?q=%26&amp;x=0" alt="image" /></p>\n'],
			['[link](</φ%2F space?q="&x=0>)', '<p><a href="/%CF%86%2F%20space?q=%22&amp;x=0">link</a></p>\n'],
			['<a href="/%2F?q=%26&x=0">link</a>', '<p><a href="/%2F?q=%26&x=0">link</a></p>\n'],
		];
		for (const [source, expected] of cases)
			it.test(source, a => {
				const { output, errors } = testProgram.compile(source);
				a.equal(output, expected);
				a.equal(errors.length, 0);
			});
	});

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
