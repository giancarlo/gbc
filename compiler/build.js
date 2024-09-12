const { buildCxl, tsBundle, minify } = require('@cxl/build');

buildCxl({
	target: 'package',
	outputDir: '../dist/compiler',
	tasks: [tsBundle('tsconfig.json', 'index.bundle.js', true).pipe(minify())],
});
