import { spec, type TestApi } from '@cxl/spec';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import cli from './index.js';
import { nativeToolchain } from './native.js';
import { Program } from '../compiler/program.js';
import { runWasm } from '../compiler/host.js';

const execute = promisify(execFile);
const executable = new URL('./package/index.js', import.meta.url).pathname;

export default spec('gbc', s => {
	s.test('should load', a => {
		a.ok(cli);
	});

	s.test('selects matching native host toolchains and rejects mismatched targets', a => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-toolchain-test-'));
		const previousPath = process.env.PATH;
		try {
			process.env.PATH = directory;
			for (const platform of ['linux', 'darwin'] as const)
				for (const arch of ['arm64', 'x64']) {
					const cpu = arch === 'x64' ? 'x86_64' : platform === 'darwin' ? 'arm64' : 'aarch64';
					const target = `${cpu}-${platform === 'linux' ? 'unknown-linux-gnu' : 'apple-macosx13.0.0'}`;
					const command = platform === 'linux' ? 'cc' : 'xcrun';
					const args = platform === 'linux' ? ['-dumpmachine'] : ['--sdk', 'macosx', 'clang', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-print-target-triple'];
					const tool = join(directory, command);
					for (const output of [target, '', 'x86_64-pc-windows-msvc', 'armv7-unknown-linux-gnueabihf', `${arch === 'x64' ? 'aarch64' : 'x86_64'}-${platform === 'linux' ? 'unknown-linux-gnu' : 'apple-darwin'}`, `${cpu}-${platform === 'linux' ? 'apple-darwin' : 'unknown-linux-gnu'}`]) {
						writeFileSync(tool, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(args))}) process.exit(9); process.stdout.write(${JSON.stringify(output)});\n`, { mode: 0o755 });
						if (output === target) a.equal(nativeToolchain(platform, arch).target, target);
						else a.throws(() => nativeToolchain(platform, arch), {
							message: `${command}: target ${JSON.stringify(output)} does not match ${platform} ${arch}`,
						});
					}
				}
			for (const [platform, arch] of [['win32', 'x64'], ['linux', 'arm'], ['darwin', 'ia32']] as const)
				a.throws(() => nativeToolchain(platform, arch), {
					message: 'Native builds support Linux and macOS on ARM64 and x86-64',
				});
		} finally {
			if (previousPath === undefined) delete process.env.PATH;
			else process.env.PATH = previousPath;
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('runs a compiled program through the host', (a: TestApi) => {
		const out = Program().compile(`main { 'hi' >> out; 42 >> out }`);
		a.equal(out.errors.length, 0);
		a.assert(out.bytes);
		const lines: string[] = [];
		runWasm(out.bytes, chunk => lines.push(chunk));
		a.equal(lines[0], 'hi');
		a.equal(lines[1], '42');
	});

	s.test('runs #test blocks in test mode', (a: TestApi) => {
		const out = Program().compileTest(
			`#test { equal(dbl(2), 4); equal(dbl(3), 7) }
export dbl = (n: Int32): Int32 { n * 2 };`,
		);
		a.equal(out.errors.length, 0);
		a.assert(out.bytes);
		const failures: string[] = [];
		runWasm(out.bytes, chunk => failures.push(chunk));
		a.equal(failures.length, 1);
		a.equal(failures[0], '6 != 7');
	});

	s.test('builds native executables with LLVM and preserves Wasm output', async (a: TestApi) => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		try {
			const fixtures = [
				{ name: 'answer', source: 'main { 42 >> out }', output: '42' },
				{ name: 'empty', source: 'main {}', output: '' },
				{ name: 'limits', source: 'main { -2147483648 >> out; 0 >> out; 2147483647 >> out }', output: '-214748364802147483647' },
			];
			await Promise.all(fixtures.map(async fixture => {
				const path = join(directory, `${fixture.name}.gb`);
				writeFileSync(path, fixture.source);
				await execute(process.execPath, [executable, 'build', '--native', '--outdir', directory, path]);
				const native = await execute(join(directory, fixture.name));
				a.equal(native.stdout, fixture.output);
				const wasm = Program().compile(fixture.source);
				a.assert(wasm.bytes);
				let expected = '';
				runWasm(wasm.bytes, chunk => { expected += chunk; });
				a.equal(native.stdout, expected);
			}));
			const path = join(directory, 'answer.gb');
			const wasm = await execute(process.execPath, [executable, 'build', '--outdir', directory, path]);
			a.equal(wasm.stdout.trim(), join(directory, 'answer.wasm'));
			const run = await execute(process.execPath, [executable, 'run', join(directory, 'answer.wasm')]);
			a.equal(run.stdout, '42');
			a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('rejects unsupported native builds without replacing an executable', a => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const path = join(directory, 'input.gb');
		const output = join(directory, 'input');
		try {
			writeFileSync(output, 'previous executable');
			for (const source of ['main {', 'main { missing >> out }', "main { 'hello' >> out }", 'value = 42']) {
				writeFileSync(path, source);
				const result = spawnSync(process.execPath, [executable, 'build', '--native', '--outdir', directory, path], { encoding: 'utf8' });
				a.equal(result.status, 1);
				a.ok(result.stderr.length > 0);
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
			}
			writeFileSync(path, 'main { 42 >> out }');
			for (const args of [['run', '--native', path], ['build', '--native', '--wasm', path], ['build', '--native', '--debug', path], ['build', '--native']]) {
				const result = spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8' });
				a.equal(result.status, 1);
				a.ok(result.stderr.length > 0);
			}
			const extensionless = join(directory, 'source');
			const source = 'main { 42 >> out }';
			writeFileSync(extensionless, source);
			const collision = spawnSync(process.execPath, [executable, 'build', '--native', '--outdir', directory, extensionless], { encoding: 'utf8' });
			a.equal(collision.status, 1);
			a.ok(collision.stderr.includes('overwrite source'));
			a.equal(readFileSync(extensionless, 'utf8'), source);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('cleans up failed native toolchains and permits retry', a => {
		const { command, target } = nativeToolchain(process.platform, process.arch);
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const tools = join(directory, 'tools');
		const path = join(directory, 'input.gb');
		const output = join(directory, 'input');
		const args = [executable, 'build', '--native', '--outdir', directory, path];
		try {
			mkdirSync(tools);
			writeFileSync(path, 'main { 42 >> out }');
			writeFileSync(output, 'previous executable');
			const missing = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: tools } });
			a.equal(missing.status, 1);
			a.ok(missing.stderr.includes(`${command}:`));
			a.equal(readFileSync(output, 'utf8'), 'previous executable');
			const driver = join(tools, command);
			for (const reportedTarget of ['', target]) {
				writeFileSync(driver, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(reportedTarget)});\n`, { mode: 0o755 });
				const rejected = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: tools } });
				a.equal(rejected.status, 1);
				a.ok(rejected.stderr.includes(reportedTarget ? 'opt:' : 'target'));
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
				a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
			}
			rmSync(driver);
			for (const tool of ['opt', 'llc', command]) {
				const fixture = join(tools, tool);
				writeFileSync(fixture, `#!${process.execPath}\nif (process.argv.includes('-dumpmachine') || process.argv.includes('-print-target-triple')) { process.stdout.write(${JSON.stringify(target)}); } else { process.stderr.write('forced tool failure'); process.exit(23); }\n`, { mode: 0o755 });
				const failed = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } });
				a.equal(failed.status, 1);
				a.ok(failed.stderr.includes(`${tool}: forced tool failure`));
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
				a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
				rmSync(fixture);
			}
			const retry = spawnSync(process.execPath, args, { encoding: 'utf8' });
			a.equal(retry.status, 0);
			a.equal(spawnSync(output, [], { encoding: 'utf8' }).stdout, '42');
			a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('formats a file through the CLI', a => {
		const directory = mkdtempSync(join(tmpdir(), 'gbc-fmt-'));
		const path = join(directory, 'input.gb');
		const source = 'value = true?1:false?2:3;\n';
		const expected = 'value = true ? 1\n: false ? 2\n: 3;\n';
		const executable = new URL('./package/index.js', import.meta.url);
		try {
			writeFileSync(path, source);
			const before = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', '--check', path],
				{ encoding: 'utf8' },
			);
			a.equal(before.status, 1);
			a.equal(before.stderr, `${path}: formatting differs\n`);

			const formatted = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', path],
				{ encoding: 'utf8' },
			);
			a.equal(formatted.status, 0);
			a.equal(readFileSync(path, 'utf8'), expected);

			const after = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', '--check', path],
				{ encoding: 'utf8' },
			);
			a.equal(after.status, 0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
