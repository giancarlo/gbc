import type { TestApi } from '@cxl/spec';
import {
	CompilerError, createHighlighter, highlightSegments, shiftHighlightBuffer,
	type Highlighter, type HighlightToken, type HighlightBuffer,
} from '@cxl/gbc.sdk';
import { createMarkdownHighlighter, highlight } from './highlight.js';

function snapshot(value: string, id = {}, version = 1) {
	return { id, version, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}

function language() {
	return createHighlighter((): HighlightBuffer => ({ start: 0, line: 0, fragment: undefined }), function* (window, buffer) {
		const lines = highlightSegments(window, buffer, ch => ch === '\n', true);
		for (;;) {
			const next = lines.next();
			if (next.done) return { state: next.value, committed: next.value.start };
			const line = next.value;
			const token: HighlightToken = Object.assign(window.position(line.start, line.start + line.text.length, line.line), {
				kind: 'line', highlight: 'keyword' as const,
				foldStart: Number(line.text.startsWith('{')), foldEnd: Number(line.text.startsWith('}')),
			});
			if (line.text.startsWith('bad'))
				yield Object.assign(token, { highlight: 'error' as const, error: new CompilerError('bad line', window.position(line.start, line.start + 3, line.line)) });
			else yield token;
		}
	}, shiftHighlightBuffer);
}

export default function highlightTests(a: TestApi) {
	a.test('streams bodies before closure and preserves delimiters, diagnostics and child folds', a => {
		const names: string[] = [];
		const child = language();
		const md = createMarkdownHighlighter(name => { names.push(name); return name === 'test' ? child : undefined; });
		const value = '# Section\n```test extra\n{\nbad\n}\n```\nafter';
		const source = snapshot(value);
		const prefix = drain(md.resume({ source, end: value.indexOf('}\n') }));
		a.equal(prefix.tokens.some(token => token.highlight === 'keyword'), true);
		a.equal(prefix.checkpoint.committed > value.indexOf('```test'), true);
		const saved = JSON.stringify(prefix.tokens);
		const suffix = drain(md.resume({ source }, prefix.checkpoint));
		const tokens: (HighlightToken & { error?: CompilerError })[] = [...prefix.tokens, ...suffix.tokens];
		a.equalValues(tokens, drain(md.resume({ source })).tokens);
		a.equalValues(drain(md.resume({ source }, prefix.checkpoint)).tokens, suffix.tokens);
		a.equal(JSON.stringify(prefix.tokens), saved);
		a.equal(names.every(name => name === 'test'), true);
		a.equalValues(tokens.filter(token => token.highlight === 'code').map(token => value.slice(token.start, token.end)), ['```test extra\n', '```\n']);
		a.equalValues(tokens.filter(token => token.foldStart || token.foldEnd).map(token => [value.slice(token.start, token.end), token.foldStart, token.foldEnd]), [
			['# ', 1, 0], ['```test extra\n', 1, 0], ['{\n', 1, 0], ['}\n', 0, 1], ['```\n', 0, 1], ['after', 0, 1],
		]);
		for (const token of tokens) {
			a.equal(token.source, value);
			a.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
		}
		const error = tokens.find(token => token.error);
		a.equal(error?.error instanceof CompilerError, true);
		if (error?.error) {
			a.equal(error.error.position.start, value.indexOf('bad'));
			a.equal(error.error.position.line, 3);
			a.equal(error.error.position.source, value);
		}
	});

	a.test('preserves fallback behavior and only resolves fenced language tags', a => {
		const names: string[] = [];
		const md = createMarkdownHighlighter(name => { names.push(name); return undefined; });
		for (const value of ['```\nplain\n```', '~~~unknown options\nplain\n~~~', '    indented\n', '`inline`'])
			a.equalValues([...md.resume({ source: snapshot(value) })], [...highlight.resume({ source: snapshot(value) })]);
		a.equalValues(names, ['unknown']);
	});

	a.test('handles every chunk boundary, incomplete fences and valid closing lines', a => {
		const child = language();
		const md = createMarkdownHighlighter(() => child);
		for (const value of [
			'```test', '```test\n', '```test\nlast', '```test\nlast\n```',
			'~~~test\n{\n}\n~~~~\n', '  ```test\n  raw\n  ```\n',
			'```test\nx```\n    ```\n``` extra\n~~~\n``\n```\nafter',
			'```test\r\nbad\r\n```\r\n', 'before\n\n```test\none\ntwo\n```\n',
			'before\n```test\none\ntwo\n```\n', '```test\none\n```\t\nafter',
			'```test\none\n```\\t\nbody\n```\n', '    code\n\n```test\none\n```\n',
		]) {
			const source = snapshot(value);
			const expected = drain(md.resume({ source })).tokens;
			let result = drain(md.resume({ source, end: 0 }));
			const tokens = [...result.tokens];
			for (let end = 1; end <= value.length; end++) {
				result = drain(md.resume({ source, end }, result.checkpoint));
				tokens.push(...result.tokens);
			}
			a.equalValues(tokens, expected, value);
			a.equal(result.checkpoint.committed, value.length);
			a.equal(tokens.reduce((total, token) => total + token.foldStart - token.foldEnd, 0), 0);
			let end = 0;
			for (const token of tokens) {
				a.equal(token.start, end);
				a.equal(token.end > token.start && token.end <= value.length, true);
				end = token.end;
			}
			a.equal(end, value.length);
		}
	});

	a.test('recursively highlights Markdown without exposing outer delimiters to children', a => {
		const child = language();
		const md: Highlighter = createMarkdownHighlighter(name => name === 'md' ? md : name === 'test' ? child : undefined);
		const value = '~~~~md\n# Inner\n```test\nbad\n```\n~~~~\n';
		const source = snapshot(value);
		const tokens = [...md.resume({ source })];
		a.equal(tokens.some(token => token.highlight === 'heading'), true);
		a.equal(tokens.some(token => token.highlight === 'error'), true);
		a.equal(tokens.every(token => token.source === value), true);
		a.equal(tokens.reduce((count, token) => count + token.foldStart - token.foldEnd, 0), 0);
		let result = drain(md.resume({ source, end: 0 }));
		const streamed = [...result.tokens];
		for (let end = 1; end <= value.length; end++) {
			result = drain(md.resume({ source, end }, result.checkpoint));
			streamed.push(...result.tokens);
		}
		a.equalValues(streamed, tokens);
	});

	a.test('converges and rebases active child checkpoints across edits', a => {
		const md = createMarkdownHighlighter(() => languageHighlighter);
		const languageHighlighter = language();
		const value = '```test\none\ntwo\nthree\nbad\n```\nend';
		const source = snapshot(value);
		const end = value.indexOf('bad');
		const old = drain(md.resume({ source, end })).checkpoint;
		for (const insertion of ['prefix\n\n', 'another\n']) {
			const at = insertion === 'another\n' ? value.indexOf('two') : 0;
			const changed = snapshot(value.slice(0, at) + insertion + value.slice(at), source.id, 2);
			const fresh = drain(md.resume({ source: changed, end: end + insertion.length })).checkpoint;
			a.equal(md.equivalent(old, fresh), true);
			const rebased = md.rebase(old, changed, insertion.length, insertion.split('\n').length - 1);
			const expected = drain(md.resume({ source: changed })).tokens.filter(token => token.start >= rebased.committed);
			a.equalValues(drain(md.resume({ source: changed }, rebased)).tokens, expected);
		}
		const changed = snapshot(value.replace('bad', 'new'), source.id, 2);
		const resumed = drain(md.resume({ source: changed, edit: { previousVersion: 1, start: end } }, old));
		a.equalValues(resumed.tokens, drain(md.resume({ source: changed })).tokens.filter(token => token.start >= old.committed));
		a.throws(() => drain(md.resume({ source: changed }, old)));
		a.throws(() => drain(md.resume({ source }, { ...old })));
		a.throws(() => md.rebase(old, snapshot(value), 0, 0));
	});

	a.test('compares child lexer state rather than matching checkpoint offsets', a => {
		const child = createHighlighter(() => false, function* (window, flagged) {
			for (let start = window.start; start < window.start + window.text.length; start++)
				yield Object.assign(window.position(start, start + 1, window.line), { kind: 'char', highlight: 'keyword' as const, foldStart: 0, foldEnd: 0 });
			return { state: flagged || window.text.includes('x'), committed: window.start + window.text.length };
		}, state => state);
		const md = createMarkdownHighlighter(() => child);
		const value = '```test\nx\nsame\n```';
		const source = snapshot(value);
		const changed = snapshot(value.replace('x', 'y'), source.id, 2);
		const end = value.lastIndexOf('```');
		const old = drain(md.resume({ source, end })).checkpoint;
		const fresh = drain(md.resume({ source: changed, end })).checkpoint;
		a.equal(md.equivalent(old, fresh), false);
	});

	a.test('contains unmatched child folds within the fence', a => {
		const child = language();
		const md = createMarkdownHighlighter(() => child);
		for (const [body, close] of [['{\n', '```\n'], ['}\n', '```\n'], ['{\nlast', '']] as const) {
			const value = '# Outer\n```test\n' + body + close + (close ? 'after' : '');
			const tokens = [...md.resume({ source: snapshot(value) })];
			let depth = 0;
			for (const token of tokens) {
				depth += token.foldStart - token.foldEnd;
				a.equal(depth >= 0, true);
				if (value.slice(token.start, token.end) === '```\n') a.equal(depth, 1);
			}
			a.equal(depth, 0);
		}
	});

	a.test('rebases lazy child source views after large deletions inside a fence', a => {
		const child = createHighlighter(() => undefined, function* (window) {
			a.equal(window.source.text().length, window.source.length);
			a.equal(window.source.text().slice(window.start, window.start + window.text.length), window.text);
			a.equal(window.source.read(0, window.source.length), window.source.text());
			let line = window.line;
			for (let start = window.start; start < window.start + window.text.length; start++) {
				yield Object.assign(window.position(start, start + 1, line), { kind: 'char', highlight: 'text' as const, foldStart: 0, foldEnd: 0 });
				if (window.text.charAt(start - window.start) === '\n') line++;
			}
			return { state: undefined, committed: window.start + window.text.length };
		}, state => state);
		const md = createMarkdownHighlighter(() => child);
		const value = '```test\n' + 'line\n'.repeat(20) + '```';
		const source = snapshot(value);
		const old = drain(md.resume({ source, end: 98 })).checkpoint;
		const changed = snapshot(value.slice(0, 8) + value.slice(68), source.id, 2);
		const fresh = drain(md.resume({ source: changed, end: 38 })).checkpoint;
		a.equal(md.equivalent(old, fresh), true);
		const moved = md.rebase(old, changed, -60, -12);
		a.equalValues(drain(md.resume({ source: changed }, moved)).tokens,
			drain(md.resume({ source: changed })).tokens.filter(token => token.start >= moved.committed));
	});

	a.test('allows interleaved scans and retries after resolver failure', a => {
		const child = language();
		let fail = false;
		const md = createMarkdownHighlighter(() => {
			if (fail) throw new Error('resolver failure');
			return child;
		});
		const source = snapshot('before\n\n```test\none\ntwo\n```\n');
		const prefix = drain(md.resume({ source, end: 7 }));
		fail = true;
		a.throws(() => drain(md.resume({ source }, prefix.checkpoint)));
		fail = false;
		const expected = [...md.resume({ source })];
		const first = md.resume({ source });
		const second = md.resume({ source });
		const firstToken = first.next();
		const secondToken = second.next();
		if (!firstToken.done && !secondToken.done) {
			a.equalValues([firstToken.value, ...first], expected);
			a.equalValues([secondToken.value, ...second], expected);
		}
		a.equalValues([...prefix.tokens, ...md.resume({ source }, prefix.checkpoint)], expected);
	});

	a.test('closes child generators when the caller cancels iteration', a => {
		let closed = 0;
		const child = createHighlighter(() => undefined, function* (window) {
			try {
				for (let start = window.start; start < window.start + window.text.length; start++)
					yield Object.assign(window.position(start, start + 1, window.line), { kind: 'char', highlight: 'text' as const, foldStart: 0, foldEnd: 0 });
				return { state: undefined, committed: window.start + window.text.length };
			} finally { closed++; }
		});
		const md = createMarkdownHighlighter(() => child);
		for (const token of md.resume({ source: snapshot('```test\nbody\n```') })) {
			a.equal(token.highlight, 'code');
			break;
		}
		a.equal(closed, 1);
	});

	a.test('reads large streamed bodies once without materializing the document', a => {
		const child = language();
		const md = createMarkdownHighlighter(() => child);
		const opener = '```test\n';
		const value = opener + 'line\n'.repeat(2000) + '```\n';
		let read = 0;
		const source = {
			...snapshot(value),
			read(start: number, end: number) { read += end - start; return value.slice(start, end); },
			text(): string { throw new Error('Unexpected materialization'); },
		};
		let result = drain(md.resume({ source, end: opener.length }));
		for (let end = opener.length + 500; end < value.length; end += 500)
			result = drain(md.resume({ source, end }, result.checkpoint));
		result = drain(md.resume({ source }, result.checkpoint));
		a.equal(result.checkpoint.done, true);
		a.equal(read, value.length + 2000 * 5);
	});

	a.test('benchmarks resuming a large embedded fence tail', async a => {
		const child = language();
		const md = createMarkdownHighlighter(() => child);
		const source = snapshot('```test\n' + 'line\n'.repeat(2000) + '```\n');
		const prefix = drain(md.resume({ source, end: source.length - 164 }));
		await a.benchmark(() => drain(md.resume({ source }, prefix.checkpoint)).tokens.length, {
			warmup: 50, sampleTime: 20, samples: 10, maxRegression: 15,
		});
	});
}
