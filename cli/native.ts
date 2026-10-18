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

export function buildNative(ir: string, output: string): void {
	if (process.platform !== 'linux' || process.arch !== 'arm64')
		throw new Error('Native builds currently support only Linux ARM64');
	mkdirSync(dirname(output), { recursive: true });
	const directory = mkdtempSync(join(dirname(output), '.gbc-native-'));
	try {
		const bitcode = run('opt', ['-passes=default<O2>', '-o', '-', '-'], ir);
		const object = join(directory, 'program.o');
		run('llc', ['-O2', '-filetype=obj', '-relocation-model=pic', '-o', object, '-'], bitcode);
		const executable = join(directory, 'program');
		run('cc', [object, '-o', executable]);
		renameSync(executable, output);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
