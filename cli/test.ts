import { spec, type TestApi } from '@cxl/spec';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import cli from './index.js';
import { nativeToolchain } from './native.js';
import { Program } from '../compiler/program.js';
import { runWasm } from '../compiler/host.js';

const execute = promisify(execFile);
const executable = new URL('./package/index.js', import.meta.url).pathname;

export default spec('gbc', s => {
	s.test('should load', a => {
		a.ok(cli);
	});

	s.test('selects matching native host toolchains and rejects mismatched targets', a => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-toolchain-test-'));
		const previousPath = process.env.PATH;
		try {
			process.env.PATH = directory;
			for (const platform of ['linux', 'darwin'] as const)
				for (const arch of ['arm64', 'x64']) {
					const cpu = arch === 'x64' ? 'x86_64' : platform === 'darwin' ? 'arm64' : 'aarch64';
					const target = `${cpu}-${platform === 'linux' ? 'unknown-linux-gnu' : 'apple-macosx13.0.0'}`;
					const command = platform === 'linux' ? 'cc' : 'xcrun';
					const args = platform === 'linux' ? ['-dumpmachine'] : ['--sdk', 'macosx', 'clang', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-print-target-triple'];
					const tool = join(directory, command);
					for (const output of [target, '', 'x86_64-pc-windows-msvc', 'armv7-unknown-linux-gnueabihf', `${arch === 'x64' ? 'aarch64' : 'x86_64'}-${platform === 'linux' ? 'unknown-linux-gnu' : 'apple-darwin'}`, `${cpu}-${platform === 'linux' ? 'apple-darwin' : 'unknown-linux-gnu'}`]) {
						writeFileSync(tool, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(args))}) process.exit(9); process.stdout.write(${JSON.stringify(output)});\n`, { mode: 0o755 });
						if (output === target) a.equal(nativeToolchain(platform, arch).target, target);
						else a.throws(() => nativeToolchain(platform, arch), {
							message: `${command}: target ${JSON.stringify(output)} does not match ${platform} ${arch}`,
						});
					}
				}
			for (const [platform, arch] of [['win32', 'x64'], ['linux', 'arm'], ['darwin', 'ia32']] as const)
				a.throws(() => nativeToolchain(platform, arch), {
					message: 'Native builds support Linux and macOS on ARM64 and x86-64',
				});
		} finally {
			if (previousPath === undefined) delete process.env.PATH;
			else process.env.PATH = previousPath;
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('runs a compiled program through the host', (a: TestApi) => {
		const out = Program().compile(`main { 'hi' >> out; 42 >> out }`);
		a.equal(out.errors.length, 0);
		a.assert(out.bytes);
		const lines: string[] = [];
		runWasm(out.bytes, chunk => lines.push(chunk));
		a.equal(lines[0], 'hi');
		a.equal(lines[1], '42');
	});

	s.test('runs #test blocks in test mode', (a: TestApi) => {
		const out = Program().compileTest(
			`#test { equal(dbl(2), 4); equal(dbl(3), 7) }
export dbl = (n: Int32): Int32 { n * 2 };`,
		);
		a.equal(out.errors.length, 0);
		a.assert(out.bytes);
		const failures: string[] = [];
		runWasm(out.bytes, chunk => failures.push(chunk));
		a.equal(failures.length, 1);
		a.equal(failures[0], '6 != 7');
	});

	s.test('builds native executables with LLVM and preserves Wasm output', async (a: TestApi) => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		try {
			const lanes = [1, 2, 3, 4];
			const round = Math.fround;
			const sum = ([a = 0, b = 0, c = 0, d = 0]: number[]) => round(round(a + b) + round(c + d));
			const fixtures = [
				{ name: 'answer', source: 'main { 42 >> out }', output: '42' },
				{
					name: 'scalar',
					source: `mark = (n: Int32): Bool { n >> out; next n > 0 };
choose = (n: Int32, enabled: Bool): Int32 { enabled && mark(n) ? (n == 2 ? n * 20 : -n) : 7 };
main { x = choose(2, true) + choose(3, false); x >> out; (2147483647 + 1) >> out; (1 <: 33) >> out; (-8 :> -31) >> out }`,
					output: '247-21474836482-4',
				},
				{
					name: 'int64',
					source: `add = (value: Int64): Int64 { value + 2 };
choose = (value: Int64, bound: Int32): Int64 { value < bound ? ~value : value - 1 };
main {
	x: Int64 = -1; add(x) >> out; add(2147483648) >> out;
	choose(-2147483649, -1) >> out;
	(9223372036854775807 + 1) >> out; (-9223372036854775808 :> 65) >> out
}`,
					output: '121474836502147483648-9223372036854775808-4611686018427387904',
				},
				{
					name: 'pipeline',
					source: `mark = (x: Int32): Int32 { x >> out; next x + 1 };
twice = (x: Int32): Int32 { x * 2 };
log = (x: Int32): Void { x >> out };
main { value = 20 >> mark >> twice; log(value); 2 >> mark >> twice >> log; 3 >> twice >> out }`,
					output: '2042266',
				},
				{
					name: 'boolean',
					source: `positive = (n: Int32): Bool { n > 0 };
main { true >> out; -1 >> positive >> out; !positive(0) >> out }`,
					output: 'truefalsetrue',
				},
				{
					name: 'numeric-widths',
					source: `main {
	Uint32(-1) >> out; 18446744073709551615 >> out;
	(Int64(20) + Uint32(-1)) >> out; (Uint32(-1) > 1) >> out;
	Int8(255) >> out; Uint16(-1) >> out; Int32(4294967297) >> out
}`,
					output: '4294967295184467440737095516154294967315true-1655351',
				},
				{
					name: 'floating-point',
					source: `ratio = (a: Float64, b: Float64): Float64 { a / b };
main {
	(Float32(0.1) + Float32(0.2)) >> out; (0.1 + 0.2) >> out;
	Float64(Uint32(-1)) >> out; (-0.0) >> out; ratio(1.0, -0.0) >> out;
	ratio(0.0, 0.0) >> out; (nan != nan) >> out; (nan < 1.0) >> out;
	0.000001 >> out; 0.0000001 >> out; 1000000000000000000000.0 >> out; 1000000000000000100.0 >> out
}`,
					output: '0.300000011920928960.30000000000000004-10-InfinityNaNtruefalse0.0000011e-71e+211000000000000000100',
				},
				{
					name: 'numeric-intrinsics',
					source: `ratio = (a: Float64, b: Float64): Float64 { a / b };
main {
	sqrt(Float32(9.0)) >> out; abs(-2.5) >> out; floor(2.75) >> out;
	ceil(2.25) >> out; trunc(-2.75) >> out; nearest(2.5) >> out; nearest(3.5) >> out;
	ratio(1.0, min(0.0, -0.0)) >> out; ratio(1.0, max(0.0, -0.0)) >> out;
	ratio(1.0, copysign(0.0, -1.0)) >> out; min(nan, 2.0) >> out;
	max(Uint32(-1), Uint32(1)) >> out; min(-9, 3) >> out;
	bits(Float32(-0.0)) >> out; bits(-0.0) >> out
}`,
					output: '32.523-224-InfinityInfinity-InfinityNaN4294967295-921474836489223372036854775808',
				},
				{
					name: 'checked-numerics',
					source: `divide = (a: Int32, b: Int32): Int32 | DivByZero | NumericOverflow { a / b };
wide = (a: Int64, b: Int64): Int64 | DivByZero | NumericOverflow { a / b };
rem = (a: Int32, b: Int32): Int32 | DivByZero { a % b };
convert = (n: Float64): Int8 | NumericOverflow | OutOfMemory { Int8(n) };
main {
	divide(6, 2) >> Int32 { $ } | DivByZero { 10 } | NumericOverflow { 20 } >> out;
	divide(6, 0) >> Int32 { $ } | DivByZero { 10 } | NumericOverflow { 20 } >> out;
	divide(-2147483648, -1) >> Int32 { $ } | DivByZero { 10 } | NumericOverflow { 20 } >> out;
	wide(-9223372036854775808, -1) >> Int64 { $ } | Error { Int64(21) } >> out;
	rem(-2147483648, -1) >> Int32 { $ } | DivByZero { 99 } >> out;
	convert(127.9) >> Int8 { Int32($) } | NumericOverflow { 90 } | OutOfMemory { 93 } >> out;
	convert(nan) >> Int8 { Int32($) } | Error { 91 } >> out;
	convert(128.0) >> Int8 { Int32($) } | Error { 92 } >> out
}`,
					output: '310202101279192',
				},
				{
					name: 'call-binding',
					source: `mark = (n: Int32): Int32 { n >> out; next n };
sub = (a: Int32, b: Int32 = a + 1): Int32 { a - b };
main {
	sub(b = mark(2), a = mark(1)) >> out;
	sub(mark(3), void) >> out;
	[mark(4), mark(5)] >> sub >> out;
	max(y = mark(6), x = mark(7)) >> out
}`,
					output: '21-13-145-1677',
				},
				{
					name: 'specialized-recursion',
					source: `twice = <T>(n: T): T { n + n };
repeat = <T>(n: Int32, value: T): T { n == 0 ? value : repeat(n - 1, twice(value)) };
apply = <T>(f: (T): T, n: T): T { f(n) };
sum = (n: Int32): Int32 { n == 0 ? 0 : n + sum(n - 1) };
tail = (n: Int32, total: Int32): Int32 { n == 0 ? total : tail(n - 1, total + 1) };
main {
	repeat(2, 3) >> out; repeat(2, 0.375) >> out; sum(5) >> out;
	apply((x: Int32): Int32 { x * 2 }, 4) >> out;
	apply((x: Int32): Int32 { x + 2 }, 4) >> out;
	6 >> twice >> out; tail(100000, 0) >> out
}`,
					output: '121.5158612100000',
				},
				{
					name: 'streams-and-threads',
					source: `mark = (n: Int32): Int32 { n >> out; next n };
touch = (n: Int32, extra: Int32): Void { (n + extra) >> out };
maybe = (flag: Bool): Int32 | Void { flag ? 23 : 22 };
echo = { $ };
pair = (n: Int32): { Int32, Int32 } { next n; next n + 1 };
count = (n: Int32): { ...Int32 } { n <= 0 ? done; (n + 4) >> out; next n; next count(n - 1); next n + 10; done };
main {
	mark(3) -> touch(mark(4)) >> out; false -> maybe() >> out;
	pair(8) >> mark >> out; (1, 2) >> { $, $ + 10 } >> out;
	loop >> { $ >= 3 ? break : $ } >> out; count(3) >> out; 2 >> echo >> out
}`,
					output: '34732288991112120127365132',
				},
				{
					name: 'overloaded-dispatch',
					source: `choose = (n: Int32): Int32 { n * 2 } | (b: Bool): Int32 { b ? 7 : 8 };
pair = (n: Int32): { Int32, Bool } { next n; next true };
branch = (b: Bool): Int32 | Bool { b ? 5 : false };
main {
	choose(3) >> out; false -> choose() >> out; pair(3) >> choose >> out;
	branch(true) >> Int32 { $ + 1 } | Bool { $ ? 7 : 8 } >> out;
	branch(false) >> Int32 { $ + 1 } | Bool { $ ? 7 : 8 } >> out;
	3 >> :3 { 6 } | Int32 { $ } >> out
}`,
					output: '68676863',
				},
				{
					name: 'heap-values',
					source: `type Item = [text: String, values: Buffer<Int32>];
make = (n: Int32): own String { 'value\${n}' };
identity = <T>(value: T): T { value };
field = (item: Item): String { item.text };
consume = (value: own String): Int32 { length(value) };
main {
	item = [text = make(12), values = Buffer<Int32>(2)];
	get(item.values, 0) >> out;
	set(item.values, 0, 7);
	get(item.values, 0) >> out;
	item >> field >> out;
	make(3) -> identity() -> length() >> out;
	consume(make(4)) >> out;
	('a\\00b' == 'a\\00b') >> out;
	'é\\00z' >> out
}`,
					output: '07value1266trueé\0z',
				},
				{
					name: 'heap-lifetimes',
					source: `type Item = [n: Int32];
extend String (item: Item): own String { 'item:\${item.n}' };
make = (n: Int32): own String { 'value\${n}' };
pick = (a: String, b: String, k: Int32): String { k > 0 ? a : b };
step = (n: Int32): Int32 { length(pick(make(n), make(n + 1), 0)) };
choose = (n: Int32, v: Int32): own String | Int32 | DivByZero | NumericOverflow {
	text = make(n); next v < 0 ? text : 40 / v
};
read = (n: Int32, text: String): own String { '\${n}:\${text}' };
mark = (n: Int32): Int32 { n >> out; next n };
main {
	Array<String>(1) -> push('left') -> reserveCapacity(8) -> push('right') >> (buffer: Array<String>) {
		get(buffer, 0) >> out; get(buffer, 1) >> out; length(buffer) >> out; capacity(buffer) >> out
	};
	choose(1, -1) >> String { $ } | Int32 { String($) } | Error { 'error' } >> out;
	choose(2, 0) >> String { $ } | Int32 { String($) } | Error { 'error' } >> out;
	choose(3, 2) >> String { $ } | Int32 { String($) } | Error { 'error' } >> out;
	record: var = [n = 4, text = 'record']; record >> read >> out;
	record >> (n: Int32, text: String) { '\${n}:\${text}' } >> out;
	'\${Item([n = 43])} \${0.125} \${Char(128578)}' >> out;
	length([mark(1), mark(2)]) >> out; length(void) >> out; [mark(3), mark(4)].1 >> out;
	loop >> (i: Int32) { i >= 20000 ? break; step(i) > 100 ? break }; 'done' >> out
}`,
					output: 'leftright28value1error204:record4:recorditem:43 0.125 🙂2044done',
				},
				{
					name: 'vectors',
					source: `identity = <T>(x: T): T { x };
rem = <T>(a: T, b: T): T { a % b };
choose = (n: Int32): Vector<Float32> | own String { n > 0 ? Vector<Float32>(n) : '\${n}text' };
main {
	buffer = Buffer<Float32>(9);
	set(buffer, 1, Float32(1)); set(buffer, 2, Float32(2));
	set(buffer, 3, Float32(3)); set(buffer, 4, Float32(4));
	v = identity(Vector<Float32>(buffer, 1));
	one = Vector<Float32>(1); half = Vector<Float32>(0.5);
	simd.store(buffer, 5, v);
	get(buffer, 5) >> out; get(buffer, 6) >> out; get(buffer, 7) >> out; get(buffer, 8) >> out;
	simd.sum(v + one) >> out; simd.sum(v - one) >> out; simd.sum(v * half) >> out;
	simd.sum(v / half) >> out; simd.sum(rem(v, half)) >> out;
	simd.sum(Vector<Float32>(Uint32(4294967295))) >> out;
	simd.sum(Vector<Float32>(Int64(2147483648)) / Vector<Float32>(Int64(1073741824))) >> out;
	simd.sum(Vector<Float32>(Uint64(9223372036854775808)) / Vector<Float32>(Int64(4611686018427387904))) >> out;
	vectors = Buffer<Vector<Float32> >(2);
	set(vectors, 1, v); simd.sum(get(vectors, 1)) >> out;
	set(buffer, 1, Float32(100000000000000000000.0)); set(buffer, 2, Float32(1));
	set(buffer, 3, Float32(0.0 - 100000000000000000000.0)); set(buffer, 4, Float32(1));
	simd.sum(Vector<Float32>(buffer, 1)) >> out;
	choose(2) >> Vector<Float32> { simd.sum($) >> out } | String { $ >> out };
	choose(0) >> Vector<Float32> { simd.sum($) >> out } | String { $ >> out }
}`,
					output: [...lanes, sum(lanes.map(x => x + 1)), sum(lanes.map(x => x - 1)),
						sum(lanes.map(x => x * 0.5)), sum(lanes.map(x => x / 0.5)), sum(lanes.map(x => x / 0.5)),
						-4, 8, 8, sum(lanes), sum([round(1e20), 1, round(-1e20), 1]), '8', '0text'].join(''),
				},
				{ name: 'empty', source: 'main {}', output: '' },
				{ name: 'limits', source: 'main { -2147483648 >> out; 0 >> out; 2147483647 >> out }', output: '-214748364802147483647' },
			];
			await Promise.all(fixtures.map(async fixture => {
				const path = join(directory, `${fixture.name}.gb`);
				writeFileSync(path, fixture.source);
				await execute(process.execPath, [executable, 'build', '--native', '--outdir', directory, path]);
				const native = await execute(join(directory, fixture.name));
				a.equal(native.stdout, fixture.output);
				const wasm = Program().compile(fixture.source);
				a.assert(wasm.bytes);
				let expected = '';
				runWasm(wasm.bytes, chunk => { expected += chunk; });
				a.equal(native.stdout, expected);
			}));
			const heapPath = join(directory, 'heap-values.gb');
			const nativeArgs = [executable, 'build', '--native', '--outdir', directory, heapPath];
			await Promise.all([execute(process.execPath, nativeArgs), execute(process.execPath, nativeArgs)]);
			a.equal((await execute(join(directory, 'heap-values'))).stdout, '07value1266trueé\0z');
			const vectorPath = join(directory, 'vectors.gb');
			const vectorArgs = [executable, 'build', '--native', '--outdir', directory, vectorPath];
			const vectorSource = readFileSync(vectorPath, 'utf8');
			const vectorOutput = join(directory, 'vectors');
			const previous = readFileSync(vectorOutput);
			writeFileSync(vectorPath, 'main { Vector<Int32>(1) }');
			const rejected = spawnSync(process.execPath, vectorArgs, { encoding: 'utf8' });
			a.equal(rejected.status, 1);
			a.ok(rejected.stderr.includes('does not satisfy Vector element constraint'));
			a.ok(readFileSync(vectorOutput).equals(previous));
			writeFileSync(vectorPath, vectorSource);
			await Promise.all([execute(process.execPath, vectorArgs), execute(process.execPath, vectorArgs)]);
			a.ok(readFileSync(vectorOutput).equals(previous));
			const path = join(directory, 'answer.gb');
			const wasm = await execute(process.execPath, [executable, 'build', '--outdir', directory, path]);
			a.equal(wasm.stdout.trim(), join(directory, 'answer.wasm'));
			const run = await execute(process.execPath, [executable, 'run', join(directory, 'answer.wasm')]);
			a.equal(run.stdout, '42');
			a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('native unary and comparison instructions use the operand width', async a => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		try {
			const path = join(directory, 'negate.gb');
			writeFileSync(path, `neg64 = (n: Int64): Int64 { -n };
neg32 = (n: Float32): Float32 { -n };
less = (x: Float32, y: Float64): Bool { x < y };
main {
	neg64(2147483648) >> out; neg64(-9223372036854775808) >> out;
	neg32(Float32(1.5)) >> out; (1.0 / Float64(neg32(Float32(0.0)))) >> out;
	less(Float32(1.5), 2.0) >> out; less(Float32(nan), 2.0) >> out
}`);
			await execute(process.execPath, [executable, 'build', '--native', '--outdir', directory, path]);
			a.equal((await execute(join(directory, 'negate'))).stdout, '-2147483648-9223372036854775808-1.5-Infinitytruefalse');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('native unchecked float truncation traps on rounded overflow', async (a: TestApi) => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const source = 'main { Int32(Float32(2147483647.0)) >> out }';
		try {
			const { bytes } = Program().compile(source);
			a.assert(bytes);
			a.throws(() => runWasm(bytes, () => {}));
			const path = join(directory, 'rounded.gb');
			writeFileSync(path, source);
			await execute(process.execPath, [executable, 'build', '--native', '--outdir', directory, path]);
			const result = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$1"', 'gbc', join(directory, 'rounded')], { encoding: 'utf8' });
			a.ok(result.signal || result.status);
			a.equal(result.stdout, '');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('native buffers trap before evaluating an out-of-bounds value', async (a: TestApi) => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const vector = `mark = (): Vector<Float32> { 3 >> out; next Vector<Float32>(2) };`;
		const cases = [
			{ source: `mark = (n: Int32): Int32 { n >> out; next n };
main { b = Buffer<Int32>(1); 1 >> out; set(b, 2, mark(3)); 4 >> out }`, output: '1' },
			{ source: `${vector} main { b = Buffer<Float32>(4); 1 >> out; simd.store(b, 1, mark()); 4 >> out }`, output: '1' },
			{ source: `${vector} main { b = Buffer<Float32>(4); 1 >> out; simd.store(value = mark(), buffer = b, index = 1); 4 >> out }`, output: '13' },
			{ source: `main { b = Buffer<Float32>(4); 1 >> out; simd.sum(Vector<Float32>(b, -1)) >> out; 4 >> out }`, output: '1' },
			{ source: `main { b = Array<Float32>(4); 1 >> out; simd.sum(Vector<Float32>(b, 0)) >> out; 4 >> out }`, output: '1' },
		];
		try {
			const path = join(directory, 'bounds.gb');
			for (const { source, output } of cases) {
				const { bytes } = Program().compile(source);
				a.assert(bytes);
				let expected = '';
				a.throws(() => runWasm(bytes, chunk => { expected += chunk; }));
				a.equal(expected, output);
				writeFileSync(path, source);
				await execute(process.execPath, [executable, 'build', '--native', '--outdir', directory, path]);
				const result = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$1"', 'gbc', join(directory, 'bounds')], { encoding: 'utf8' });
				a.ok(result.signal || result.status);
				a.equal(result.stdout, expected);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('rejects unsupported native builds without replacing an executable', a => {
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const path = join(directory, 'input.gb');
		const output = join(directory, 'input');
		try {
			writeFileSync(output, 'previous executable');
			for (const source of ['main {', 'main { missing >> out }', 'value = 42']) {
				writeFileSync(path, source);
				const result = spawnSync(process.execPath, [executable, 'build', '--native', '--outdir', directory, path], { encoding: 'utf8' });
				a.equal(result.status, 1);
				a.ok(result.stderr.length > 0);
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
			}
			writeFileSync(path, 'main { 42 >> out }');
			for (const args of [['run', '--native', path], ['build', '--native', '--wasm', path], ['build', '--native', '--debug', path], ['build', '--native']]) {
				const result = spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8' });
				a.equal(result.status, 1);
				a.ok(result.stderr.length > 0);
			}
			const extensionless = join(directory, 'source');
			const source = 'main { 42 >> out }';
			writeFileSync(extensionless, source);
			const collision = spawnSync(process.execPath, [executable, 'build', '--native', '--outdir', directory, extensionless], { encoding: 'utf8' });
			a.equal(collision.status, 1);
			a.ok(collision.stderr.includes('overwrite source'));
			a.equal(readFileSync(extensionless, 'utf8'), source);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('cleans up failed native toolchains and permits retry', a => {
		const { command, target } = nativeToolchain(process.platform, process.arch);
		const directory = mkdtempSync(join(process.cwd(), '.gbc-native-test-'));
		const tools = join(directory, 'tools');
		const path = join(directory, 'input.gb');
		const output = join(directory, 'input');
		const args = [executable, 'build', '--native', '--outdir', directory, path];
		try {
			mkdirSync(tools);
			writeFileSync(path, "main { 'heap${42}' >> out }");
			writeFileSync(output, 'previous executable');
			const missing = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: tools } });
			a.equal(missing.status, 1);
			a.ok(missing.stderr.includes(`${command}:`));
			a.equal(readFileSync(output, 'utf8'), 'previous executable');
			const driver = join(tools, command);
			for (const reportedTarget of ['', target]) {
				writeFileSync(driver, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(reportedTarget)});\n`, { mode: 0o755 });
				const rejected = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: tools } });
				a.equal(rejected.status, 1);
				a.ok(rejected.stderr.includes(reportedTarget ? 'opt:' : 'target'));
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
				a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
			}
			rmSync(driver);
			for (const tool of ['opt', 'llc', command]) {
				const fixture = join(tools, tool);
				writeFileSync(fixture, `#!${process.execPath}\nif (process.argv.includes('-dumpmachine') || process.argv.includes('-print-target-triple')) { process.stdout.write(${JSON.stringify(target)}); } else { process.stderr.write('forced tool failure'); process.exit(23); }\n`, { mode: 0o755 });
				const failed = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } });
				a.equal(failed.status, 1);
				a.ok(failed.stderr.includes(`${tool}: forced tool failure`));
				a.equal(readFileSync(output, 'utf8'), 'previous executable');
				a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
				rmSync(fixture);
			}
			const retry = spawnSync(process.execPath, args, { encoding: 'utf8' });
			a.equal(retry.status, 0);
			a.equal(spawnSync(output, [], { encoding: 'utf8' }).stdout, 'heap42');
			a.ok(!readdirSync(directory).some(name => name.startsWith('.gbc-native-')));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	s.test('formats a file through the CLI', a => {
		const directory = mkdtempSync(join(tmpdir(), 'gbc-fmt-'));
		const path = join(directory, 'input.gb');
		const source = 'value = true?1:false?2:3;\n';
		const expected = 'value = true ? 1\n: false ? 2\n: 3;\n';
		const executable = new URL('./package/index.js', import.meta.url);
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
