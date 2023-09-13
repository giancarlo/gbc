///<amd-module name="@cxl/gbc.gbx"/>
import { readFileSync } from 'fs';

import { parseParameters, program } from '@cxl/program';
import { Program } from '../compiler';

export interface Project {
	files: string[];
}

export default program('gbx', () => {
	const options = parseParameters({}, process.argv.slice(2).join(' '));

	if (options.$) {
		const program = Program();
		for (const srcFile of options.$) {
			const src = readFileSync(srcFile, 'utf8');
			new Function(program.compile(src))();
		}
	}
});

if (!require.main || require.main?.filename === __filename) exports.default();
