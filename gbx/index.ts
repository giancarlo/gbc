import { readFileSync } from 'fs';

import { parseParameters, program } from '@cxl/program';
import { Program } from '../compiler/program.js';

export interface Project {
	files: string[];
}

const start = program('gbx', () => {
	const options = parseParameters({}, process.argv.slice(2).join(' '));

	if (options.$) {
		const program = Program();
		for (const srcFile of options.$) {
			const src = readFileSync(srcFile, 'utf8');
			new Function(program.compile(src).output)();
		}
	}
});

export default start;

if (import.meta.main) start();
