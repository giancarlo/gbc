const { buildCxl, tsBundle } = require('@cxl/build');

buildCxl({
	outputDir: '../dist/gbx',
	tasks: [tsBundle('tsconfig.json', 'gbx.js', true)],
});
