import { TestApiBase, TestFn, Test } from '@cxl/spec';
import { CompilerError, Token, each, formatError } from '../sdk/index.js';

import { scan } from './scanner.js';
import { Program } from './program.js';
import { ast as printAst } from './debug.js';

import type { NodeMap } from './node.js';

export function spec(name: string, fn: TestFn<SpecApi>) {
	const test = new Test(name, fn, SpecApi);
	test.level = 1;
	return test;
}

export type RuleDef<T = (p?: unknown) => unknown> = {
	p?: string;
	src: string;
	ast: string;
	test?: (fn: T, ast: NodeMap['root']) => void;
};

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

	rule = <T = (x?: unknown) => unknown,>({ src, ast, test }: RuleDef<T>) => {
		const { ast: rootAst, output } = this.parse(src);
		this.equal(printAst(rootAst), ast);
		const outFn = new Function(output) as T;
		test?.(outFn, rootAst);
	};

	expr = <T = (x?: unknown) => unknown,>({
		src,
		ast,
		test,
	}: {
		p?: string;
		src: string;
		ast: string;
		test?: (fn: T, ast: NodeMap['fn']) => void;
	}) => {
		const { ast: rootAst, output } = this.parse(`test__={${src}}`);
		const main = rootAst.children[0];
		this.assert(main?.kind === 'def');
		const fn = main.children[1];
		this.assert(fn?.kind === 'fn');
		this.equal(fn.children?.map(printAst).join(' '), ast);
		const outFn = new Function(`${output};return test__`)() as T;
		test?.(outFn, fn);
	};

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
