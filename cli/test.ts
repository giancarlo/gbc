import { spec } from '@cxl/spec';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

	s.test('formats a file through the CLI', a => {
		const directory = mkdtempSync(join(tmpdir(), 'gbc-fmt-'));
		const path = join(directory, 'input.gb');
		const source = 'value = true?1:false?2:3;\n';
		const expected = 'value = true ? 1\n: false ? 2\n: 3;\n';
		const executable = new URL('./index.js', import.meta.url);
		try {
			writeFileSync(path, source);
			const before = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', '--check', path],
				{ encoding: 'utf8' },
			);
			a.equal(before.status, 1);
			a.equal(before.stderr, `${path}: formatting differs\n`);

			const formatted = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', path],
				{ encoding: 'utf8' },
			);
			a.equal(formatted.status, 0);
			a.equal(readFileSync(path, 'utf8'), expected);

			const after = spawnSync(
				process.execPath,
				[executable.pathname, 'fmt', '--check', path],
				{ encoding: 'utf8' },
			);
			a.equal(after.status, 0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
