const { buildCxl, tsBundle } = require('@cxl/build');

buildCxl({
	outputDir: '../dist/cli',
	tasks: [tsBundle('tsconfig.json', 'gbc.js', true)],
});
