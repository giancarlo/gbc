const { buildCxl, tsBundle } = require('../../cxl/dist/build');

buildCxl({
	outputDir: '../dist/cli',
	tasks: [tsBundle('tsconfig.json', 'gbc.js', true)],
});
