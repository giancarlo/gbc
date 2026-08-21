import { readFile } from 'node:fs/promises';
import { buildLibrary, file, rx, tsconfig } from '@cxl/build';

let stdlibPromise;
function buildStdlib() {
	return (stdlibPromise ??= (async () => {
		const { buildStdlibBundle } = await import('../dist/compiler/program.js');
		const [prelude, time, test] = await Promise.all(
			['prelude', 'time', 'test'].map(name =>
				readFile(new URL(`./stdlib/${name}.gb`, import.meta.url), 'utf8'),
			),
		);
		return Buffer.from(buildStdlibBundle({ prelude, time, test }));
	})());
}

const generateStdlib = file(buildStdlib, 'stdlib.gbm');

await buildLibrary(
	{
		outputDir: '../dist/compiler',
		tasks: [rx.concat(tsconfig(), generateStdlib)],
	},
	{
		target: 'package',
		outputDir: '../dist/compiler/package',
		tasks: [file('../dist/compiler/stdlib.gbm', 'stdlib.gbm')],
	},
);
