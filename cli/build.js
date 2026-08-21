import { buildLibrary, file } from '@cxl/build';

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
