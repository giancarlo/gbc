import {
	createCompiler,
	loadCompiler as loadCompilerWith,
} from './program.js';
import type { Compiler } from './program.js';

declare const fetch: (url: URL) => Promise<{
	ok: boolean;
	status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}>;
declare class URL {
	constructor(path: string, base: string);
}
declare global {
	interface ImportMeta {
		url: string;
	}
}

async function loadBrowserStdlib(): Promise<Uint8Array> {
	const response = await fetch(new URL('./stdlib.gbm', import.meta.url));
	if (!response.ok)
		throw new Error(`unable to load stdlib.gbm: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

/** Load a compiler with the packaged browser stdlib or a host-provided loader. */
export function loadCompiler(
	loadStdlib: () => Promise<Uint8Array> = loadBrowserStdlib,
): Promise<Compiler> {
	return loadCompilerWith(loadStdlib);
}

export { createCompiler };
export type { Compiler } from './program.js';
export const { Program } = await loadCompiler();
export { scan } from './scanner.js';
export { instantiateWasm, runWasm, uint8BufferView } from './host.js';
export type {
	WasmExportFunction,
	WasmExports,
	WasmInstance,
	WasmMemory,
	WasmValue,
} from './host.js';
