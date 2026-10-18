import { buildLibrary, file } from '@cxl/build';
import { execFileSync } from 'node:child_process';

if (process.argv.includes('test'))
	execFileSync(process.execPath, ['build.js', 'package'], { stdio: 'inherit' });

const stdlibFile = () => file('../dist/compiler/stdlib.gbm', 'stdlib.gbm');

await buildLibrary(
	{
		outputDir: '../dist/cli',
		tasks: [stdlibFile()],
	},
	{
		target: 'package',
		outputDir: '../dist/cli/package',
		tasks: [stdlibFile()],
	},
);
