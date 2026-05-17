import { readFileSync } from 'fs';

import { parseParameters, program } from '@cxl/program';
import { Program } from '../compiler/program.js';

declare namespace WebAssembly {
	class Module {
		constructor(bytes: BufferSource);
	}
	class Instance {
		constructor(module: Module, importObject?: object);
		readonly exports: Record<string, unknown>;
	}
	class Memory {
		readonly buffer: ArrayBuffer;
	}
}
type BufferSource = ArrayBuffer | ArrayBufferView;

export interface RunOptions {
	imports?: Record<string, (...args: unknown[]) => unknown>;
	stdout?: (chunk: string) => void;
}

function defaultStdout(chunk: string) {
	process.stdout.write(chunk);
}

function makeMemoryDecoder(getMemory: () => WebAssembly.Memory) {
	return (ptr: number) => {
		const memory = getMemory();
		const view = new DataView(memory.buffer);
		const buf = new Uint8Array(memory.buffer);
		const len = view.getUint32(ptr, true);
		return new TextDecoder().decode(buf.subarray(ptr + 4, ptr + 4 + len));
	};
}

export function makeDefaultRuntime(
	getMemory: () => WebAssembly.Memory,
	stdout: (chunk: string) => void,
) {
	const decode = makeMemoryDecoder(getMemory);
	return {
		out_str(strPtr: number) {
			stdout(decode(strPtr) + '\n');
		},
		out_i32(n: number) {
			stdout(`${n | 0}\n`);
		},
		out_i64(n: bigint) {
			stdout(`${n}\n`);
		},
		out_f32(n: number) {
			stdout(`${n}\n`);
		},
		out_f64(n: number) {
			stdout(`${n}\n`);
		},
		out_bool(n: number) {
			stdout(`${!!n}\n`);
		},
	};
}

export function run(src: string, opts: RunOptions = {}) {
	const stdout = opts.stdout ?? defaultStdout;
	const p = Program();
	const result = p.compileToWasm(src);
	if (result.errors.length) {
		for (const e of result.errors) process.stderr.write(`${e.message}\n`);
		throw new Error('Compilation failed');
	}
	const mod = new WebAssembly.Module(result.bytes);
	let memory: WebAssembly.Memory | undefined;
	const getMemory = () => {
		if (!memory) throw new Error('memory not bound');
		return memory;
	};
	const env = {
		...makeDefaultRuntime(getMemory, stdout),
		...(opts.imports ?? {}),
	};
	const instance = new WebAssembly.Instance(mod, { env });
	memory = instance.exports.memory as WebAssembly.Memory;
	const main = instance.exports.main as (() => void) | undefined;
	if (typeof main === 'function') main();
	return instance;
}

const start = program('gbx', () => {
	const options = parseParameters({}, process.argv.slice(2).join(' '));
	if (!options.$ || options.$.length === 0) {
		process.stderr.write('usage: gbx <file.gb> [file.gb ...]\n');
		process.exit(1);
	}
	for (const srcFile of options.$) {
		const src = readFileSync(srcFile, 'utf8');
		run(src);
	}
});

export default start;

if (import.meta.main) start();
