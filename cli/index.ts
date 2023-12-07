///<amd-module name="@cxl/gbc.cli"/>
import { readFileSync /*writeFileSync, existsSync*/ } from 'fs';
import { basename, extname, join, resolve } from 'path';

import { parseParameters, program } from '@cxl/program';
import { Program } from '../compiler';
import { ast } from '../compiler/debug';
import { formatError } from '../sdk';

export interface Project {
	files: string[];
}

declare const WebAssembly: {
	validate(buffer: ArrayBuffer): boolean;
};

export default program('gbc', () => {
	const options = parseParameters(
		{
			outdir: {
				help: 'Output directory',
				type: 'string',
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
		const outdir = options.outdir ? resolve(options.outdir) : process.cwd();
		let hasErrors = false;

		for (const srcFile of options.$) {
			const resolvedFile = resolve(srcFile);
			const ext = extname(srcFile);
			const src = readFileSync(srcFile, 'utf8');
			const out = program.compile(src);

			if (out.errors.length) {
				hasErrors = true;
				console.log(resolvedFile);
				for (const e of out.errors) console.log(formatError(e));
			} else {
				const outFile = join(
					outdir,
					`${basename(resolvedFile, ext)}.js`,
				);
				console.log(outFile);
				console.log(ast(out.ast));
				console.log(out.output);

				//console.log('Valid: ', WebAssembly.validate(out.output));
			}
		}
		if (hasErrors) process.exitCode = 1;
	}
});

if (!require.main || require.main?.filename === __filename) exports.default();
