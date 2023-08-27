const { buildCxl, tsBundle } = require('../../cxl/dist/build');

buildCxl({
	outputDir: '../dist/gbx',
	tasks: [tsBundle('tsconfig.json', 'gbx.js', true)],
});
