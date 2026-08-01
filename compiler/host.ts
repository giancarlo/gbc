declare class TextDecoder {
	constructor(label?: string);
	decode(input: Uint8Array): string;
}
interface WasmModule {
	readonly bytes?: never;
}
interface WasmMemory {
	readonly buffer: ArrayBuffer;
}
export interface WasmInstance {
	readonly exports: {
		[name: string]: unknown;
		memory: WasmMemory;
		main?: () => void;
	};
}
declare const WebAssembly: {
	Module: new (bytes: Uint8Array) => WasmModule;
	Instance: new (
		module: WasmModule,
		imports: Record<string, Record<string, unknown>>,
	) => WasmInstance;
};

/**
 * The host runtime for compiled gb modules: the `env` imports the compiler
 * emits (`out_buffer`, `ftoa`), memory binding, and `main`
 * invocation. Each `out` emission arrives as one `write` call.
 */
export interface RunResult {
	/** Memory size in 64KB pages after `main` returned. */
	pages: number;
	/** Code passed to `runtime.exit`; 0 when `main` ran to completion. */
	exitCode: number;
}

/** `runtime.exit(code)` unwinds wasm by throwing through the host. */
class ExitSignal {
	constructor(readonly code: number) {}
}

export function instantiateWasm(
	bytes: Uint8Array,
	write: (chunk: string) => void = () => {},
): WasmInstance {
	const bound: { memory?: WasmMemory } = {};
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
		env: {
			out_buffer(ptr: number, len: number) {
				if (!bound.memory) throw new Error('memory not bound');
				const buf = new Uint8Array(bound.memory.buffer);
				write(new TextDecoder().decode(buf.subarray(ptr, ptr + len)));
			},
			exitHost(code: number) {
				throw new ExitSignal(code | 0);
			},
			ftoa(f: number, ptr: number, max: number): number {
				if (!bound.memory) throw new Error('memory not bound');
				const s = String(f);
				const n = Math.min(s.length, max);
				const buf = new Uint8Array(bound.memory.buffer);
				for (let i = 0; i < n; i++) buf[ptr + i] = s.charCodeAt(i) & 0xff;
				return n;
			},
		},
	});
	const memory = instance.exports.memory;
	bound.memory = memory;
	return instance;
}

export function runWasm(
	bytes: Uint8Array,
	write: (chunk: string) => void,
): RunResult {
	const instance = instantiateWasm(bytes, write);
	const memory = instance.exports.memory;
	if (!instance.exports.main)
		throw new Error(
			'module has no `main` export — built as a library? (its exports are host-callable instead)',
		);
	let exitCode = 0;
	try {
		instance.exports.main();
	} catch (e) {
		if (e instanceof ExitSignal) exitCode = e.code;
		else throw e;
	}
	return { pages: memory.buffer.byteLength / 65536, exitCode };
}
