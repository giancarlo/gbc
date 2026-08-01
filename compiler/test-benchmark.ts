import { spec } from '@cxl/spec';

import { instantiateWasm } from './host.js';
import { Program } from './program.js';

const TAIL_SOURCE = `export run = (): Int32 { spin(0, 0) };
spin = (i: Int32, total: Int32): Int32 {
	i >= 10000 ? total : spin(i + 1, total + i)
}`;

const CALL_SOURCE = `export run = (): Int32 { even(0, 0) };
even = (i: Int32, total: Int32): Int32 {
	i >= 10000 ? total : odd(i + 1, total + i)
};
odd = (i: Int32, total: Int32): Int32 {
	i >= 10000 ? total : even(i + 1, total + i)
}`;

function compileRun(source: string): () => number {
	const entry = '/benchmark.gb';
	const program = Program({
		sys: {
			readFile: path => {
				if (path !== entry)
					throw new Error(`unexpected benchmark source read: ${path}`);
				return source;
			},
			readBytes: path => {
				throw new Error(`unexpected benchmark byte read: ${path}`);
			},
		},
	});
	const result = program.compileFile(entry, { requireMain: false });
	if (result.errors.length || !result.bytes)
		throw new Error(result.errors.map(e => e.message).join('; '));
	const instance = instantiateWasm(result.bytes);
	const run = instance.exports.run;
	if (typeof run !== 'function') throw new Error('run export is unavailable');
	return () => Number(run());
}

export default spec('Tail recursion benchmarks', s => {
	const loop = compileRun(TAIL_SOURCE);
	const calls = compileRun(CALL_SOURCE);
	const expected = 49_995_000;
	if (loop() !== expected || calls() !== expected)
		throw new Error('benchmark checksum mismatch');

	s.test('direct self-tail two-field accumulator', a =>
		a.benchmark(loop, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
	s.test('mutual tail-call two-field baseline', a =>
		a.benchmark(calls, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
});
