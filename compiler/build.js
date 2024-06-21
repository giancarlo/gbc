const { buildCxl, tsBundle, minify } = require('../../cxl/dist/build');

buildCxl({
	outputDir: '../dist/compiler',
	tasks: [tsBundle('tsconfig.json', 'index.bundle.js', true).pipe(minify())],
});
