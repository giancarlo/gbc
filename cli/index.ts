#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';

import { parseParameters, program } from '@cxl/program';
import { loadCompiler, type CompileOptions } from '../compiler/program.js';
import { runWasm } from '../compiler/host.js';
import { ast } from '../compiler/debug.js';
import { formatError } from '../sdk/index.js';
import { buildLlvmWasm, buildNative, runNativeTests } from './llvm.js';

const { Program } = await loadCompiler(async () =>
	new Uint8Array(await readFile(new URL('./stdlib.gbm', import.meta.url))),
);

export interface Project {
	files: string[];
}

const fileSys = {
	readFile: (path: string) => readFileSync(path, 'utf8'),
	readBytes: (path: string) => readFileSync(path),
};

/** `gbc run x.gb | x.wasm` — compile if needed, then execute; each `out`
 * emission is a line. `main` is a run requirement. */
function runCommand(files: string[], debug = false): number {
	for (const srcFile of files) {
		let bytes: Uint8Array;
		if (srcFile.endsWith('.wasm')) {
			bytes = readFileSync(resolve(srcFile));
		} else {
			const out = Program({ debug, sys: fileSys }).compileFile(
				resolve(srcFile),
				{ requireMain: true },
			);
			if (out.errors.length || !out.bytes) {
				for (const e of out.errors) console.error(formatError(e));
				return 1;
			}
			bytes = out.bytes;
		}
		try {
			const result = runWasm(bytes, chunk =>
				process.stdout.write(chunk),
			);
			if (result.exitCode !== 0) return result.exitCode;
		} catch (e) {
			console.error(`${srcFile}: ${e instanceof Error ? e.message : e}`);
			return 1;
		}
	}
	return 0;
}

function sameFile(source: string, output: string): boolean {
	const destination = statSync(output, { bigint: true, throwIfNoEntry: false });
	if (!destination) return false;
	const input = statSync(source, { bigint: true });
	return input.dev === destination.dev && input.ino === destination.ino;
}

/** `gbc build entry.gb` — fuse the entry and its imports into one wasm.
 * With `main` the artifact is runnable; without, it exports the entry's
 * exported fns for host embedding (inits run in the start section). */
function buildCommand(
	files: string[], outdir: string | undefined, debug: boolean, target: NonNullable<CompileOptions['target']>,
): number {
	for (const srcFile of files) {
		const resolved = resolve(srcFile);
		const out = Program({ debug, sys: fileSys }).compileFile(resolved, {
			requireMain: target !== 'wasm',
			target,
		});
		if (out.errors.length || (target === 'wasm' ? !out.bytes : out.ir === undefined)) {
			for (const e of out.errors) console.error(formatError(e));
			return 1;
		}
		const dir = outdir ? resolve(outdir) : process.cwd();
		if (out.ir !== undefined) {
			const native = target === 'llvm';
			const output = join(dir, basename(resolved, extname(resolved)) + (native ? '' : '.wasm'));
			try {
				if (output === resolved || (!native && sameFile(resolved, output)))
					throw new Error(`${native ? 'Native' : 'LLVM Wasm'} output would overwrite source; choose a different --outdir`);
				(native ? buildNative : buildLlvmWasm)(out.ir, output);
				process.stdout.write(`${output}\n`);
			} catch (error) {
				console.error(`${srcFile}: ${error instanceof Error ? error.message : error}`);
				return 1;
			}
			continue;
		}
		mkdirSync(dir, { recursive: true });
		const outFile = join(dir, `${basename(resolved, extname(resolved))}.wasm`);
		if (out.bytes) writeFileSync(outFile, out.bytes);
		process.stdout.write(
			`${outFile}${out.hasMain ? '' : ' (library exports, no main)'}\n`,
		);
	}
	return 0;
}

/** `gbc library entry.gb` — validate the closure, seal it into a `.gbm`
 * bundle (checked graphs + closure hashes) for dependency-free distribution. */
function libraryCommand(files: string[], outdir: string | undefined): number {
	for (const srcFile of files) {
		const resolved = resolve(srcFile);
		const out = Program({ sys: fileSys }).buildLibrary(resolved);
		if (out.errors.length || !out.bundle) {
			for (const e of out.errors) console.error(e.message);
			return 1;
		}
		const dir = outdir ? resolve(outdir) : process.cwd();
		mkdirSync(dir, { recursive: true });
		const outFile = join(dir, `${basename(resolved, extname(resolved))}.gbm`);
		writeFileSync(outFile, out.bundle);
		process.stdout.write(`${outFile}\n`);
	}
	return 0;
}

