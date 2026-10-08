import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildLibrary, file, rx, tsconfig } from '@cxl/build';

const { importmap } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
registerHooks({
	resolve(specifier, context, nextResolve) {
		const target = importmap[specifier];
		return nextResolve(
			target ? new URL(`..${target}`, import.meta.url).href : specifier,
			context,
		);
	},
});

let stdlibPromise;
function buildStdlib() {
	return (stdlibPromise ??= (async () => {
		const { buildStdlibBundle } = await import('../dist/compiler/program.js');
		const root = new URL('./stdlib/', import.meta.url);
		return Buffer.from(
			buildStdlibBundle(
				new URL('index.gb', root).pathname,
				new URL('test.gb', root).pathname,
				{
					readFile: path => readFileSync(path, 'utf8'),
					readBytes: path => new Uint8Array(readFileSync(path)),
				},
				[
					new URL('math.gb', root).pathname,
					new URL('matrix.gb', root).pathname,
					new URL('time.gb', root).pathname,
				],
			),
		);
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
