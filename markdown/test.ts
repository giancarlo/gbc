import { highlight as createHighlight } from './highlight.js';
import { TestApi, spec } from '@cxl/spec';
import { compiler, program, render } from './index.js';
import { createHighlighter, type HighlightOptions } from '@cxl/gbc.sdk';
import tests from './test-commonmark.js';
import highlightTests from './test-highlight.js';

const highlight = createHighlight();

type MdTest = {
	md: string;
	html: string;
	section: string;
};

export default spec('markdown', (a: TestApi) => {
	a.test('renders syntax-highlighted code through every public entry point', a => {
		const child = createHighlighter(() => undefined, function* (window) {
			if (window.source.length) yield Object.assign(window.position(2, 7, 0), {
				kind: 'keyword', highlight: 'keyword' as const, foldStart: 0, foldEnd: 0,
			});
			return { state: undefined, committed: window.source.length };
		}, state => state);
		const names: string[] = [];
		let fail = false;
		const options: HighlightOptions = { resolveLanguage: name => {
			names.push(name);
			if (fail) throw new Error('resolver failure');
			return name === 'test' ? child : undefined;
		} };
		const source = '```test extra\n  <&">x\n```';
		const expected = '<pre><code class="language-test">  <span class="keyword">&lt;&amp;&quot;&gt;x</span>\n</code></pre>\n';
		const md = program(options);
		a.equal(render(source, options), expected);
		a.equal(md.compile(source).output, expected);
		a.equal(compiler(md.parse(source).root, options), expected);
		a.equalValues(names, ['test', 'test', 'test']);
		for (const value of ['`inline`', '    indented\n', '```\nplain\n```', '```unknown\n<&\n```', '```test\n```'])
			a.equal(render(value, options), render(value));
		a.equal(render(source.slice(0, -3), options), expected);
		a.equal(render('> ' + source.replaceAll('\n', '\n> '), options), '<blockquote>' + expected.trimEnd() + '</blockquote>\n');
		a.equal(render('- ' + source.replaceAll('\n', '\n  '), options), '<ul><li>' + expected.trimEnd() + '</li></ul>\n');
		fail = true;
		a.throws(() => md.compile(source));
		fail = false;
		a.equal(md.compile(source).output, expected);
		a.equal(program().compile(source).output, render(source));
		a.equal(md.compile(source).output, expected);
	});
	a.test('renders real highlighter tokens and recovers from child scan failures', a => {
		const options = { resolveLanguage: () => highlight };
		a.equal(render('```md\n# Title\n```', options), '<pre><code class="language-md"><span class="heading"># </span><span class="heading">Title</span><span class="text">\n</span></code></pre>\n');
		let fail = true;
		let closed = 0;
		const child = createHighlighter(() => undefined, function* (window) {
			try {
				if (fail) throw new Error('scan failure');
				yield Object.assign(window.position(0, window.source.length, 0), {
					kind: 'text', highlight: 'string' as const, foldStart: 0, foldEnd: 0,
				});
				return { state: undefined, committed: window.source.length };
			} finally { closed++; }
		}, state => state);
		const md = program({ resolveLanguage: () => child });
		a.throws(() => md.compile('```test\nvalue\n```'));
		a.equal(closed, 1);
		fail = false;
		a.equal(md.compile('```test\nvalue\n```').output, '<pre><code class="language-test"><span class="string">value\n</span></code></pre>\n');
		a.equal(closed, 2);
	});
	a.test('embedded Markdown highlighting', highlightTests);
	a.test('retains native context and stable folds across checkpoint windows', a => {
		const value = '# One\nbody\n## Two\nbody\nTitle\n=====\nlast';
		const source = highlightSource(value);
		const expected = drain(highlight.resume({ source })).tokens;
		const prefix = drain(highlight.resume({ source, end: Math.floor(value.length / 2) }));
		const snapshot = JSON.stringify(prefix.tokens);
		const suffix = drain(highlight.resume({ source }, prefix.checkpoint));
		a.equalValues([...prefix.tokens, ...suffix.tokens], expected);
		a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens, suffix.tokens);
		a.equal(JSON.stringify(prefix.tokens), snapshot);
		let result = drain(highlight.resume({ source, end: 0 }));
		const tokens = [...result.tokens];
		for (let end = 1; end <= value.length; end++) {
			result = drain(highlight.resume({ source, end }, result.checkpoint));
			tokens.push(...result.tokens);
		}
		a.equalValues(tokens, expected);
		a.equal(result.checkpoint.committed, value.length);
		a.equal(result.checkpoint.done, true);
	});

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
				const tokens = [...highlight.resume({ source: highlightSource(source) })];
				a.equalValues(
					tokens.filter(token => token.foldStart || token.foldEnd)
						.map(token => [source.slice(token.start, token.end), token.foldStart, token.foldEnd]),
					expected,
				);
				const iterator = highlight.resume({ source: highlightSource(source) });
				const first = iterator.next();
				if (!first.done) {
					const snapshot = { ...first.value };
					const other = highlight.resume({ source: highlightSource(source) });
					other.next();
					a.equalValues([first.value, ...iterator], tokens);
					a.equalValues(first.value, snapshot);
					a.equalValues([...other], tokens.slice(1));
				}
				a.equalValues([...highlight.resume({ source: highlightSource(source) })], tokens);
			}
		});
		it.test('highlights an empty heading and a lone backtick within the source', a => {
			for (const [source, kind] of [['# ', 'heading'], ['`', 'text']] as const) {
				const tokens = [...highlight.resume({ source: highlightSource(source) })];
				a.equalValues(
					tokens.map(({ highlight: kind, start, end }) => ({ kind, start, end })),
					[{ kind, start: 0, end: source.length }],
				);
			}
		});
		it.test('keeps incomplete Markdown spans ordered and within the source', a => {
			for (const source of ['## ', '#\t', '# ###', '  # ', '``', 'text `', '# `']) {
				const tokens = [...highlight.resume({ source: highlightSource(source) })];
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
			const tokens = [...highlight.resume({ source: highlightSource(source) })];
			a.equal(tokens.some(token => token.highlight === 'heading'), true);
			a.equal(tokens.filter(token => token.highlight === 'strong').length, 2);
			a.equal(tokens.filter(token => token.highlight === 'code').length, 2);
			a.equal(tokens.every(token => token.highlight !== 'keyword'), true);
			a.equal(tokens.every(token => token.source === source), true);
			a.equal(tokens.every(token => token.line === source.slice(0, token.start).split('\n').length - 1), true);
			a.equalValues([...highlight.resume({ source: highlightSource('') })], []);
		});
		it.test('preserves inline code offsets and accepts an unclosed fence', a => {
			const source = 'first\n\ntext `code`\n';
			const code = [...highlight.resume({ source: highlightSource(source) })].find(token => token.highlight === 'code');
			a.equal(code?.start, 12);
			a.equal(code?.end, 18);
			a.equal(code?.line, 2);
			a.equalValues([...highlight.resume({ source: highlightSource(source) })], [...highlight.resume({ source: highlightSource(source) })]);
			a.equal([...highlight.resume({ source: highlightSource('```ts\nconst value =') })].length > 0, true);
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

function highlightSource(value: string) {
	return { id: {}, version: 1, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}
