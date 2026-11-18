import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateWasmProgram } from '../compiler/host.js';

function run(tool: string, args: string[], input?: string | Buffer): Buffer {
	const result = spawnSync(tool, args, { input, maxBuffer: 16 * 1024 * 1024 });
	if (result.error) throw new Error(`${tool}: ${result.error.message}`);
	if (result.status !== 0)
		throw new Error(`${tool}: ${result.stderr.toString().trim() || `failed (${result.signal ?? result.status})`}`);
	return result.stdout;
}

export function nativeToolchain(platform: NodeJS.Platform, arch: string) {
	if ((platform !== 'linux' && platform !== 'darwin') || (arch !== 'arm64' && arch !== 'x64'))
		throw new Error('Native builds support Linux and macOS on ARM64 and x86-64');
	const command = platform === 'darwin' ? 'xcrun' : 'cc';
	const args = platform === 'darwin'
		? ['--sdk', 'macosx', 'clang', '-arch', arch === 'arm64' ? 'arm64' : 'x86_64']
		: [];
	const target = run(command, [...args, platform === 'darwin' ? '-print-target-triple' : '-dumpmachine']).toString().trim();
	const architecture = arch === 'arm64' ? /^(aarch64|arm64)-/ : /^x86_64-/;
	const system = platform === 'darwin' ? /-apple-(darwin|macosx)/ : /-linux(-|$)/;
	if (!/^[\w.-]+$/.test(target) || !architecture.test(target) || !system.test(target))
		throw new Error(`${command}: target ${JSON.stringify(target)} does not match ${platform} ${arch}`);
	return { command, args, target };
}

function buildWithLlvm(
	ir: string,
	output: string,
	target: string,
	prefix: string,
	objectOptions: string[],
	link: (object: string, artifact: string) => void,
): void {
	mkdirSync(dirname(output), { recursive: true });
	const directory = mkdtempSync(join(dirname(output), prefix));
	try {
		const bitcode = run('opt', [`-mtriple=${target}`, '-passes=default<O2>', '-o', '-', '-'], ir);
		const object = join(directory, 'program.o');
		run('llc', [`-mtriple=${target}`, '-O2', '-filetype=obj', ...objectOptions, '-o', object, '-'], bitcode);
		const artifact = join(directory, 'program');
		link(object, artifact);
		renameSync(artifact, output);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function buildNative(ir: string, output: string): void {
	const { command, args, target } = nativeToolchain(process.platform, process.arch);
	const math = process.platform === 'linux' ? ['-Wl,--as-needed', '-lm'] : ['-lm'];
	buildWithLlvm(ir, output, target, '.gbc-native-', ['-relocation-model=pic'], (object, artifact) => {
		run(command, [...args, object, ...math, '-o', artifact]);
	});
}

export function buildLlvmWasm(ir: string, output: string): void {
	buildWithLlvm(ir, output, 'wasm32-unknown-unknown', '.gbc-llvm-wasm-', ['-mattr=+simd128,+tail-call'], (object, artifact) => {
		run('wasm-ld', ['--no-entry', '--export=main', '--fatal-warnings', object, '-o', artifact]);
		validateWasmProgram(readFileSync(artifact));
	});
}

export function runNativeTests(ir: string, write: (chunk: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), 'gbc-test-'));
	try {
		const executable = join(directory, 'program');
		buildNative(ir, executable);
		const result = spawnSync(executable, { maxBuffer: 16 * 1024 * 1024 });
		if (result.error) throw result.error;
		const bytes = result.stdout;
		let offset = 0;
		while (offset + 4 <= bytes.length) {
			const end = offset + 4 + bytes.readUInt32LE(offset);
			if (end > bytes.length) break;
			write(bytes.toString('utf8', offset + 4, end));
			offset = end;
		}
		if (result.signal) throw new Error('unreachable');
		if (offset !== bytes.length) throw new Error('Invalid native test output');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
