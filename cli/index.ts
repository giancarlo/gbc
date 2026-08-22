#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';

import { parseParameters, program } from '@cxl/program';
import { loadCompiler } from '../compiler/program.js';
import { runWasm } from '../compiler/host.js';
import { ast } from '../compiler/debug.js';
import { formatError } from '../sdk/index.js';

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

/** `gbc build entry.gb` — fuse the entry and its imports into one wasm.
 * With `main` the artifact is runnable; without, it exports the entry's
 * exported fns for host embedding (inits run in the start section). */
function buildCommand(files: string[], outdir: string | undefined, debug = false): number {
	for (const srcFile of files) {
		const resolved = resolve(srcFile);
		const out = Program({ debug, sys: fileSys }).compileFile(resolved, {
			requireMain: false,
		});
		if (out.errors.length || !out.bytes) {
			for (const e of out.errors) console.error(formatError(e));
			return 1;
		}
		const dir = outdir ? resolve(outdir) : process.cwd();
		mkdirSync(dir, { recursive: true });
		const outFile = join(dir, `${basename(resolved, extname(resolved))}.wasm`);
		writeFileSync(outFile, out.bytes);
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

function testCommand(files: string[]): number {
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
			{ testMode: true },
		);
		if (out.errors.length || !out.bytes) {
			for (const e of out.errors) console.error(formatError(e));
			failures++;
			continue;
		}
		try {
			runWasm(out.bytes, chunk => {
				failures++;
				process.stdout.write(`${srcFile}: ${chunk}\n`);
			});
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
			debug: {
				help: 'Debug build: errors capture full call chains',
				type: 'boolean',
			},
		},
		process.argv.slice(2).join(' '),
	);

	const [cmd, ...rest] = options.$;
	if (cmd === 'run' && rest.length) {
		process.exitCode = runCommand(rest, !!options.debug);
		return;
	}
	if (cmd === 'build' && rest.length) {
		process.exitCode = buildCommand(rest, options.outdir, !!options.debug);
		return;
	}
	if (cmd === 'library' && rest.length) {
		process.exitCode = libraryCommand(rest, options.outdir);
		return;
	}
	if (cmd === 'test' && rest.length) {
		process.exitCode = testCommand(rest);
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
