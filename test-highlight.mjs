import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild-wasm';

const root = import.meta.dirname;
const cases = {
	javascript: ['const value = 42;', "'unfinished", ['keyword', 'identifier', 'operator', 'number', 'punctuation']],
	typescript: ['const value: number = 42;', '/* unfinished', ['keyword', 'identifier', 'punctuation', 'type', 'operator', 'number', 'punctuation']],
	html: ['<div id="x">hi</div>', '<div id="', ['punctuation', 'tag', 'attribute', 'operator', 'string', 'punctuation', 'text', 'punctuation', 'punctuation', 'tag', 'punctuation']],
	compiler: ['var value = 42', '0xg var value = 1', ['keyword', 'identifier', 'operator', 'number']],
	basic: ['10 PRINT "hi", 42', '` PRINT 1', ['label', 'keyword', 'string', 'punctuation', 'number']],
	markdown: ['# Heading\n\n**bold** and `code`\n\n```ts\nconst value = 42;\n```\n', '```ts\nconst value ='],
	cmd: ['if echo "hi"; then echo 42; fi', 'echo "unterminated', ['keyword', 'identifier', 'string', 'punctuation', 'keyword', 'identifier', 'number', 'punctuation', 'keyword']],
};

function compile(args) {
	const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), ...args], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
}

compile(['-b', 'sdk', ...Object.keys(cases)]);
const fixture = await mkdtemp(join(root, 'dist/highlight-contract-'));
try {
	await mkdir(join(fixture, 'node_modules/@cxl'), { recursive: true });
	await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
	await symlink(join(root, 'dist/sdk'), join(fixture, 'node_modules/@cxl/gbc.sdk'));
	const require = createRequire(join(fixture, 'package.json'));
	const declarations = [];
	for (const [pkg, [source, incomplete, kinds]] of Object.entries(cases)) {
		const dir = join(fixture, 'packages', pkg);
		await mkdir(dir, { recursive: true });
		const metadata = JSON.parse(await readFile(join(root, pkg, 'package.json'), 'utf8'));
		await writeFile(join(dir, 'package.json'), JSON.stringify(metadata));
		const entries = {
			index: join(root, 'dist', pkg, 'index.js'),
			highlight: join(root, 'dist', pkg, 'highlight.js'),
		};
		if (metadata.browser) entries['index.bundle'] = entries.index;
		await build({
			entryPoints: entries,
			outdir: dir,
			bundle: true,
			splitting: true,
			format: 'esm',
			platform: 'neutral',
			target: 'esnext',
			plugins: [{
				name: 'sdk',
				setup(api) {
					api.onResolve({ filter: /^@cxl\/gbc\.sdk$/ }, () => ({ path: join(root, 'dist/sdk/index.js') }));
				},
			}],
		});
		await copyFile(join(root, 'dist', pkg, 'highlight.d.ts'), join(dir, 'highlight.d.ts'));
		if (pkg === 'javascript' || pkg === 'typescript')
			await copyFile(join(root, 'dist', pkg, 'index.d.ts'), join(dir, 'index.d.ts'));
		await symlink(dir, join(fixture, 'node_modules', metadata.name));
		const { highlight } = await import(pathToFileURL(require.resolve(metadata.name + '/highlight')).href);
		const tokens = [...highlight(source)];
		assert(tokens.length > 0);
		assert.deepEqual([...highlight('')], []);
		if (kinds) assert.deepEqual(tokens.map(token => token.highlight), kinds);
		let end = 0;
		for (const token of tokens) {
			assert.equal(token.source, source);
			assert(token.start >= end && token.end > token.start && token.end <= source.length);
			assert.equal(token.line, source.slice(0, token.start).split('\n').length - 1);
			assert.notEqual(token.kind, 'eof');
			assert.equal(typeof token.highlight, 'string');
			assert.equal(token.foldStart, 0);
			assert.equal(token.foldEnd, 0);
			end = token.end;
		}
		const iterator = highlight(source);
		assert.equal(iterator.next().value.highlight, tokens[0].highlight);
		assert.deepEqual([...highlight(source)], tokens);
		assert([...highlight(incomplete)].length > 0);
		if (['compiler', 'basic', 'cmd'].includes(pkg))
			assert([...highlight(incomplete)].some(token => token.highlight === 'error'));
		if (pkg === 'markdown') {
			assert.equal(tokens.filter(token => token.highlight === 'code').length, 2);
			assert(!tokens.some(token => token.highlight === 'keyword'));
			for (const [source, kind] of [['# ', 'heading'], ['`', 'text']])
				assert.deepEqual(
					[...highlight(source)].map(({ highlight: kind, start, end }) => ({ kind, start, end })),
					[{ kind, start: 0, end: source.length }],
				);
		}
		declarations.push(`import { highlight as ${pkg}, type Highlighter as ${pkg}Highlighter, type HighlightToken as ${pkg}Token } from '${metadata.name}/highlight';
const ${pkg}Fn: ${pkg}Highlighter = ${pkg};
const ${pkg}Tokens: ${pkg}Token[] = [...${pkg}Fn('source')];
void ${pkg}Tokens;`);
		console.log(`${pkg}: public highlighting contract passed`);
	}
	const consumer = join(fixture, 'consumer.mts');
	await writeFile(consumer, declarations.join('\n'));
	compile(['--ignoreConfig', '--noEmit', '--strict', '--module', 'nodenext', '--target', 'es2025', consumer]);
	console.log('Public TypeScript declarations passed');
} finally {
	await rm(fixture, { recursive: true, force: true });
}
