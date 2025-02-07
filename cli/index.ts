#!/usr/bin/env node
///<amd-module name="@cxl/gbc.cli"/>
import { readFileSync, writeFileSync, mkdirSync /* existsSync*/ } from 'fs';
import { basename, extname, join, resolve } from 'path';

import { parseParameters, program } from './program';
import { Program } from '../compiler';
import { ast } from '../compiler/debug';
import { formatError } from '../sdk';

export interface Project {
	files: string[];
}

/*declare const WebAssembly: {
	validate(buffer: ArrayBuffer): boolean;
};*/

export default program('gbc', () => {
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
		},
		process.argv.slice(2).join(' '),
	);

	if (options.$) {
		const program = Program();
		let hasErrors = false;

		for (const srcFile of options.$) {
			const resolvedFile = resolve(srcFile);
			const src = readFileSync(resolvedFile, 'utf8');
			const out = program.compile(src);

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
					writeFileSync(outFile, out.output);

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
				} else console.log(out.output);
			}
		}
		if (hasErrors) process.exitCode = 1;
	}
});

if (!require.main || require.main?.filename === __filename) exports.default();
