import { TestApi, spec } from '@cxl/spec';
import { program } from './index.js';
import tests from './test-commonmark.js';

type MdTest = {
	md: string;
	html: string;
	section: string;
};

export default spec('markdown', (a: TestApi) => {
	const sections: Record<string, MdTest[]> = {};
	const testProgram = program();

	for (const test of tests) {
		const testApi = (sections[test.section] ??= []);
		testApi.push(test);
	}

	for (const section in sections) {
		a.test(section, t => {
			for (const test of sections[section])
				t.test(JSON.stringify(test.md), t2 => {
					const { output, errors } = testProgram.compile(test.md);
					t2.equal(output, test.html, test.md);
					t2.equal(errors.length, 0, 'No errors');
					if (errors.length) t2.log(errors);
				});
		});
	}
});
