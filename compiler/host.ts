declare class TextDecoder {
	constructor(label?: string);
	decode(input: Uint8Array): string;
}
declare const performance: {
	now(): number;
};
interface WasmModule {
	readonly bytes?: never;
}
export interface WasmMemory {
	readonly buffer: ArrayBufferLike;
}
export type WasmValue = number | bigint;
export type WasmExportFunction<
	Args extends WasmValue[] = WasmValue[],
	Result extends WasmValue | void = WasmValue | void,
> = (...args: Args) => Result;
export type WasmExports = Record<
	string,
	WasmMemory | WasmExportFunction
>;
export interface WasmInstance<Exports extends WasmExports = WasmExports> {
	readonly exports: Exports & {
		memory: WasmMemory;
		main?: () => void;
	};
}

export interface TypedBufferViewConstructor<View extends ArrayBufferView> {
	readonly BYTES_PER_ELEMENT: number;
	new (
		buffer: ArrayBufferLike,
		byteOffset: number,
		length: number,
	): View;
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

export function bufferView<View extends ArrayBufferView>(
	instance: WasmInstance,
	pointer: number,
	View: TypedBufferViewConstructor<View>,
): View {
	const buffer = instance.exports.memory.buffer;
	if (
		!Number.isInteger(pointer) ||
		pointer < 0 ||
		pointer + 8 > buffer.byteLength
	)
		throw new RangeError('Invalid GB buffer pointer');
	const length = new DataView(buffer, pointer, 4).getUint32(0, true);
	const byteOffset = pointer + 8;
	const elementSize = View.BYTES_PER_ELEMENT;
	if (byteOffset % elementSize !== 0)
		throw new RangeError('Invalid GB buffer alignment');
	if (byteOffset + length * elementSize > buffer.byteLength)
		throw new RangeError('Invalid GB buffer length');
	return new View(buffer, byteOffset, length);
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
			monotonicMilliseconds() {
				return performance.now();
			},
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
