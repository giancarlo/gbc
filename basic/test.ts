import { TestApi, spec } from '@cxl/spec';
import { compatibilityCases, demoNames } from './test-corpus.js';

declare const fetch: (url: URL) => Promise<{
	ok: boolean;
	status: number;
	text(): Promise<string>;
}>;
declare class URL {
	constructor(path: string, base: string);
}
declare global {
	interface ImportMeta {
		url: string;
	}
}

export default spec('basic', (a: TestApi) => {
	a.test('historical compatibility corpus', a => {
		a.ok(compatibilityCases.length > 0);
		a.equal(
			new Set(compatibilityCases.map(test => test.id)).size,
			compatibilityCases.length,
		);
		for (const test of compatibilityCases) a.ok(test.source.trim().length > 0);
	});

	a.test('demo corpus', async a => {
		const demos = await Promise.all(
			demoNames.map(async file => {
				const response = await fetch(
					new URL(`../../basic/fixtures/demo/${file}`, import.meta.url),
				);
				return {
					file,
					ok: response.ok,
					status: response.status,
					source: await response.text(),
				};
			}),
		);
		for (const demo of demos) {
			a.ok(demo.ok, `${demo.file}: ${demo.status}`);
			a.ok(demo.source.trim().length > 0);
		}
	});
});
