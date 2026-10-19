import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
	const packages = { '@cxl/gbc.sdk': 'sdk', '@cxl/gbc.javascript': 'javascript' };
	return next(packages[specifier] ? new URL(`./dist/${packages[specifier]}/index.js`, import.meta.url).href : specifier, context);
} });
const path = new URL('./spec/highlight.json', import.meta.url);
const describe = tokens => tokens.map(t => [t.kind, t.highlight, t.start, t.end, t.line, t.foldStart, t.foldEnd, t.error ? [t.error.message, t.error.position.start, t.error.position.end, t.error.position.line] : null]);
const drain = iterator => { const tokens = []; for (;;) { const next = iterator.next(); if (next.done) return { tokens, checkpoint: next.value }; tokens.push(next.value); } };
const sourceOf = (value, id = {}, version = 1) => ({ id, version, length: value.length, read: (start, end) => value.slice(start, end), text: () => value });
const fixtures = JSON.parse(await readFile(path, 'utf8'));
const registered = Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async mode => [mode, (await import(`./dist/${mode}/highlight.js`)).highlight])));
for (const [mode, highlight] of Object.entries(registered)) {
	assert.equal(typeof highlight, 'object', `${mode}: legacy callable API must be removed`);
	for (const [value, expected] of fixtures[mode]) {
		const source = sourceOf(value);
		const full = drain(highlight.resume({ source }));
		assert.deepEqual(describe(full.tokens), expected, `${mode}: ${JSON.stringify(value)}`);
		for (let split = 0; split < value.length; split++) {
			const prefix = drain(highlight.resume({ source, end: split }));
			const suffix = drain(highlight.resume({ source }, prefix.checkpoint));
			assert.deepEqual(describe([...prefix.tokens, ...suffix.tokens]), expected, `${mode}: split ${split} ${JSON.stringify(value)}`);
			assert.deepEqual(describe(drain(highlight.resume({ source }, prefix.checkpoint)).tokens), describe(suffix.tokens));
			const cancelled = highlight.resume({ source }, prefix.checkpoint);
			const next = cancelled.next();
			if (!next.done) cancelled.return(prefix.checkpoint);
			assert.deepEqual(describe(drain(highlight.resume({ source }, prefix.checkpoint)).tokens), describe(suffix.tokens));
			for (const tail of ['\n', ' changed\nmore', '"\n{}']) {
				const edited = sourceOf(value.slice(0, split) + tail, source.id, 2);
				const rest = drain(highlight.resume({ source: edited, edit: { previousVersion: 1, start: split } }, prefix.checkpoint));
				assert.deepEqual(describe([...prefix.tokens, ...rest.tokens]), describe(drain(highlight.resume({ source: edited })).tokens), `${mode}: edit ${split}`);
			}
		}
		let checkpoint;
		const tokens = [];
		let materializations = 0;
		const bounded = { ...source, text() { materializations++; return value; }, read(start, end) { assert.equal(start, checkpoint?.offset ?? 0); assert.ok(end - start <= 1); return value.slice(start, end); } };
		for (let end = 0; end <= value.length; end++) {
			const result = drain(highlight.resume({ source: bounded, end }, checkpoint));
			tokens.push(...result.tokens); checkpoint = result.checkpoint;
		}
		assert.equal(materializations, 0, `${mode}: eager source materialization`);
		assert.deepEqual(describe(tokens), expected, `${mode}: character windows`);
		assert.equal(checkpoint.done, true);
		assert.equal(checkpoint.committed, value.length);
		for (const token of tokens) assert.equal(token.source, value);
	}
	console.log(`${mode}: checkpoint, edits, retries, cancellation, bounded reads and legacy fixtures passed`);
}

const longCases = {
	json: '{"key"' + ' \n'.repeat(10000) + ': true}',
	javascript: 'return /[' + 'x'.repeat(20000) + ']/g;\nconst y = 1;',
	typescript: '/*' + 'long\n'.repeat(4000) + '*/\nconst x: number = 1;',
	compiler: "var x = '" + 'long\n'.repeat(4000) + "${1} tail'\nvar y = 2",
	html: '<ul><li title="' + 'long\n'.repeat(4000) + '">first<li>second</ul>',
	markdown: '# One\n```\n' + 'long\n'.repeat(4000) + '```\n# Two\nbody',
	basic: 'IF x THEN ' + ' '.repeat(20000) + '\nPRINT 1\nEND IF',
	cmd: 'cat <<EOF\n' + 'long\n'.repeat(4000) + 'EOF\necho done',
};
for (const [mode, highlight] of Object.entries(registered)) {
	const value = longCases[mode];
	const source = sourceOf(value);
	let checkpoint;
	const tokens = [];
	let previousCommitted = 0;
	for (let end = 0; end < value.length; end += 127) {
		const result = drain(highlight.resume({ source, end }, checkpoint));
		checkpoint = result.checkpoint;
		assert.equal(checkpoint.offset, end);
		assert.ok(checkpoint.committed >= previousCommitted);
		assert.ok(result.tokens.every(token => token.end <= checkpoint.committed));
		previousCommitted = checkpoint.committed;
		tokens.push(...result.tokens);
	}
	tokens.push(...drain(highlight.resume({ source }, checkpoint)).tokens);
	assert.deepEqual(describe(tokens), describe(drain(highlight.resume({ source })).tokens), `${mode}: long lookahead`);
	const first = sourceOf('x\n' + value);
	const prefix = drain(highlight.resume({ source: first, end: 1 }));
	const snapshot = describe(prefix.tokens);
	const other = sourceOf(value);
	const interleaved = drain(highlight.resume({ source: other, end: 1 }));
	assert.throws(() => drain(highlight.resume({ source: first, end: -1 })));
	assert.throws(() => drain(highlight.resume({ source: first, end: first.length + 1 })));
	assert.throws(() => drain(highlight.resume({ source: other }, prefix.checkpoint)));
	assert.throws(() => drain(highlight.resume({ source: { ...first, version: 2 } }, prefix.checkpoint)));
	assert.throws(() => drain(highlight.resume({ source: first }, { ...prefix.checkpoint })));
	assert.throws(() => drain(highlight.resume({ source: { ...first, read() { throw new Error('Read failed'); } } }, prefix.checkpoint)));
	const retry = drain(highlight.resume({ source: first }, prefix.checkpoint));
	assert.deepEqual(describe([...prefix.tokens, ...retry.tokens]), describe(drain(highlight.resume({ source: first })).tokens));
	assert.deepEqual(describe([...interleaved.tokens, ...drain(highlight.resume({ source: other }, interleaved.checkpoint)).tokens]), describe(drain(highlight.resume({ source: other })).tokens));
	assert.deepEqual(describe(prefix.tokens), snapshot);
	assert.throws(() => drain(highlight.resume({ source: first }, retry.checkpoint)));
	for (const otherMode of Object.keys(registered).filter(key => key !== mode))
		assert.throws(() => drain(registered[otherMode].resume({ source: first }, prefix.checkpoint)));
	console.log(`${mode}: long lookahead, stable commits, invalid input and interleaved sessions passed`);
}

for (const header of ['[ref]: /url "title"\n', '[ref]: /url\n\u00a0"unclosed\n', '[ref]: /url\n \t\n']) {
	const value = header + 'body\n'.repeat(100) + 'end';
	const source = sourceOf(value);
	const prefix = drain(registered.markdown.resume({ source, end: value.length - 4 }));
	assert.ok(prefix.checkpoint.committed > value.length - 30, 'markdown: completed link definitions must not retain the remaining document');
}
