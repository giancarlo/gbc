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

const COMPOSE2D_SOURCE = `parent = @matrix.identity(4);
outputMatrix = @matrix.identity(4);
export run = (): Float32 {
	loop >> (index: Int32) {
		index >= 100
			? break
			: @matrix.compose2d(
				outputMatrix,
				parent,
				Float32(10),
				Float32(20),
				Float32(2),
				Float32(3),
				Float32(1),
				Float32(0),
				Float32(0),
				Float32(0)
			)
	};
	next @matrix.get(outputMatrix, 0, 3)
}`;

const FORMAT_SOURCE = `export choose = (
	a: Bool,
	b: Bool,
	c: Bool
): Int32 {
	a?1:b?2:c?3:4
}`;

const THREAD_SOURCE = `increment = (value: Int32): Int32 { value + 1 };
main { 0${' -> increment()'.repeat(100)} >> out }`;

const DEFERRED_LOCAL_SOURCE = `type Buffers = [ source: Buffer<Float32>, target: Buffer<Float32> ];
copy = (buffers: var Buffers, index: Int32): Void {
	offset = index * 2;
	value = get(buffers.source, offset);
	loop >> { $ >= 1 ? break : set(buffers.target, $, value) }
};
main {
	buffers = [ source = Buffer<Float32>(2), target = Buffer<Float32>(1) ];
	copy(buffers, 0)
}`;

const MODULE_ENTRY = '/main.gb';
const MODULE_FILES: Record<string, string> = {
	'/constants.gb': `privateValue = 42;
export read = (): Int32 { privateValue };`,
	[MODULE_ENTRY]: `#importmap { @fixture = './constants.gb'; }
constantModule = @fixture;
main { constantModule.read() >> out }`,
};

function sourceSystem(files: Record<string, string>) {
	return {
		readFile: (path: string) => {
			const source = files[path];
			if (source === undefined)
				throw new Error(`unexpected benchmark source read: ${path}`);
			return source;
		},
		readBytes: (path: string) => {
			throw new Error(`unexpected benchmark byte read: ${path}`);
		},
	};
}

function compileRun(source: string): () => number {
	const entry = '/benchmark.gb';
	const program = Program({ sys: sourceSystem({ [entry]: source }) });
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
	const compose2d = compileRun(COMPOSE2D_SOURCE);
	const formatProgram = Program();
	const format = () => {
		const result = formatProgram.format(FORMAT_SOURCE);
		if (result.errors.length)
			throw new Error(result.errors.map(error => error.message).join('; '));
		return result.source.length;
	};
	const compileSource = (source: string) => {
		const result = Program().compile(source);
		if (result.errors.length || !result.bytes)
			throw new Error(result.errors.map(error => error.message).join('; '));
		return result.bytes.length;
	};
	const compileThreads = () => compileSource(THREAD_SOURCE);
	const compileDeferredLocal = () => compileSource(DEFERRED_LOCAL_SOURCE);
	const moduleProgram = Program({ sys: sourceSystem(MODULE_FILES) });
	const compilePrivateModule = () => {
		const result = moduleProgram.compileFile(MODULE_ENTRY, {
			requireMain: true,
		});
		if (result.errors.length || !result.bytes)
			throw new Error(result.errors.map(error => error.message).join('; '));
		return result.bytes.length;
	};
	const expected = 49_995_000;

	s.test('benchmark checksums', a => {
		a.equal(loop(), expected);
		a.equal(calls(), expected);
		a.equal(scalarFloat(), 0);
		a.equal(simdFloat(), 0);
		a.equal(compose2d(), 10);
		a.equal(format(), 89);
		a.ok(compileThreads() > 0);
		a.ok(compileDeferredLocal() > 0);
		a.ok(compilePrivateModule() > 0);
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
	s.test('Float32 compose2d', a =>
		a.benchmark(compose2d, { warmup: 250, sampleTime: 50, samples: 30 }),
	);
	s.test('conditional source formatting', a =>
		a.benchmark(format, { warmup: 10, sampleTime: 100, samples: 20 }),
	);
	s.test('thread-chain compilation', a =>
		a.benchmark(compileThreads, { warmup: 10, sampleTime: 100, samples: 20 }),
	);
	s.test('deferred local inference compilation', a =>
		a.benchmark(compileDeferredLocal, {
			warmup: 10,
			sampleTime: 100,
			samples: 20,
		}),
	);
	s.test('private module constant compilation', a =>
		a.benchmark(compilePrivateModule, {
			warmup: 10,
			sampleTime: 100,
			samples: 20,
		}),
	);
});
