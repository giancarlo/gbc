import { buildCxl, tsBundle, minify } from '@cxl/build';

buildCxl({
	target: 'package',
	outputDir: '../dist/compiler',
	tasks: [tsBundle('tsconfig.json', 'index.bundle.js', true).pipe(minify())],
});
