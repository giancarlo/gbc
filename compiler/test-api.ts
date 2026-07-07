import { TestApiBase, TestFn, Test } from '@cxl/spec';
import { CompilerError, Token, each, formatError } from '../sdk/index.js';

import { scan } from './scanner.js';
import { Program } from './program.js';
import { runWasm as runHostWasm } from './host.js';
import { ast as printAst } from './debug.js';

import type { NodeMap } from './node.js';

declare class TextDecoder {
	constructor(label?: string);
	decode(input: Uint8Array): string;
}

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

export function spec(name: string, fn: TestFn<SpecApi>) {
	const test = new Test(name, fn, SpecApi);
	test.level = 1;
	return test;
}

export type RuleDef = {
	p?: string;
	src: string;
	ast: string;
	/** Expected `out` captures when running the compiled WASM module. */
	out?: OutValue[];
	/** Fail when the run ends with more than this many 64KB memory pages. */
	maxPages?: number;
	/** Compile as a debug build (shadow-stack error chains). */
	debug?: boolean;
	/** Expected `runtime.exit` code (0 = ran to completion). */
	exit?: number;
	test?: (ast: NodeMap['root']) => void;
};

export type OutValue = string | number | boolean | OutValue[];

/** Result of running a compiled WASM module's `main` export. */
export interface WasmRunResult {
	out: OutValue[];
	/** Memory size in 64KB pages after `main` returned. */
	pages: number;
	exitCode: number;
}

/**
 * Strip a trailing `>> out` from a wrapped main statement so the AST
 * assertion in `expr()` sees the original src's pipe shape.
 */
function unwrapOutPipe(stmt: NodeMap[keyof NodeMap]): NodeMap[keyof NodeMap] {
	if (stmt.kind !== '>>') return stmt;
	const last = stmt.children[stmt.children.length - 1];
	const isOutStage = last?.kind === 'ident' && last.symbol.name === 'out';
	if (!isOutStage) return stmt;
	const inner = stmt.children.slice(0, -1);
	if (inner.length === 1) return inner[0]!;
	return { ...stmt, children: inner };
}

export class SpecApi extends TestApiBase<SpecApi> {
	createTest = (name: string, testFn: TestFn<SpecApi>) =>
		new Test(name, testFn, SpecApi, this.$test);

	token = (src: string, _desc: string, kind: string) => {
		this.match(src, { kind });
	};

	match = (src: string, ...expect: (string | Partial<Token<string>>)[]) => {
		const { next } = scan(src);
		let i = 0;
		for (const tk of each(next)) {
			const expected = expect[i++];
			this.assert(expected);
			this.equalPartial(
				tk,
				typeof expected === 'string' ? { kind: expected } : expected,
			);
		}
	};

	/**
	 * Compile `src` and assert the compiler produced at least one error
	 * whose message contains `expected`. Replaces `throws(() => …)` for
	 * tests that need to pin the actual cause of the compile failure.
	 * The `p` field is the human-readable spec description (kept for docs).
	 * On mismatch the captured errors are dumped to the test log.
	 */
	compileError = ({
		pre,
		src,
		expected,
		testMode,
	}: {
		p?: string;
		pre?: string;
		src: string;
		expected: string;
		testMode?: boolean;
	}) => {
		const wrapped = pre ? `${pre}; ${src}` : src;
		const program = Program();
		const result = testMode
			? program.compileTest(wrapped)
			: program.compile(wrapped);
		this.assert(
			result.errors.length > 0,
			`Expected compile errors for: ${wrapped}`,
		);
		const matched = result.errors.some(e =>
			e.message.includes(expected),
		);
		if (!matched) {
			this.printErrors(result.errors);
			this.assert(
				false,
				`No error contained "${expected}". Got: ${result.errors
					.map(e => e.message)
					.join('; ')}`,
			);
		}
	};

	rule = ({ src, ast, out, maxPages, debug, exit, test }: RuleDef) => {
		const { ast: rootAst } = this.parse(src);
		this.equal(printAst(rootAst), ast);
		if (out !== undefined || maxPages !== undefined || exit !== undefined) {
			const result = this.runWasm(rootAst, false, debug);
			if (out !== undefined) this.equalValues(result.out, out);
			if (maxPages !== undefined && result.pages > maxPages)
				throw new Error(
					`heap grew to ${result.pages} pages (max ${maxPages})`,
				);
			if (exit !== undefined && result.exitCode !== exit)
				throw new Error(
					`exit code ${result.exitCode} (expected ${exit})`,
				);
		}
		test?.(rootAst);
	};