function testCommand(files: string[], native: boolean): number {
	let failures = 0;
	for (const srcFile of files) {
		if (srcFile.endsWith('.gbm')) {
			console.error(
				`${srcFile}: a .gbm bundle carries no #test blocks — run \`gbc test\` on the source`,
			);
			return 1;
		}
		// Tests run as debug builds: error values carry full call chains.
		const out = Program({ debug: true, sys: fileSys }).compileFile(
			resolve(srcFile),
			{ testMode: true, target: native ? 'llvm' : 'wasm' },
		);
		if (out.errors.length || (native ? out.ir === undefined : !out.bytes)) {
			for (const e of out.errors) console.error(formatError(e));
			failures++;
			continue;
		}
		try {
			const report = (chunk: string) => {
				failures++;
				process.stdout.write(`${srcFile}: ${chunk}\n`);
			};
			if (native && out.ir !== undefined) runNativeTests(out.ir, report);
			else if (out.bytes) runWasm(out.bytes, report);
		} catch (e) {
			failures++;
			console.error(`${srcFile}: ${e instanceof Error ? e.message : e}`);
		}
	}
	if (failures) {
		process.stdout.write(`${failures} failed\n`);
		return 1;
	}
	process.stdout.write('ok\n');
	return 0;
}

function formatCommand(files: string[], check: boolean): number {
	const program = Program({ sys: fileSys });
	let failed = false;
	for (const srcFile of files) {
		const resolved = resolve(srcFile);
		const formatted = program.formatFile(resolved);
		if (formatted.errors.length) {
			for (const error of formatted.errors) console.error(formatError(error));
			failed = true;
			continue;
		}
		if (!formatted.changed) continue;
		if (check) {
			console.error(`${srcFile}: formatting differs`);
			failed = true;
		} else writeFileSync(resolved, formatted.source);
	}
	return failed ? 1 : 0;
}

function buildTarget(
	command: string | undefined, files: string[],
	{ native, wasm, _llvm_wasm: llvmWasm }: { native?: boolean; wasm?: boolean; _llvm_wasm?: boolean },
): CompileOptions['target'] {
	if (llvmWasm) {
		if (command === 'build' && files.length && !native && !wasm) return 'llvm-wasm';
		console.error('gbc: --llvm-wasm requires build with source files and cannot be combined with --native or --wasm');
	} else if (native) {
		if ((command === 'build' || command === 'test') && files.length && !wasm) return 'llvm';
		console.error('gbc: --native requires build or test with source files and cannot be combined with --wasm');
	} else return 'wasm';
}

const start = program('gbc', () => {
	const options = parseParameters(
		{
			outdir: {
				help: 'Output directory',
				type: 'string',
			},
			types: {
				help: 'Output Typescript declaration file',
				type: 'boolean',
			},
			wasm: {
				help: 'Target WebAssembly',
				type: 'boolean',
			},
			native: {
				help: 'Build a native Linux or macOS executable using LLVM (ARM64/x86-64)',
				type: 'boolean',
			},
			_llvm_wasm: {
				help: 'Build a runnable WebAssembly program using LLVM and wasm-ld',
				type: 'boolean',
			},
			debug: {
				help: 'Debug build: errors capture full call chains',
				type: 'boolean',
			},
			check: {
				help: 'Check formatting without changing files',
				type: 'boolean',
			},
		},
		process.argv.slice(2).map(arg => arg === '--llvm-wasm' ? '--_llvm_wasm' : arg).join(' '),
	);

	const [cmd, ...rest] = options.$;
	const target = buildTarget(cmd, rest, options);
	if (!target) {
		process.exitCode = 1;
		return;
	}
	if (cmd === 'run' && rest.length) {
		process.exitCode = runCommand(rest, !!options.debug);
		return;
	}
	if (cmd === 'build' && rest.length) {
		process.exitCode = buildCommand(rest, options.outdir, !!options.debug, target);
		return;
	}
	if (cmd === 'library' && rest.length) {
		process.exitCode = libraryCommand(rest, options.outdir);
		return;
	}
	if (cmd === 'test' && rest.length) {
		process.exitCode = testCommand(rest, !!options.native);
		return;
	}
	if (cmd === 'fmt') {
		if (!rest.length) {
			console.error('gbc fmt: expected at least one file');
			process.exitCode = 1;
			return;
		}
		process.exitCode = formatCommand(rest, !!options.check);
		return;
	}

	if (options.$.length) {
		// Bare `gbc x.gb` — module-aware check: a main-less file validates as
		// a library module; with `main` it compiles as a program. Artifacts
		// only with --outdir.
		const program = Program({ sys: fileSys, debug: !!options.debug });
		let hasErrors = false;

		for (const srcFile of options.$) {
			const resolvedFile = resolve(srcFile);
			const out = program.compileFile(resolvedFile, {
				requireMain: false,
			});

			if (out.errors.length) {
				hasErrors = true;
				for (const e of out.errors) console.error(formatError(e));
			} else {
				if (options.outdir) {
					const ext = extname(srcFile);
					const outdir = options.outdir
						? resolve(options.outdir)
						: process.cwd();
					const outFile = join(
						outdir,
						`${basename(resolvedFile, ext)}.js`,
					);
					mkdirSync(outdir, { recursive: true });
					if (out.bytes) writeFileSync(outFile, out.bytes);

					if (options.types) {
						const dts = program.compileTypes(out.ast);
						const dtsFile = join(
							outdir,
							`${basename(resolvedFile, ext)}.d.ts`,
						);
						console.log(ast(out.ast));
						console.log(dts);
						writeFileSync(dtsFile, dts);
					}
				}
			}
		}
		if (hasErrors) process.exitCode = 1;
	}
});

export default start;

if (import.meta.main) await start();
