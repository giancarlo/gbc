///<amd-module name="@cxl/gbc.cli"/>
import { readFileSync /*writeFileSync, existsSync*/ } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';

import { parseParameters, program } from '@cxl/program';
import { Program } from '../compiler';

export interface Project {
	files: string[];
}

export default program('gbc', () => {
	const options = parseParameters({}, process.argv.slice(2).join(' '));

	//log(pkg.version);

	if (options.$) {
		const program = Program();
		for (const srcFile of options.$) {
			const resolvedFile = resolve(srcFile);
			const ext = extname(srcFile);
			const src = readFileSync(srcFile, 'utf8');
			const out = program.compile(src);
			const outFile = join(
				dirname(resolvedFile),
				`${basename(resolvedFile, ext)}.js`,
			);
			console.log(outFile, out);
			//writeFileSync(outFile, out);
		}
	}
});

if (!require.main || require.main?.filename === __filename) exports.default();