	/**
	 * Runtime-verified expression test. Wraps `src` as
	 * `${pre ?? ''} main { ${src} >> out }` so the spec stays focused on
	 * the value being demonstrated.
	 *
	 * `pre` is optional top-level setup (typically fn defs that the
	 * expression calls).
	 * `ast` is the AST of the inner expression only (the lhs of `>>`).
	 * `out` is the expected sequence of `out` captures.
	 */
	expr = ({
		pre,
		src,
		ast,
		out,
		test,
	}: {
		p?: string;
		pre?: string;
		src: string;
		ast: string;
		out?: OutValue[];
		test?: (result: WasmRunResult) => void;
	}) => {
		let depth = 0;
		let isMulti = false;
		for (const c of src) {
			if (c === '{' || c === '[' || c === '(') depth++;
			else if (c === '}' || c === ']' || c === ')') depth--;
			else if (c === ';' && depth === 0) {
				isMulti = true;
				break;
			}
		}
		const wrapped = `${pre ? pre + '; ' : ''}main { ${src} >> out${isMulti ? ';' : ''} }`;
		const needsRuntime = out !== undefined || !!test;
		const rootAst = needsRuntime
			? this.parse(wrapped).ast
			: this.parseAstOnly(wrapped);
		const mainNode = rootAst.children.find(
			(c): c is NodeMap['main'] => c?.kind === 'main',
		);
		this.assert(mainNode !== undefined);
		const inners = mainNode.statements.map(s => unwrapOutPipe(s!));
		this.equal(inners.map(n => printAst(n)).join(' '), ast);
		if (!needsRuntime) return;
		const result = this.runWasm(rootAst);
		if (out !== undefined) {
			const expected = JSON.stringify(out);
			const got = JSON.stringify(result.out);
			if (expected !== got)
				throw new Error(`[OUT_DIFF src=${src} expected=${expected} got=${got}]`);
		}
		test?.(result);
	};

	/**
	 * Compile `src` (a program containing `#test { ... }` blocks) in test mode
	 * and run it. The test prelude's `ok`/`equal` are silent on a pass and emit
	 * a failure line otherwise, so `out` is the sequence of failures (empty when
	 * every assertion holds).
	 */
	/**
	 * Multi-file program: `files` is a virtual filesystem (absolute paths),
	 * `entry` the program entry. Compiles module-aware and runs `main`.
	 */
	modules = ({
		files,
		bundles,
		entry,
		out,
		errors,
	}: {
		p?: string;
		files: Record<string, string>;
		/** Pre-sealed libraries: target .gbm path → its own virtual tree. */
		bundles?: Record<string, { files: Record<string, string>; entry: string }>;
		entry: string;
		out?: OutValue[];
		errors?: string;
	}) => {
		const bundleBytes: Record<string, Uint8Array> = {};
		for (const [target, lib] of Object.entries(bundles ?? {})) {
			const libSys = {
				readFile: (path: string) => {
					const f = lib.files[path];
					if (f === undefined) throw new Error(`ENOENT: ${path}`);
					return f;
				},
				readBytes: (path: string) => {
					throw new Error(`ENOENT: ${path}`);
				},
			};
			const built = Program({ sys: libSys }).buildLibrary(lib.entry);
			if (built.errors.length || !built.bundle) {
				this.printErrors(built.errors);
				throw 'Bundle build failed';
			}
			bundleBytes[target] = built.bundle;
		}
		const sys = {
			readFile: (path: string) => {
				const f = files[path];
				if (f === undefined) throw new Error(`ENOENT: ${path}`);
				return f;
			},
			readBytes: (path: string) => {
				const b = bundleBytes[path];
				if (b === undefined) throw new Error(`ENOENT: ${path}`);
				return b;
			},
		};
		let result;
		try {
			result = Program({ sys }).compileFile(entry, {
				requireMain: true,
			});
		} catch (e) {
			if (errors && e instanceof Error && e.message.includes(errors))
				return;
			throw e;
		}
		if (errors) {
			const matched = result.errors.some(e =>
				e.message.includes(errors),
			);
			if (!matched) {
				this.printErrors(result.errors);
				this.assert(
					false,
					`No error contained "${errors}". Got: ${result.errors
						.map(e => e.message)
						.join('; ')}`,
				);
			}
			return;
		}
		if (result.errors.length) {
			this.printErrors(result.errors);
			throw 'Errors found';
		}
		this.assert(result.bytes);
		const run = this.runWasmBytes(result.bytes);
		if (out) this.equalValues(run.out, out);
	};

	testBlock = ({ src, out }: { p?: string; src: string; out: OutValue[] }) => {
		const compiled = Program().compileTest(src);
		if (compiled.errors.length) {
			this.printErrors(compiled.errors);
			throw 'Errors found';
		}
		this.assert(compiled.bytes);
		const result = this.runWasmBytes(compiled.bytes);
		this.equalValues(result.out, out);
	};

	protected runWasm(
		root: NodeMap['root'],
		testMode = false,
		debug = false,
	): WasmRunResult {
		const bytes = Program({ debug }).compileAst(root, testMode);
		return this.runWasmBytes(bytes);
	}

	protected runWasmBytes(bytes: Uint8Array): WasmRunResult {
		const captures: OutValue[] = [];
		const { pages, exitCode } = runHostWasm(bytes, chunk =>
			captures.push(chunk),
		);
		return { out: captures, pages, exitCode };
	}

	ast = ({
		src,
		ast,
		test,
	}: {
		p?: string;
		src: string;
		ast: string;
		test?: (ast: NodeMap['root']) => void;
	}) => {
		const rootAst = this.parseAstOnly(src);
		this.equal(rootAst.children?.map(printAst).join(' '), ast);
		test?.(rootAst);
	};

	protected parseAstOnly(src: string): NodeMap['root'] {
		const program = Program();
		const parsed = program.parse(src);
		if (parsed.errors.length) {
			this.printErrors(parsed.errors);
			throw 'Errors found';
		}
		return parsed.root;
	}

	protected parse(src: string) {
		const program = Program();
		const result = program.compile(src);
		if (result.errors.length) {
			this.printErrors(result.errors);
			throw 'Errors found';
		}
		return { ...result, program };
	}

	printErrors(errors: CompilerError[]) {
		errors.forEach(e => this.log(formatError(e)));
	}
}
