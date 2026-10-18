import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

export function buildNative(ir: string, output: string): void {
	const { command, args, target } = nativeToolchain(process.platform, process.arch);
	mkdirSync(dirname(output), { recursive: true });
	const directory = mkdtempSync(join(dirname(output), '.gbc-native-'));
	try {
		const bitcode = run('opt', [`-mtriple=${target}`, '-passes=default<O2>', '-o', '-', '-'], ir);
		const object = join(directory, 'program.o');
		run('llc', [`-mtriple=${target}`, '-O2', '-filetype=obj', '-relocation-model=pic', '-o', object, '-'], bitcode);
		const executable = join(directory, 'program');
		run(command, [...args, object, '-o', executable]);
		renameSync(executable, output);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
