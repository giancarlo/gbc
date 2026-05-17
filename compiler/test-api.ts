import { TestApiBase, TestFn, Test } from '@cxl/spec';
import { CompilerError, Token, each, formatError } from '../sdk/index.js';

import { scan } from './scanner.js';
import { Program } from './program.js';
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
	/** Expected `@.out` captures when running the compiled WASM module. */
	out?: OutValue[];
	test?: (ast: NodeMap['root']) => void;
};

export type OutValue = string | number | boolean | OutValue[];

/** Result of running a compiled WASM module's `main` export. */
export interface WasmRunResult {
	out: OutValue[];
}

/**
 * Strip a trailing `>> @.out` from a wrapped main statement so the AST
 * assertion in `expr()` sees the original src's pipe shape.
 */
function unwrapOutPipe(stmt: NodeMap[keyof NodeMap]): NodeMap[keyof NodeMap] {
	if (stmt.kind !== '>>') return stmt;
	const last = stmt.children[stmt.children.length - 1];
	const isOutStage =
		last?.kind === '.' &&
		last.children[0]?.kind === '@' &&
		last.children[1]?.kind === 'ident' &&
		last.children[1].symbol.name === 'out';
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
		src,
		expected,
	}: {
		p?: string;
		src: string;
		expected: string;
	}) => {
		const program = Program();
		const result = program.compile(src);
		this.assert(
			result.errors.length > 0,
			`Expected compile errors for: ${src}`,
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

	rule = ({ src, ast, out, test }: RuleDef) => {
		const { ast: rootAst } = this.parse(src);
		this.equal(printAst(rootAst), ast);
		if (out !== undefined) {
			const result = this.runWasm(rootAst);
			this.equalValues(result.out, out);
		}
		test?.(rootAst);
	};

	/**
	 * Runtime-verified expression test. Wraps `src` as
	 * `${pre ?? ''} main { ${src} >> @.out }` so the spec stays focused on
	 * the value being demonstrated.
	 *
	 * `pre` is optional top-level setup (typically fn defs that the
	 * expression calls).
	 * `ast` is the AST of the inner expression only (the lhs of `>>`).
	 * `out` is the expected sequence of `@.out` captures.
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
		const wrapped = `${pre ?? ''} main { ${src} >> @.out }`;
		const { ast: rootAst } = this.parse(wrapped);
		const mainNode = rootAst.children.find(
			(c): c is NodeMap['main'] => c?.kind === 'main',
		);
		this.assert(mainNode !== undefined);
		// For each main statement: if it's a `>> @.out` pipe, take all but
		// the trailing @.out stage. Multi-stage pipes reconstruct as a new
		// pipe node for printing; single-stage drop the wrapping.
		const inners = mainNode.statements.map(s => unwrapOutPipe(s!));
		this.equal(inners.map(n => printAst(n)).join(' '), ast);
		const result = this.runWasm(rootAst);
		if (out !== undefined) this.equalValues(result.out, out);
		test?.(result);
	};

	protected runWasm(root: NodeMap['root']): WasmRunResult {
		const bytes = Program().compileAst(root);
		const captures: OutValue[] = [];
		const module = new WebAssembly.Module(bytes);
		let memory: WebAssembly.Memory | undefined;
		const decodeString = (strPtr: number) => {
			if (!memory) throw new Error('memory not bound');
			const view = new DataView(memory.buffer);
			const buf = new Uint8Array(memory.buffer);
			const len = view.getUint32(strPtr, true);
			return new TextDecoder().decode(
				buf.subarray(strPtr + 4, strPtr + 4 + len),
			);
		};
		const decodeData = (ptr: number): OutValue[] => {
			if (!memory) throw new Error('memory not bound');
			const view = new DataView(memory.buffer);
			const length = view.getUint32(ptr, true);
			const itemSize = view.getUint32(ptr + 4, true);
			const items: OutValue[] = [];
			const base = ptr + 8;
			for (let i = 0; i < length; i++) {
				const off = base + i * itemSize;
				if (itemSize === 8) items.push(view.getFloat64(off, true));
				else items.push(view.getInt32(off, true));
			}
			return items;
		};
		const instance = new WebAssembly.Instance(module, {
			env: {
				out_str(strPtr: number) {
					captures.push(decodeString(strPtr));
				},
				out_i32(n: number) {
					captures.push(n | 0);
				},
				out_i64(n: bigint) {
					captures.push(Number(n));
				},
				out_f32(n: number) {
					captures.push(n);
				},
				out_f64(n: number) {
					captures.push(n);
				},
				out_bool(n: number) {
					captures.push(!!n);
				},
				out_data(ptr: number) {
					captures.push(decodeData(ptr));
				},
			},
		});
		memory = instance.exports.memory as WebAssembly.Memory;
		(instance.exports.main as () => void)();
		return { out: captures };
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
