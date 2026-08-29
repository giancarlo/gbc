import { spec } from '@cxl/spec';

import { instantiateWasm } from './host.js';
import { Program } from './index.js';

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

const SCALAR_FLOAT_SOURCE = `samples = Buffer<Float32>(1024);
export run = (): Float64 { scalar(0, 0.0) };
scalar = (index: Int32, total: Float64): Float64 {
	index >= 1024
		? total
		: scalar(
			index + 4,
			total + Float64(get(samples, index))
				+ Float64(get(samples, index + 1))
				+ Float64(get(samples, index + 2))
				+ Float64(get(samples, index + 3))
		)
}`;

const SIMD_FLOAT_SOURCE = `samples = Buffer<Float32>(1024);
export run = (): Float32 {
	simd.sum(vector(0, Vector<Float32>(Float32(0))))
};
vector = (
	index: Int32,
	total: Vector<Float32>
): Vector<Float32> {
	index >= 1024
		? total
		: vector(index + 4, total + Vector<Float32>(samples, index))
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
	const scalarFloat = compileRun(SCALAR_FLOAT_SOURCE);
	const simdFloat = compileRun(SIMD_FLOAT_SOURCE);
	const expected = 49_995_000;

	s.test('benchmark checksums', a => {
		a.equal(loop(), expected);
		a.equal(calls(), expected);
		a.equal(scalarFloat(), 0);
		a.equal(simdFloat(), 0);
	});

	s.test('direct self-tail two-field accumulator', a =>
		a.benchmark(loop, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
	s.test('mutual tail-call two-field baseline', a =>
		a.benchmark(calls, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
	s.test('contiguous Float32 scalar accumulation', a =>
		a.benchmark(scalarFloat, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
	s.test('contiguous Vector<Float32> accumulation', a =>
		a.benchmark(simdFloat, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
});
