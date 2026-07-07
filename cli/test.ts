import { spec } from '@cxl/spec';
import cli from './index.js';
import { Program } from '../compiler/program.js';
import { runWasm } from '../compiler/host.js';

export default spec('gbc', s => {
	s.test('should load', a => {
		a.ok(cli);
	});

	s.test('runs a compiled program through the host', a => {
		const out = Program().compile(`main { 'hi' >> out; 42 >> out }`);
		a.equal(out.errors.length, 0);
		const lines: string[] = [];
		runWasm(out.bytes!, chunk => lines.push(chunk));
		a.equal(lines[0], 'hi');
		a.equal(lines[1], '42');
	});

	s.test('runs #test blocks in test mode', a => {
		const out = Program().compileTest(
			`#test { equal(dbl(2), 4); equal(dbl(3), 7) }
export dbl = (n: Int32): Int32 { n * 2 };`,
		);
		a.equal(out.errors.length, 0);
		const failures: string[] = [];
		runWasm(out.bytes!, chunk => failures.push(chunk));
		a.equal(failures.length, 1);
		a.equal(failures[0], '6 != 7');
	});
});
