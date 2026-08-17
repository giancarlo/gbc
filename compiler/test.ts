import { spec } from './test-api.js';
import type { SpecApi as TestApi } from './test-api.js';
import { tokenize } from '../sdk/index.js';
import { Program, scan } from './index.js';
import { instantiateWasm, uint8BufferView } from './host.js';

/*

The GB programming language is a concise, type-safe, and functional programming language that
emphasizes immutability, modularity, and streamlined syntax.

## Design Constitution

Language features must avoid breaking these rules:

1. **One Way:** Restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns via syntax and types. Enforcement is binary — code is valid or it is a compile error; never a warning.
3. **Transparency:** No hidden or implicit behavior.
4. **No Bloat:** Only essential features.
5. **Readable:** Prioritize clarity.
6. **Performant:** Adapt the language when code generation requires it.

*/
export default spec('Language Reference', s => {
	const { h } = s;

	s.test('tokenizes editor input through the SDK', a => {
		const source = "export value = 1\n'line\n${value}' \" export";
		const tokens = [...tokenize(scan, source)];
		a.equalValues(
			tokens.map(token => token.kind),
			[
				'export',
				'ident',
				'=',
				'number',
				'strhead',
				'ident',
				'strtail',
				'error',
				'export',
			],
		);
		a.equal(tokens[4]?.line, 1);
		a.equal(tokens[5]?.line, 2);
	});

	s.test('should expose a borrowed Uint8 buffer to the host', (a: TestApi) => {
		const source = `pixels = Buffer<Uint8>(4);
export init = () {
	loop >> (i: Int32) { i >= 4 ? break : set(pixels, i, Uint8(i + 1)) }
};
export frame = (): Buffer<Uint8> { pixels };`;
		const compiled = Program({
			sys: {
				readFile: () => source,
				readBytes: () => new Uint8Array(),
			},
		}).compileFile('life.gb');
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);

		const instance = instantiateWasm(compiled.bytes);
		const init = instance.exports.init;
		const frame = instance.exports.frame;
		a.assert(typeof init === 'function');
		a.assert(typeof frame === 'function');
		init();

		a.equalValues(
			uint8BufferView(instance, Number(frame())),
			Uint8Array.of(1, 2, 3, 4),
		);
	});

	s.test('should infer arithmetic through a top-level scalar binding', (a: TestApi) => {
		const source = `cols = 320;

export seed = (index: Int32): Uint8 {
	((index % cols) * 17 + (index / cols) * 31) % 23 < 5
		? Uint8(1)
		: Uint8(0)
};`;
		const compiled = Program({
			sys: {
				readFile: () => source,
				readBytes: () => new Uint8Array(),
			},
		}).compileFile('case.gb');
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);
		if (!compiled.bytes) return;

		const instance = instantiateWasm(compiled.bytes);
		const seed = instance.exports.seed;
		a.assert(typeof seed === 'function');
		if (typeof seed !== 'function') return;
		a.equalValues(
			[0, 4, 320, 321].map(index => Number(seed(index))),
			[1, 0, 0, 1],
		);
	});

	s.test('should reject an uncalled function in a conditional branch', a => {
		const source = `export init = () {
	loop >> (index: Int32) {
		index >= 1 ? break : { value = 1; value }
	}
};`;
		const compiled = Program({
			sys: {
				readFile: () => source,
				readBytes: () => new Uint8Array(),
			},
		}).compileFile('case.gb');
		a.equalValues(
			compiled.errors.map(error => error.message),
			[
				'Anonymous function value is not consumed. `{ ... }` creates a function but does not call it; move these statements into a function and call it here.',
			],
		);
	});

	s.test('should instantiate a loop with a Void helper branch', (a: TestApi) => {
		const source = `pixels = Buffer<Uint8>(4);
initializeCell = (index: Int32) {
	set(pixels, index, Uint8(index + 1))
};
export init = () {
	loop >> (index: Int32) {
		index >= 4 ? break : initializeCell(index)
	}
};`;
		const compiled = Program({
			sys: {
				readFile: () => source,
				readBytes: () => new Uint8Array(),
			},
		}).compileFile('life.gb');
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);

		const init = instantiateWasm(compiled.bytes).exports.init;
		a.assert(typeof init === 'function');
		init();
	});

	s.test('should report invalid arithmetic without Unknown cascades', a => {
		const source = `export seed = (index: Int32, cols: Int32): Bool {
	x = index % cols;
	next x * 17 < 5
};`;
		const compiled = Program({
			sys: {
				readFile: () => source,
				readBytes: () => new Uint8Array(),
			},
		}).compileFile('case.gb');
		a.equalValues(
			compiled.errors.map(error => error.message),
			[
				'Operator "*" cannot be applied to types "Int32 | DivByZero" and "Int32".',
			],
		);
	});

	s.test('should infer fixed and conditional emission sequence types', (a: TestApi) => {
		const compiled = Program().compile(`scalar = () { 1 };
pair = () { (1, true) };
base = () { (2, false) };
forward = () { base() };
conditional = (flag: Bool) { flag ? (1, true) : (2, false) };
choice = (flag: Bool) { flag ? 1 : true };
main { scalar() >> out; pair() >> out; forward() >> out; conditional(true) >> out; choice(true) >> out }`);
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);
		const emission = (name: string) => {
			const definition = compiled.ast.children.find(
				node => node.kind === 'def' && node.symbol.name === name,
			);
			a.equal(definition?.kind, 'def');
			if (definition?.kind !== 'def' || definition.value.kind !== 'fn')
				throw new Error(`Missing function ${name}`);
			const type = definition.value.symbol.emissionType;
			a.equal(type?.family, 'emission');
			if (!type || type.family !== 'emission')
				throw new Error(`Missing emission type for ${name}`);
			return type;
		};
		a.equalValues(emission('scalar').elements.map(type => type.name), [
			'Int32',
		]);
		for (const name of ['pair', 'forward', 'conditional'])
			a.equalValues(emission(name).elements.map(type => type.name), [
				'Int32',
				'Bool',
			]);
		const choice = emission('choice').elements[0];
		a.equal(choice?.kind, 'type');
		a.equal(choice?.name, 'Int32 | Bool');
	});

	s.test('should infer forwarded and dynamic rest emission types', (a: TestApi) => {
		const compiled = Program().compile(`strings = (): { ...own String } { next 'a'; next 'b' };
forward = () { strings() };
ints = (): { ...Int32 } { next 1; next 2 };
bools = (): { ...Bool } { next true; next false };
choose = (flag: Bool) { flag ? ints() : bools() };
until = (n: Int32) { loop >> { $ >= n ? break : $ } };
mapped = (n: Int32) { until(n) >> { $ + 1 } };
main { forward() >> String { out($) }; choose(true) >> Int32 { out($) } | Bool { out($) }; mapped(2) >> Int32 { out($) } }`);
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);
		const emission = (name: string) => {
			const definition = compiled.ast.children.find(
				node => node.kind === 'def' && node.symbol.name === name,
			);
			if (definition?.kind !== 'def' || definition.value.kind !== 'fn')
				throw new Error(`Missing function ${name}`);
			const type = definition.value.symbol.emissionType;
			if (!type || type.family !== 'emission')
				throw new Error(`Missing emission type for ${name}`);
			return type;
		};
		a.equal(emission('forward').rest?.name, 'String');
		a.equal(emission('forward').restOwnership, 'own');
		a.equal(emission('choose').rest?.name, 'Int32 | Bool');
		a.equal(emission('until').rest?.name, 'Int32');
		a.equal(emission('mapped').rest?.name, 'Int32');
	});

	s.test('should defer unresolved recursive and generic emission inference', (a: TestApi) => {
		const compiled = Program().compile(`recursive = (n: Int32) { n == 0 ? 0 : recursive(n - 1) };
generic = <T>(value: T) { value };
main { recursive(2) >> out; generic(2) >> out }`);
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);
		for (const name of ['recursive', 'generic']) {
			const definition = compiled.ast.children.find(
				node => node.kind === 'def' && node.symbol.name === name,
			);
			if (definition?.kind !== 'def' || definition.value.kind !== 'fn')
				throw new Error(`Missing function ${name}`);
			a.equal(definition.value.symbol.emissionType, undefined);
		}
	});

	const runEmissionProgram = (a: TestApi, source: string): string[] => {
		const compiled = Program().compile(source);
		a.equal(compiled.errors.length, 0);
		a.assert(compiled.bytes);
		const out: string[] = [];
		const instance = instantiateWasm(compiled.bytes, value => out.push(value));
		const main = instance.exports.main;
		a.equal(typeof main, 'function');
		if (typeof main === 'function') main();
		return out;
	};

	s.test('lowers fixed emission types to direct or fused Wasm calls', (a: TestApi) => {
		const out = runEmissionProgram(a, `scalar = () { 7 };
pair = () { (1, true) };
other = () { (2, false) };
forward = () { pair() };
choose = (flag: Bool) { flag ? pair() : other() };
main {
	scalar() >> out;
	forward() >> Int32 { out($) } | Bool { out($) };
	choose(false) >> Int32 { out($) } | Bool { out($) }
}`);
		a.equalValues(out, ['7', '1', 'true', '2', 'false']);
	});

	s.test('fuses rest emission types through Wasm pipelines', (a: TestApi) => {
		const out = runEmissionProgram(a, `strings = (): { ...own String } { next 'a'; next 'bb' };
otherStrings = (): { ...own String } { next 'ccc'; done };
forward = () { strings() };
stringChoice = (flag: Bool) { flag ? strings() : otherStrings() };
ints = (): { ...Int32 } { next 1; next 2 };
bools = (): { ...Bool } { next true; next false };
choose = (flag: Bool) { flag ? ints() : bools() };
until = (n: Int32) { loop >> { $ >= n ? break : $ } };
mapped = (n: Int32) { until(n) >> { $ + 10 } };
main {
	forward() >> String { length($) } >> out;
	stringChoice(false) >> String { length($) } >> out;
	choose(false) >> Int32 { out($) } | Bool { out($) };
	mapped(3) >> out
}`);
		a.equalValues(out, ['1', '2', '3', 'true', 'false', '10', '11', '12']);
	});

	s.test('specializes higher-order fixed Wasm emissions before forwarding', (a: TestApi) => {
		const out = runEmissionProgram(a, `type Pair<T> = { T, T };
twice = (n: Int32): Pair<Int32> { next n; next n + 1 };
apply = (cb: (Int32): Pair<Int32>, n: Int32): Pair<Int32> { cb(n) };
main { apply(twice, 5) >> out }`);
		a.equalValues(out, ['5', '6']);
	});
	h('Hello World', ({ p }) => {
		p(
			`
		 This is a sample of a simple "Hello World" program. The _main_ block is our entry point.
		 No code is allowed outside of it other than type and function definitions.
		 The standard library is a global prelude whose symbols are available unqualified.
		 The pipe \`>>\` operator will call the \`out\` function passing its left value as an argument.
		`,
			({ rule }) => {
				rule({
					src: `main { 'Hello World' >> out }`,
					ast: `(root (main (>> 'Hello World' :out)))`,
					out: ['Hello World'],
				});
			},
		);
	});

	h('Directives', ({ p }) => {
		p(
			'`#` is the directive sigil, not a comment marker. Free-text comments do not exist: every `#`-form is a registered, parsed directive (`#test`, `#importmap`), so nothing in a source file can silently rot — an example must compile, a map must resolve. Unknown directives and prose after `#` are scan errors.',
			({ compileError }) => {
				compileError({
					src: '# just a note\nmain { }',
					expected: 'free-text comments do not exist',
				});
				compileError({
					src: '#note { }\nmain { }',
					expected: 'known directives',
				});
			},
		);
	});

	h('Identifiers', ({ p }) => {
		p(
			'Identifiers must begin with a letter and can include alphanumeric characters or underscores. Lowercase identifiers (`x`, `count`) name values; uppercase identifiers (`Int`, `Point`) name types.',
			({ match, throws }) => {
				match('ident', { kind: 'ident' });
				match('ident_2', { kind: 'ident' });
				match('ident_', { kind: 'ident' });
				match('Type', { kind: 'ident' });

				throws(() => match('_under'), {
					position: { start: 0, end: 1 },
				});
			},
		);
	});

	h('Operators', ({ h, token, expr, match, rule, compileError }) => {
		rule({
			p: '`&&`/`||` short-circuit: the right operand is evaluated only when the left does not decide the result.',
			src: `hit = (): Bool { 'hit' >> out; next true };
main {
	false && hit() >> out;
	true || hit() >> out;
	true && hit() >> out;
}`,
			ast: `(root (def :hit ? (fn typeident (>> 'hit' :out) (next :true))) (main (>> (&& :false (call :hit ?)) :out) (>> (|| :true (call :hit ?)) :out) (>> (&& :true (call :hit ?)) :out)))`,
			out: ['false', 'true', 'hit', 'true'],
		});
		token('!', 'Boolean NOT', '!');
		token('~', 'Bitwise NOT', '~');
		token('&', 'Bitwise AND', '&');
		token('&&', 'Short-circuiting logical AND', '&&');
		token('*', 'Arithmetic multiplication', '*');
		token('+', 'Addition', '+');
		token('-', 'Arithmetic Negation (Unary)', '-');
		token('-', 'Arithmetic Substraction', '-');
		token('.', 'Member access', '.');
		token('...', 'Rest emission', '...');
		token('/', 'Arithmetic division', '/');
		token('<', 'Less than comparison', '<');
		token('<=', 'Less than or equal comparison', '<=');
		token('=', 'Assignment', '=');
		token('==', 'Equality comparison', '==');
		token('>', 'Greater than comparison', '>');
		token('>=', 'Greater than or equal comparison', '>=');
		token('>>', 'Pipe Operator', '>>');
		token('->', 'Thread-first Operator', '->');
		token('|', 'Bitwise OR', '|');
		token('||', 'Short-circuiting logical OR', '||');
		token('?', 'Conditional Ternary Operator', '?');
		token(':>', 'Bitwise Shift Right', ':>');
		token('<:', 'Bitwise Shift Left', '<:');

		expr({
			p: 'Binding from tightest: call/member (`f(x)`, `.`), unary (`!` `~` `-`), `*` `/` `%`, `+` `-`, `<:` `:>`, comparisons, `==` `!=`, `&`, `^`, `|`, `&&`, `||`, ternary `?`, thread/pipe (`->` `>>`), then `,`. Comma emits each value in order and binds looser than thread/pipe: `a, b >> f` emits `a` followed by `b >> f`; use `(a, b) >> f` to pipe both emissions. Note `&`/`^`/`|` bind looser than `==` — `1 & 3 == 3` is `1 & (3 == 3)`.',
			src: '1 + 2 * 3',
			ast: '(+ 1 (* 2 3))',
			out: ['7'],
		});
		rule({
			src: `inc = (n: Int32): Int32 { n + 10 };
main { 1, 2 >> inc >> out }`,
			ast: `(root (def :inc ? (fn (parameter :n typeident ?) typeident (next (+ :n 10)))) (main (, 1 (>> 2 :inc :out))))`,
			out: ['12'],
		});
		rule({
			src: `inc = (n: Int32): Int32 { n + 10 };
main { (1, 2) >> inc >> out }`,
			ast: `(root (def :inc ? (fn (parameter :n typeident ?) typeident (next (+ :n 10)))) (main (>> (, 1 2) :inc :out)))`,
			out: ['11', '12'],
		});
		rule({
			src: `inc = (n: Int32): Int32 { n + 10 };
main { 1 >> inc >> out, 2 >> out }`,
			ast: `(root (def :inc ? (fn (parameter :n typeident ?) typeident (next (+ :n 10)))) (main (, (>> 1 :inc :out) (>> 2 :out))))`,
			out: ['11', '2'],
		});
		rule({
			p: '`->` is the thread-first operator: the value on its left is prepended to the call arguments on its right. Chains are left-associative and reuse ordinary call typing and evaluation.',
			src: `add = (a: Int32, b: Int32): Int32 { a + b };
multiply = (a: Int32, b: Int32): Int32 { a * b };
main { 2 -> add(3) -> multiply(4) >> out }`,
			ast: `(root (def :add ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))) (def :multiply ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (* :a :b)))) (main (>> (call :multiply (, (call :add (, 2 3)) 4)) :out)))`,
			out: ['20'],
		});
		rule({
			p: 'A parenthesized comma list supplies multiple leading arguments in order; arithmetic binds before `->`, while comma remains looser.',
			src: `sum3 = (a: Int32, b: Int32, c: Int32): Int32 { a + b + c };
main { (1 + 1, 3) -> sum3(4) >> out }`,
			ast: `(root (def :sum3 ? (fn (parameter :a typeident ?) (parameter :b typeident ?) (parameter :c typeident ?) typeident (next (+ (+ :a :b) :c)))) (main (>> (call :sum3 (, (+ 1 1) 3 4)) :out)))`,
			out: ['9'],
		});
		rule({
			p: 'Thread-first calls use normal generic and overload resolution.',
			src: `measure = <T>(value: T, extra: Int32): Int32 { length(value) + extra };
choose = (n: Int32, offset: Int32): Int32 { n + offset } | (b: Bool, offset: Int32): Int32 { b ? offset : 0 };
main { 7 -> measure(3) >> out; 5 -> choose(2) >> out; true -> choose(9) >> out }`,
			ast: `(root (def :measure ? (fn (, (parameter :T ? ?)) (parameter :value typeident ?) (parameter :extra typeident ?) typeident (next (+ (call :length @intrinsic :value) :extra)))) (def :choose ? (| (fn (parameter :n typeident ?) (parameter :offset typeident ?) typeident (next (+ :n :offset))) (fn (parameter :b typeident ?) (parameter :offset typeident ?) typeident (next (? :b :offset 0))))) (main (>> (call :measure (, 7 3)) :out) (>> (call :choose (, 5 2)) :out) (>> (call :choose (, :true 9)) :out)))`,
			out: ['4', '7', '9'],
		});
		compileError({
			p: 'The right side of `->` must be a function call.',
			src: `main { 1 -> out }`,
			expected: '`->` requires a function call on the right',
		});
		rule({
			src: `sum = (a: Int32, b: Int32): Int32 { a + b };
main { sum([1, 2] >> length, 2) >> out }`,
			ast: `(root (def :sum ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))) (main (>> (call :sum (, (>> (data (, 1 2)) :length @intrinsic) 2)) :out)))`,
			out: ['4'],
		});
		expr({
			src: '1 + 2 < 4 <: 1',
			ast: '(< (+ 1 2) (<: 4 1))',
			out: ['true'],
		});
		expr({
			src: '1 & 2 ^ 4 | 8',
			ast: '(| (^ (& 1 2) 4) 8)',
			out: ['12'],
		});
		expr({ src: '1 == 2 | 4', ast: '(| (== 1 2) 4)' });
		expr({
			src: 'true || false ? 1 : 2',
			ast: '(? (|| :true :false) 1 2)',
			out: ['1'],
		});
		rule({
			p: 'Nested conditional expressions associate to the right.',
			src: 'main { a = true; b = false; a ? b : b ? true : true >> out }',
			ast: '(root (main (def :a ? :true) (def :b ? :false) (>> (? :a :b (? :b :true :true)) :out)))',
			out: ['false'],
		});
		expr({
			src: '[1, 2].0 + 1',
			ast: '(+ (. (data (, 1 2)) 0) 1)',
			out: ['2'],
		});
		expr({
			src: '!true && false',
			ast: '(&& (! :true) :false)',
			out: ['false'],
		});
		expr({ src: '1 > 0 || 2 > 0', ast: '(|| (> 1 0) (> 2 0))' });
		expr({
			src: 'true || false && false',
			ast: '(|| :true (&& :false :false))',
		});
		expr({
			src: 'false || 3 == 4',
			ast: '(|| :false (== 3 4))',
		});
		expr({
			src: '10 + 5.5 * 20',
			ast: '(+ 10 (* 5.5 20))',
		});

		// Integer arithmetic via WASM
	 expr({ src: '1 + 2', ast: '(+ 1 2)', out: ['3'] });
	 expr({ src: '10 - 3', ast: '(- 10 3)', out: ['7'] });
	 expr({ src: '6 * 7', ast: '(* 6 7)', out: ['42'] });
	 expr({ src: '100 / 4', ast: '(/ 100 4)', out: ['25'] });
	 expr({
			src: '(10 + 5) * 2',
			ast: '(* (+ 10 5) 2)',
			out: ['30'],
		});

		match(
			'-10 -10_000 -10.53_3',
			'-',
			'number',
			'-',
			'number',
			'-',
			'float',
		);
		match('~0b100100, ~0xff', '~', 'number', ',', '~', 'number');
		expr({
			src: '(!false, !true, !!!!false)',
			ast: '(, (! :false) (! :true) (! (! (! (! :false)))))',
		});

		expr({
			src: '(true || false) && false',
			ast: '(&& (|| :true :false) :false)',
		});
		expr({
			src: '(10 + (10 * 2.4) / (10))',
			ast: '(+ 10 (/ (* 10 2.4) 10))',
		});

		h('Bitwise', ({ expr }) => {
			expr({
				src: `[ ~0, 1 <: (32 - 1), 0xF0 | 0xCC ^ 0xAA & 0xFD ]`,
				ast: `(data (, -1 (<: 1 (- 32 1)) (| 240 (^ 204 (& 170 253)))))`,
				out: ['-1', '-2147483648', '244'],
			});
		});

		h('64-bit arithmetic & bitwise', ({ expr }) => {
			expr({
				src: `(Int64(1) <: 32) + 5`,
				ast: `(+ (<: (call typeident 1) 32) 5)`,
				out: ['4294967301'],
			});
			expr({
				src: `(Int64(1) <: 20) * (Int64(1) <: 20)`,
				ast: `(* (<: (call typeident 1) 20) (<: (call typeident 1) 20))`,
				out: ['1099511627776'],
			});
			expr({
				src: `Int64(1) <: 40`,
				ast: `(<: (call typeident 1) 40)`,
				out: ['1099511627776'],
			});
			expr({
				src: `(Int64(1) <: 40) :> 8`,
				ast: `(:> (<: (call typeident 1) 40) 8)`,
				out: ['4294967296'],
			});
			expr({
				src: `(Int64(255) <: 32) & (Int64(15) <: 32)`,
				ast: `(& (<: (call typeident 255) 32) (<: (call typeident 15) 32))`,
				out: ['64424509440'],
			});
			expr({
				src: `(Int64(1) <: 40) | 5`,
				ast: `(| (<: (call typeident 1) 40) 5)`,
				out: ['1099511627781'],
			});
			expr({
				src: `(Int64(3) <: 40) ^ (Int64(1) <: 40)`,
				ast: `(^ (<: (call typeident 3) 40) (<: (call typeident 1) 40))`,
				out: ['2199023255552'],
			});
			expr({
				src: `~(Int64(1) <: 40)`,
				ast: `(~ (<: (call typeident 1) 40))`,
				out: ['-1099511627777'],
			});
		});

		h('String(Float64)', ({ expr }) => {
			expr({
				src: `String(1.5)`,
				ast: `(call typeident 1.5)`,
				out: ['1.5'],
			});
			expr({
				src: `String(0.5)`,
				ast: `(call typeident 0.5)`,
				out: ['0.5'],
			});
			expr({
				src: "'v=${0.5}'",
				ast: "(interp 0.5)",
				out: ['v=0.5'],
			});
		});

		h('Numeric promotion', ({ expr }) => {
			expr({
				src: `1 + 1.5`,
				ast: `(+ 1 1.5)`,
				out: ['2.5'],
			});
			expr({
				pre: `a = 1; b = 1.5`,
				src: `a + b`,
				ast: `(+ :a :b)`,
				out: ['2.5'],
			});
			// A literal with a decimal point or exponent is Float64 by
			// syntax even when its value is integral, so `9.0 / 2` is float
			// division (4.5), not integer division (4).
			expr({
				src: `9.0 / 2`,
				ast: `(/ 9 2)`,
				out: ['4.5'],
			});
			expr({
				src: `1.5e1 / 2`,
				ast: `(/ 15 2)`,
				out: ['7.5'],
			});
			expr({
				src: `9 / 2`,
				ast: `(/ 9 2)`,
				out: ['4'],
			});
		});

		h('Conditional operator', ({ expr, compileError }) => {
			compileError({
				src: `main { (1 ? 2 : 3) >> out }`,
				expected: 'compile-time constant',
			});
			compileError({
				src: `main { (1 < 2 ? 5 : 10) >> out }`,
				expected: 'compile-time constant',
			});
			compileError({
				src: `main { (true ? 5 : 10) >> out }`,
				expected: 'compile-time constant',
			});
			expr({
				src: `loop >> { $ >= 3 ? break : $ }`,
				ast: `(>> loop (fn (next (? (>= $ 3) break $))))`,
				out: ['0', '1', '2'],
			});
			expr({
				pre: `pick = (b: Bool): Int32 { b ? 10 : 20 }`,
				src: `pick(true)`,
				ast: `(call :pick :true)`,
				out: ['10'],
			});
			compileError({
				src: `main { 1 > 10 ? 'big' >> out }`,
				expected: 'requires both branches',
			});
			expr({
				src: `[1, 2, 3] >> each >> Int32 { $ * 2 }`,
				ast: `(>> (data (, 1 2 3)) :each (fn (parameter ? typeident ?) (next (* $ 2))))`,
				out: ['2', '4', '6'],
			});
			expr({
				src: `[1, 2, 3] >> each >> Int32 { $ > 1 ? $ }`,
				ast: `(>> (data (, 1 2 3)) :each (fn (parameter ? typeident ?) (next (? (> $ 1) $))))`,
				out: ['2', '3'],
			});
			compileError({
				src: `main { 5 >> Int32 { void } }`,
				expected: 'cannot be emitted',
			});
			compileError({
				src: `main { 5 ? next 1 : next 2 >> out }`,
				expected: '`next` is not allowed',
			});
		});
	});

	h('Keywords', ({ p }) => {
		p('The following keywords are reserved.', ({ token }) => {
			token('break', 'Stop the enclosing pipeline chain', 'break');
			token(
				'done',
				"End the enclosing function's emission sequence",
				'done',
			);
			token('export', 'Export module symbol', 'export');
			token(
				'loop',
				'Infinite emitter primitive (yields 0, 1, 2, ...)',
				'loop',
			);
			token('main', 'Source file entry point', 'main');
			token('next', 'Emit the next value from a function', 'next');
			token('type', 'Define a type alias or structure', 'type');
		});
	});

	h('Number Literals', ({ expr, match, throws }) => {
		match('42 4_2 0600 0_600', 'number', 'number', 'number', 'number');
		expr({ src: 'nan', ast: ':nan' });
		expr({ src: 'infinity', ast: ':infinity' });

		match(`0b101010110101010 0b_0001101010_101`, 'number', 'number');

		expr({
			src: `0xBadFace; 0xBad_Face; 0x_67_7a_2f_cc_40_c6`,
			ast: '195951310 195951310 113774485586118',
		});
		expr({
			src: '72.40; 072.40; 2.71828',
			ast: '72.4 72.4 2.71828',
		});
		expr({
			src: `1.5e2; 6.67428e-11; 1E6; 0.15e+0_2`,
			ast: '150 6.67428e-11 1000000 15',
		});

		throws(() => match('0.'), {
			position: { start: 0, end: 2 },
		});
		throws(() => match('0x3h 10'), {
			position: { start: 0, end: 4 },
		});
		throws(() => match('0b12'), {
			position: { start: 0, end: 4 },
		});
		throws(() => match('  12f2'), {
			position: { start: 2, end: 5 },
		});
		throws(() => match('1_.5'));
		throws(() => match('1.5e_1'));
		throws(() => match('1.5e1_'));
		throws(() => match('42_'));
		throws(() => match('4__2'));
		throws(() => match('0_xBadFace'));
	});

	h('Boolean Literals', ({ expr }) => {
		expr({ src: 'true', ast: ':true' });
		expr({ src: 'false', ast: ':false' });
	});

	h('String Literals', ({ h, match, expr }) => {
		match(`'variable length \\'string\\''`, 'string');
		match(
			`'
        Multiline
        String
    '`,
			'string',
		);
		expr({
			p: 'A literal may span lines; every source line break (LF, CRLF, lone CR) becomes exactly `\\n`, so content is independent of the file’s line-ending style. Normalization precedes escape decoding — an explicit `\\r` survives. Continuation-line indentation is kept as written.',
			src: "'a\nb' == 'a\r\nb'",
			ast: "(== 'a\nb' 'a\r\nb')",
			out: ['true'],
		});
		expr({
			src: "length('a\r\nb')",
			ast: "(call :length @intrinsic 'a\r\nb')",
			out: ['3'],
		});
		match(
			"'${1}+${1}=${1+1}'",
			'strhead',
			'number',
			'strmid',
			'number',
			'strmid',
			'number',
			'+',
			'number',
			'strtail',
		);
		match("'no holes'", 'string');

		h('Escape Sequences', ({ expr, compileError }) => {
		 expr({
				src: `'line\\nA\\u{42}'`,
				ast: "'line\\nA\\u{42}'",
				out: ['line\nAB'],
			});
		 expr({
				src: `'a\\nb\\rc\\td\\'e\\00f'`,
				ast: `'a\\nb\\rc\\td\\'e\\00f'`,
				out: ["a\nb\rc\td'e\0f"],
			});
		 expr({
				src: `'\\41\\30\\"'`,
				ast: `'\\41\\30\\"'`,
				out: ['A0"'],
			});
			compileError({
				src: `main { '\\q' >> out }`,
				expected: 'Invalid string escape',
			});
		});

		h('Interpolation', ({ expr, compileError }) => {
			expr({
				src: "'${Char(65)}'",
				ast: `(interp (call typeident 65))`,
				out: ['A'],
			});
			expr({
				src: "'n=${5}'",
				ast: `(interp 5)`,
				out: ['n=5'],
			});
			expr({
				src: "'${Uint8(65)}'",
				ast: `(interp (call typeident 65))`,
				out: ['65'],
			});
			expr({
				src: "'${'x'}${'y'}'",
				ast: `(interp 'x' 'y')`,
				out: ['xy'],
			});
			expr({
				src: "'pre-${'mid'}-post'",
				ast: `(interp 'mid')`,
				out: ['pre-mid-post'],
			});
			expr({
				src: "'${'a'}${Char(66)}${'c'}'",
				ast: `(interp 'a' (call typeident 66) 'c')`,
				out: ['aBc'],
			});
			expr({
				src: "'a${'b${'c'}d'}e'",
				ast: `(interp (interp 'c'))`,
				out: ['abcde'],
			});
			expr({
				pre: "g: String = 'hi'",
				src: "'${g}!'",
				ast: `(interp :g)`,
				out: ['hi!'],
			});
			expr({
				src: "'${'ab'}${'c'}' == 'abc'",
				ast: `(== (interp 'ab' 'c') 'abc')`,
				out: ['true'],
			});
			expr({
				src: "'\\${x}'",
				ast: "'\\${x}'",
				out: ['${x}'],
			});
			compileError({
				src: "main { '${[1, 2]}' >> out }",
				expected: 'cannot convert',
			});
		});
	});

	h('Char', ({ expr, compileError }) => {
		expr({
			src: `String(Char(65))`,
			ast: `(call typeident (call typeident 65))`,
			out: ['A'],
		});
		expr({
			src: `String(Char(Uint8(66)))`,
			ast: `(call typeident (call typeident (call typeident 66)))`,
			out: ['B'],
		});
		compileError({
			src: `main { Char(65) + Char(66) >> out }`,
			expected: 'cannot be applied',
		});
		expr({
			src: `Char(0x110000) == Char(65533)`,
			ast: `(== (call typeident 1114112) (call typeident 65533))`,
			out: ['true'],
		});
		expr({
			src: `Char(0xD800) == Char(65533)`,
			ast: `(== (call typeident 55296) (call typeident 65533))`,
			out: ['true'],
		});
		expr({
			src: `Char(233)`,
			ast: `(call typeident 233)`,
			out: ['é'],
		});
		expr({
			src: `Char(8364)`,
			ast: `(call typeident 8364)`,
			out: ['€'],
		});
		expr({
			src: `Char(128512)`,
			ast: `(call typeident 128512)`,
			out: ['😀'],
		});
		expr({
			src: `Char(0x110000)`,
			ast: `(call typeident 1114112)`,
			out: ['�'],
		});
		expr({
			src: `length(String(Char(8364)))`,
			ast: `(call :length @intrinsic (call typeident (call typeident 8364)))`,
			out: ['3'],
		});
	});

	h('Function overloads', ({ expr, compileError }) => {
		expr({
			p: 'An overloaded name is a set of arms; a call selects the single arm whose parameter type accepts the argument. Dispatch is forward — the argument type chooses the arm — and never depends on the type expected of the result.',
			pre: 'size = (n: Int32): Int32 { n } | (s: String): Int32 { length(s) }',
			src: 'size(5)',
			ast: '(call :size 5)',
			out: ['5'],
		});
		expr({
			p: 'A different argument type selects a different arm of the same overload.',
			pre: 'size = (n: Int32): Int32 { n } | (s: String): Int32 { length(s) }',
			src: "size('abc')",
			ast: "(call :size 'abc')",
			out: ['3'],
		});
		expr({
			p: 'A narrower integer argument adopts a wider integer arm: `5` selects the `Int64` arm when no exact `Int32` arm exists — no `Int64(5)` needed.',
			pre: 'g = (n: Int64): Int64 { n + 1 } | (b: Bool): Int64 { 99 }',
			src: 'g(5)',
			ast: '(call :g 5)',
			out: ['6'],
		});
		expr({
			p: 'An exact arm still wins over an integer-widening one — `5` binds the `Int32` arm even when an `Int64` arm is present.',
			pre: 'h = (n: Int32): Int32 { n } | (n: Int64): Int32 { 0 }',
			src: 'h(5)',
			ast: '(call :h 5)',
			out: ['5'],
		});
		expr({
			pre: 'g2 = (b: Bool): Int64 { 99 } | (n: Int64): Int64 { n + 1 }',
			src: 'g2(5)',
			ast: '(call :g2 5)',
			out: ['6'],
		});
		compileError({
			p: 'Every arm of an overload must return the same type. An overload is one operation with many input types, not unrelated functions sharing a name, so the result type never depends on which arm ran; arms that disagree on the return type are rejected.',
			src: "f = (n: Int32): Int32 { n } | (s: String): Bool { length(s) == 0 }; main { f(5) >> out }",
			expected: 'must return the same type',
		});
		compileError({
			p: 'Two arms may not accept the same input type. Overload resolution must have a single answer, so a dispatch with two arms for one parameter type is rejected as ambiguous rather than silently preferring one.',
			src: "f = (n: Int32): Int32 { n } | (m: Int32): Int32 { m }; main { f(5) >> out }",
			expected: 'ambiguous overload',
		});
		expr({
			p: '`extend name (param: T): R { … }` adds an arm to an existing overload, dispatched by `T` like any other arm — how an overload defined in one place gains new input types elsewhere.',
			pre: "size = (n: Int32): Int32 { n }; extend size (s: String): Int32 { length(s) }",
			src: "size('abc')",
			ast: "(call :size 'abc')",
			out: ['3'],
		});
		compileError({
			p: '`extend` may only add to a name that is already an overload. Extending an undefined name is an error, so a misspelling cannot silently create a new one-arm function.',
			src: "extend nope (n: Int32): Int32 { n }; main { }",
			expected: 'not a dispatch',
		});
		compileError({
			p: 'An arm added with `extend` must return the overload’s established return type — the same uniform-return rule that governs the original arms.',
			src: "size = (n: Int32): Int32 { n }; extend size (s: String): Bool { true }; main { size(5) >> out }",
			expected: 'must return the same type',
		});
		compileError({
			p: 'An `extend` arm may not accept an input type an existing arm already handles; overlapping arms are rejected as ambiguous, exactly as within a single definition.',
			src: "size = (n: Int32): Int32 { n }; extend size (m: Int32): Int32 { m }; main { size(5) >> out }",
			expected: 'ambiguous overload',
		});
	});

	h('Type constructors', ({ expr, compileError }) => {
		compileError({
			p: 'A constructor must change or establish a type; constructing a value already typed as the target is redundant.',
			src: 'main { Int32(123) >> out }',
			expected: 'Redundant type constructor `Int32`; the argument is already `Int32`.',
		});
		compileError({
			src: 'main { n: Int64 = 123; Int64(n) >> out }',
			expected: 'Redundant type constructor `Int64`; the argument is already `Int64`.',
		});
		compileError({
			src: "main { s: String = '${1}'; String(s) >> out }",
			expected: 'Redundant type constructor `String`; the argument is already `String`.',
		});
		expr({
			p: 'A constructor remains valid when it converts a value from a distinct type.',
			pre: 'widen = (n: Int32): Int64 { Int64(n) }',
			src: 'widen(123)',
			ast: '(call :widen 123)',
			out: ['123'],
		});
		expr({
			p: 'A type used as a call is its constructor — an overload keyed by the type whose arms all return that type. `String(x)` converts a value to its textual form by dispatching on the input type (the former `toString`, now retired).',
			src: 'String(true)',
			ast: '(call typeident :true)',
			out: ['true'],
		});
		expr({
			p: 'A narrower int widens to a wider int arm, the dispatch rule.',
			src: 'String(Uint8(200))',
			ast: '(call typeident (call typeident 200))',
			out: ['200'],
		});
		expr({
			p: 'A string literal may establish `String`; its literal type is distinct from an existing `String` value.',
			src: "String('already')",
			ast: "(call typeident 'already')",
			out: ['already'],
		});
		expr({
			p: 'A type’s default constructor takes its own structural value — the explicit spelling of the structural-to-nominal re-brand. A field-less error constructs with `Boom()` (the trace slot gives it existence); a plain type with no structure cannot even be declared.',
			pre: 'type Point = [ x: Int32, y: Int32 ]; dist = (p: Point): Int32 { p.x + p.y }',
			src: 'dist(Point([ x = 3, y = 4 ]))',
			ast: '(call :dist (call typeident (data (, (propdef :x ? 3) (propdef :y ? 4)))))',
			out: ['7'],
		});
		compileError({
			p: 'A structureless type is Void itself (`[]` is Void) — it has no values, so the declaration is rejected, not just its construction.',
			src: 'type Unit = []; main { }',
			expected: 'has no structure',
		});
		compileError({
			src: 'type Unit = Void; main { }',
			expected: 'has no structure',
		});
		compileError({
			src: 'type Point = [ x: Int32, y: Int32 ]; main { p = Point([ z = 1 ]); p.x >> out }',
			expected: 'not assignable to "Point"',
		});
		expr({
			p: '`extend String (…): String` adds a to-text arm for a new input type: this is how a user type gains a `String(x)` conversion, and how the built-in `Int32`/`Bool` arms are themselves defined.',
			pre: "type Celsius = Int32; extend String (c: Celsius): String { 'cold' }",
			src: 'String(Celsius(5))',
			ast: '(call typeident (call typeident 5))',
			out: ['cold'],
		});
		compileError({
			p: 'Every arm of a type constructor must return that type — `String(x)` always yields a `String` whatever the input — so an arm declaring any other return type is rejected. This is the uniform-return rule, pinned to the type by the constructor’s name.',
			src: "type Celsius = Int32; extend String (c: Celsius): Int32 { 0 }; main { String(Celsius(5)) >> out }",
			expected: 'must return String',
		});
	});

	h('Data Blocks', ({ expr, compileError, rule }) => {
		expr({
			p: 'A data block is fixed-shape tuple or record storage. Labels use `name = value`, are unique compile-time aliases for positions, and disappear during iteration. Labeled and positional members may be mixed; every member remains accessible through the single `.` operator by label or constant numeric position.',
			src: `[ 'string', 2, true, 4.5 ]`,
			ast: `(data (, 'string' 2 :true 4.5))`,
		});
		expr({
			src: `[ 10 ] == 10`,
			ast: `(== (data 10) 10)`,
			out: ['true'],
		});
		expr({
			src: `[ label = 'string', 2 ]`,
			ast: `(data (, (propdef :label ? 'string') 2))`,
		});
		expr({
			src: `[ first = 'a', second = 'b' ].first`,
			ast: `(. (data (, (propdef :first ? 'a') (propdef :second ? 'b'))) :first)`,
			out: ['a'],
		});
		expr({
			src: `[ 10, 20, 30 ].1`,
			ast: `(. (data (, 10 20 30)) 1)`,
			out: ['20'],
		});
		expr({
			src: `[ x = 10, y = 20 ].0`,
			ast: `(. (data (, (propdef :x ? 10) (propdef :y ? 20))) 0)`,
			out: ['10'],
		});
		expr({
			pre: `double = (n: Int32): Int32 { n + n }; math = [ d = double ]`,
			src: `math.d(5)`,
			ast: `(call (. :math :d) 5)`,
			out: ['10'],
		});
		expr({
			src: `[ 1, x = 2, 3 ]`,
			ast: `(data (, 1 (propdef :x ? 2) 3))`,
		});
		compileError({
			src: `main { [ x = 1, x = 2 ] >> out }`,
			expected: 'Duplicate label "x"',
		});
		compileError({
			src: `main { [ name: var = 'Alice' ] >> out }`,
			expected: '`var` is valid only',
		});
		rule({
			p: 'Positional members type like labeled ones wherever they appear \u2014 `d.0` is the member, not a fallback scalar.',
			src: `main { d = [ 'abcd\${7}', 42 ]; length(d.0) >> out; d.1 >> out }`,
			ast: `(root (main (def :d ? (data (, (interp 7) 42))) (>> (call :length @intrinsic (. :d 0)) :out) (>> (. :d 1) :out)))`,
			out: ['5', '42'],
		});
		rule({
			p: 'Positional access chains: `d.1.0` reads member 1 then member 0 — a `.N` right after a member dot is another index, not a decimal, so `d.1.0` is `(d.1).0`.',
			src: `main { d = [ 9, [ 7, 8 ] ]; d.1.0 >> out }`,
			ast: `(root (main (def :d ? (data (, 9 (data (, 7 8))))) (>> (. (. :d 1) 0) :out)))`,
			out: ['7'],
		});
		rule({
			src: `main { g = [ [ 1, 2 ], [ 3, 4 ] ]; g.0.1 >> out; g.1.0 >> out }`,
			ast: `(root (main (def :g ? (data (, (data (, 1 2)) (data (, 3 4))))) (>> (. (. :g 0) 1) :out) (>> (. (. :g 1) 0) :out)))`,
			out: ['2', '3'],
		});
		rule({
			p: 'A decimal is still a float except right after a member dot — `3.14` is one float token; only the `.N` following a member access is an index.',
			src: `main { 3.14 >> out; x = [ 5, 6 ]; x.1 >> out }`,
			ast: `(root (main (>> 3.14 :out) (def :x ? (data (, 5 6))) (>> (. :x 1) :out)))`,
			out: ['3.14', '6'],
		});
		rule({
			p: 'A one-element block collapses to its element \u2014 as a value (`[x]` is `x`) and as a type (`[T]` is `T`); `[\u2026]` is a fixed product, not a variable-length collection. So a `[String]` parameter is a `String`.',
			src: `wrap = (t: [String]): Int32 { length(t) };
main { wrap('hello') >> out }`,
			ast: `(root (def :wrap ? (fn (parameter :t (data (propdef ? typeident ?)) ?) typeident (next (call :length @intrinsic :t)))) (main (>> (call :wrap 'hello') :out)))`,
			out: ['5'],
		});
		rule({
			src: `bump = (n: [Int32]): Int32 { n + 1 };
main { bump(41) >> out }`,
			ast: `(root (def :bump ? (fn (parameter :n (data (propdef ? typeident ?)) ?) typeident (next (+ :n 1)))) (main (>> (call :bump 41) :out)))`,
			out: ['42'],
		});
		compileError({
			p: 'Because `[String]` is `String`, a multi-element block is a distinct product type and is rejected \u2014 not silently misread as a one-element collection.',
			src: `wrap = (t: [String]): Int32 { length(t) };
main { wrap([ 'p', 'q' ]) >> out }`,
			expected: 'not assignable',
		});
		expr({
			p: 'Piping passes a data block as one value. Iteration is explicit through `each`, which emits the member values without their labels.',
			src: `[ 1, 2 ] >> each`,
			ast: `(>> (data (, 1 2)) :each)`,
			out: ['1', '2'],
		});
		// Streaming non-Int32 elements: the scalar-lift slot must use the
		// element's wasm type (e.g. f64), not a hardcoded i32.
		expr({
			src: `[ 1.5, 2.5, 3.5 ] >> each`,
			ast: `(>> (data (, 1.5 2.5 3.5)) :each)`,
			out: ['1.5', '2.5', '3.5'],
		});
		expr({
			src: `reverse([ 1.5, 2.5, 3.5 ])`,
			ast: `(call :reverse (data (, 1.5 2.5 3.5)))`,
			out: ['3.5', '2.5', '1.5'],
		});
		expr({
			pre: `sum = (b) { b.0 + b.1 }`,
			src: `[ 10, 20 ] >> sum`,
			ast: `(>> (data (, 10 20)) :sum)`,
			out: ['30'],
		});
		expr({
			src: `[ x = 1, y = 2 ] >> each`,
			ast: `(>> (data (, (propdef :x ? 1) (propdef :y ? 2))) :each)`,
			out: ['1', '2'],
		});
		expr({
			src: `([ [1, 2], [3, 4] ].1).0`,
			ast: `(. (. (data (, (data (, 1 2)) (data (, 3 4)))) 1) 0)`,
			out: ['3'],
		});
		expr({
			src: `[ [1, 2], [3, 4] ] >> each >> each`,
			ast: `(>> (data (, (data (, 1 2)) (data (, 3 4)))) :each :each)`,
			out: ['1', '2', '3', '4'],
		});
		rule({
			src: `main { [ [1, 2], [3, 4] ] >> each >> (p) { p.0 * p.1 } >> out }`,
			ast: `(root (main (>> (data (, (data (, 1 2)) (data (, 3 4)))) :each (fn (parameter :p ? ?) (next (* (. :p 0) (. :p 1)))) :out)))`,
			out: ['2', '12'],
		});
		compileError({
			src: `main { [1, 2] >> each >> Int32:Int32 { 'oops' } >> out }`,
			expected: 'is not assignable',
		});
		rule({
			p: 'A block never splices: its items are its elements, labeled or not. `each` over record elements yields each element as a unit — a borrow of the block — so collections of records stream, index, and zip as written.',
			src: `type Point = [ x: Int32, y: Int32 ];
main { ps = [ [ x = 1, y = 2 ], [ x = 3, y = 4 ] ]; length(ps) >> out; ps >> each >> (p: Point) { p.x + p.y } >> out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (main (def :ps ? (data (, (data (, (propdef :x ? 1) (propdef :y ? 2))) (data (, (propdef :x ? 3) (propdef :y ? 4)))))) (>> (call :length @intrinsic :ps) :out) (>> :ps :each (fn (parameter :p typeident ?) (next (+ (. :p :x) (. :p :y)))) :out)))`,
			out: ['2', '3', '7'],
		});
	});

	h('Code Blocks', ({ expr, ast, h, compileError }) => {
		expr({
			p: 'A call uses parentheses and passes one argument value. Multiple arguments form one data block that the parameter list destructures; juxtaposition is never a call.',
			src: `(a) { a }`,
			ast: `(fn (parameter :a ? ?) (next :a))`,
		});
		expr({
			src: `(a: Int32, b: Int32) { a + b }`,
			ast: `(fn (parameter :a typeident ?) (parameter :b typeident ?) (next (+ :a :b)))`,
		});
		ast({
			src: `helper = (f: Fn) { { f() } }`,
			ast: `(def :helper ? (fn (parameter :f typeident ?) (next (fn (next (call :f ?))))))`,
		});
		expr({
			src: `[value = 5] >> { 10 + $.value }`,
			ast: `(>> (data (propdef :value ? 5)) (fn (next (+ 10 (. $ :value)))))`,
			out: ['15'],
		});
		expr({
			src: `{ 1 + 2 }`,
			ast: `(fn (next (+ 1 2)))`,
			out: ['3'],
		});
		expr({
			src: `{ 1, 2, 3 }`,
			ast: `(fn (next (, 1 2 3)))`,
			out: ['1', '2', '3'],
		});
		expr({
			src: `{ }`,
			ast: `(fn)`,
			out: [],
		});
		compileError({
			src: `main { () { } >> out }`,
			expected: 'Empty `() { }`',
		});
		compileError({
			src: `main { { next 1 } >> out }`,
			expected: '`next` is not allowed',
		});
		compileError({
			src: `main { { done } >> out }`,
			expected: '`done`',
		});
		compileError({
			src: `main { { break } >> out }`,
			expected: '`break`',
		});
		compileError({
			src: `f = { next next 1; }; main { f() >> out }`,
			expected: 'Expected expression',
		});
		compileError({
			src: `f = (x: Int32) { x }; main { f(next 1) >> out }`,
			expected: 'Expected ")"',
		});
		expr({
			pre: `x = { $ }`,
			src: `x(1, 2, 3)`,
			ast: `(call :x (, 1 2 3))`,
			out: ['1', '2', '3'],
		});
	 expr({
			pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
			src: `add(b = 1, a = 2)`,
			ast: `(call :add (, (propdef :b ? 1) (propdef :a ? 2)))`,
			out: ['3'],
		});
		expr({
			pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
			src: `addOne(void)`,
			ast: `(call :addOne :void)`,
			out: ['42'],
		});

		h('Inline pipe functions', ({ testBlock }) => {
			testBlock({
				p: 'An inline pipe function may pass captured Copy-valued parameters to a named function.',
				src: `g = (a: Int32, b: Int32): Int32 { a + b };
f = (a: Int32, b: Int32): Int32 {
	g(a, b) >> (n: Int32): Int32 { n + g(a, b) }
};
#test { equal(target(), 6) }
export target = (): Int32 { f(1, 2) }`,
				out: [],
			});
			testBlock({
				p: 'The result of an inline pipe function remains available to a local binding.',
				src: `g = (a: Int32, b: Int32): Int32 { a + b };
f = (a: Int32, b: Int32) {
	value = g(a, b) >> (n: Int32): Int32 { n + g(a, b) };
	out(a);
	value >> out
};
#test { target() }
export target = () { f(1, 2) }`,
				out: ['1', '6'],
			});
			testBlock({
				p: 'A life-like inline pipe function may call a named function with captured arguments.',
				src: `neighbours = (index: Int32, current: Buffer<Uint8>): Int32 { 2 };
cell = (index: Int32, current: Buffer<Uint8>): Uint8 { Uint8(1) };
nextCell = (index: Int32, current: Buffer<Uint8>): Uint8 {
	neighbours(index, current) >> (count: Int32): Uint8 {
		count == 3 ||
		(count == 2 && cell(index, current) == Uint8(1))
			? Uint8(1)
			: Uint8(0)
	}
};
#test { equal(target(), Uint8(1)) }
export target = (): Uint8 { nextCell(0, Buffer<Uint8>(1)) }`,
				out: [],
			});
		});

		h('Recursion', ({ rule }) => {
			rule({
				src: `factorial = (n: Int32): Int32 { (n <= 1) ? 1 : n * factorial(n - 1) }; main { factorial(0) >> out; factorial(1) >> out; factorial(2) >> out; factorial(3) >> out; factorial(4) >> out; factorial(5) >> out; }`,
				ast: '(root (def :factorial ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 1) 1 (* :n (call :factorial (- :n 1))))))) (main (>> (call :factorial 0) :out) (>> (call :factorial 1) :out) (>> (call :factorial 2) :out) (>> (call :factorial 3) :out) (>> (call :factorial 4) :out) (>> (call :factorial 5) :out)))',
				out: ['1', '1', '2', '6', '24', '120'],
			});

			rule({
				src: `fib = (n: Int32): Int32 { n <= 1 ? n : fib(n - 1) + fib(n - 2) }; main { fib(0) >> out; fib(1) >> out; fib(2) >> out; fib(3) >> out; fib(4) >> out; fib(5) >> out; fib(6) >> out; }`,
				ast: '(root (def :fib ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 1) :n (+ (call :fib (- :n 1)) (call :fib (- :n 2))))))) (main (>> (call :fib 0) :out) (>> (call :fib 1) :out) (>> (call :fib 2) :out) (>> (call :fib 3) :out) (>> (call :fib 4) :out) (>> (call :fib 5) :out) (>> (call :fib 6) :out)))',
				out: ['0', '1', '1', '2', '3', '5', '8'],
			});

			rule({
				src: `ackermann = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ackermann(m - 1, 1) : (ackermann(m - 1, ackermann(m, n - 1)))) }; main { ackermann(1, 3) >> out; ackermann(2, 3) >> out; ackermann(3, 3) >> out; ackermann(1, 5) >> out; ackermann(2, 5) >> out; ackermann(3, 5) >> out; }`,
				ast: `(root (def :ackermann ? (fn (parameter :m typeident ?) (parameter :n typeident ?) typeident (next (? (== :m 0) (+ :n 1) (? (== :n 0) (call :ackermann (, (- :m 1) 1)) (call :ackermann (, (- :m 1) (call :ackermann (, :m (- :n 1)))))))))) (main (>> (call :ackermann (, 1 3)) :out) (>> (call :ackermann (, 2 3)) :out) (>> (call :ackermann (, 3 3)) :out) (>> (call :ackermann (, 1 5)) :out) (>> (call :ackermann (, 2 5)) :out) (>> (call :ackermann (, 3 5)) :out)))`,
				out: ['5', '9', '61', '7', '13', '253'],
			});

			// A function used as its OWN pipe stage (`(n - 1) >> f` inside `f`)
			// must compile — the stage inliner emits a real recursive call on
			// self-reference instead of inlining its own body forever (which
			// overflowed the compiler). No `out`: this fn has no base case, so we
			// only assert the compiler terminates and produces a module.
			rule({
				src: `f = (n: Int32): Int32 { (n - 1) >> f }; main { f(3) >> out }`,
				ast: `(root (def :f ? (fn (parameter :n typeident ?) typeident (next (>> (- :n 1) :f)))) (main (>> (call :f 3) :out)))`,
			});

			// Self-pipe recursion with a base case runs and returns a value: the
			// recursive `(n - 1) >> f` stage is a real call, the ternary branch
			// leaves its value (it does not emit into the outer `>> out`).
			rule({
				src: `f = (n: Int32): Int32 { n <= 0 ? 100 : ((n - 1) >> f) }; main { f(3) >> out }`,
				ast: `(root (def :f ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 0) 100 (>> (- :n 1) :f))))) (main (>> (call :f 3) :out)))`,
				out: ['100'],
			});

			// The final self stage of a pipe lowers to the function loop backedge,
			// so self-pipe recursion stays flat — 1M deep does not grow the stack.
			rule({
				src: `f = (n: Int32): Int32 { n <= 0 ? 100 : ((n - 1) >> f) }; main { f(1000000) >> out }`,
				ast: `(root (def :f ? (fn (parameter :n typeident ?) typeident (next (? (<= :n 0) 100 (>> (- :n 1) :f))))) (main (>> (call :f 1000000) :out)))`,
				out: ['100'],
				wasm: {
					fn: 'f',
					loop: true,
					tailCalls: 0,
					selfTailCalls: 0,
					locals: [0x7f],
				},
			});
		});

		h('Emitting Values', ({ expr }) => {
			expr({
				pre: `emitValues = { next(1, 2, 3); done; }`,
				src: `emitValues()`,
				ast: `(call :emitValues ?)`,
				out: ['1', '2', '3'],
			});
			expr({
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn (next (+ $ 1))))`,
				out: ['2', '3'],
			});
			expr({
				pre: `emit = { done }`,
				src: `emit() >> { $ + 1 }`,
				ast: `(>> (call :emit ?) (fn (next (+ $ 1))))`,
				out: [],
			});
			expr({
				pre: `emit = { next(1, 2); done; }`,
				src: `emit() >> { $, $ + 10 }`,
				ast: `(>> (call :emit ?) (fn (next (, $ (+ $ 10)))))`,
				out: ['1', '11', '2', '12'],
			});
		});

		h('Completion', ({ expr }) => {
			expr({
				pre: 'demo = { next(1); done; next(2); }',
				src: 'demo()',
				ast: '(call :demo ?)',
				out: ['1'],
			});
		});

		h('Chaining', ({ expr }) => {
			expr({
				pre: `
a = {
	add4 = (a: Int32) { a + 4 };
	times2 = (a: Int32) { a * 2 };
	add4times2 = { $ >> add4 >> times2 };
	next(10 >> add4times2);
}`,
				src: `a()`,
				ast: '(call :a ?)',
				out: ['28'],
			});
		});

		h('Re-emission & propagation', ({ rule, compileError }) => {
			compileError({
				src: `inner = { next(1, 2); done; }; outer = { inner(); next(99); done; }; main { outer() >> out }`,
				expected: 'value is not consumed',
			});
			rule({
				src: `inner = { next(1, 2); done; }; outer = { next inner(); next(99); done; }; main { outer() >> out }`,
				ast: `(root (def :inner ? (fn (next (, 1 2)) done)) (def :outer ? (fn (next (call :inner ?)) (next 99) done)) (main (>> (call :outer ?) :out)))`,
				out: ['1', '2', '99'],
			});
			rule({
				src: `inner = { next(1, 2); done; }; outer = { inner() }; main { outer() >> out }`,
				ast: `(root (def :inner ? (fn (next (, 1 2)) done)) (def :outer ? (fn (next (call :inner ?)))) (main (>> (call :outer ?) :out)))`,
				out: ['1', '2'],
			});
			compileError({
				src: `outer = { { next(1, 2); done; }; next(99); done; }; main { outer() >> out }`,
				expected: 'value is not consumed',
			});
		});
	});

	h('Anonymous Blocks (Shape 1: untyped `{ body }`)', ({ p }) => {
		p(
			`Anonymous blocks \`{ body }\` are first-class function values. The body has two forms:
			 (1) auto-emit — value-expressions separated by \`,\` (no \`;\`), each auto-emits;
			 (2) statement body — statements separated by \`;\`, using \`next\` to emit.
			 Inside the block, \`$\` is the upstream value or call argument.`,
			({ expr, compileError }) => {
				expr({
					src: `{ }`,
					ast: `(fn)`,
					out: [],
				});
				expr({
					src: `{ 5 }`,
					ast: `(fn (next 5))`,
					out: ['5'],
				});
				expr({
					src: `{ 1, 2, 3 }`,
					ast: `(fn (next (, 1 2 3)))`,
					out: ['1', '2', '3'],
				});
				expr({
					src: `5 >> { $ + 1 }`,
					ast: `(>> 5 (fn (next (+ $ 1))))`,
					out: ['6'],
				});
				expr({
					src: `[x = 10] >> { $.x }`,
					ast: `(>> (data (propdef :x ? 10)) (fn (next (. $ :x))))`,
					out: ['10'],
				});
				expr({
					src: `{ next 5; next 6; }`,
					ast: `(fn (next 5) (next 6))`,
					out: ['5', '6'],
				});
				expr({
					src: `loop >> { break }`,
					ast: `(>> loop (fn break))`,
					out: [],
				});
				compileError({
					src: `main { { next 5 } >> out }`,
					expected: '`next` is not allowed',
				});
				compileError({
					src: `identity = (n: Int32): Int32 { next n }; main { identity(5) >> out }`,
					expected: '`next` is not allowed',
				});
				compileError({
					src: `main { { done } >> out }`,
					expected: '`done`',
				});
				compileError({
					src: `main { { 5; 6; } >> out }`,
					expected: 'no emission',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 2: type-prefix `T { body }`)', ({ p }) => {
		p(
			`A type expression followed by \`{ body }\` annotates the implicit \`$\` parameter
			 with type \`T\`. The body is auto-emit; emitted values determine the return type.
			 The type prefix may be: a simple typeident (\`Int32\`), a union (\`Int32 | String\`),
			 a tuple (\`[Int32, String]\`), or a labeled record (\`[a: Int32, b: Int32]\`).`,
			({ expr, compileError }) => {
				expr({
					src: `5 >> Int32 { $ + 1 }`,
					ast: `(>> 5 (fn (parameter ? typeident ?) (next (+ $ 1))))`,
					out: ['6'],
				});
				expr({
					src: `5 >> Int32 { 1, 2, 3 }`,
					ast: `(>> 5 (fn (parameter ? typeident ?) (next (, 1 2 3))))`,
					out: ['1', '2', '3'],
				});
				expr({
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ + 1 } | Error { 99 }`,
					ast: `(>> (call :risky 0) (| (fn (parameter ? typeident ?) (next (+ $ 1))) (fn (parameter ? typeident ?) (next 99))))`,
					out: ['99'],
				});
				expr({
					src: `true >> Bool { $ }`,
					ast: `(>> :true (fn (parameter ? typeident ?) (next $)))`,
					out: ['true'],
				});
				expr({
					pre: `mixed = (): Int32 | String { 42 }`,
					src: `mixed() >> Int32 | String { $ }`,
					ast: `(>> (call :mixed ?) (fn (parameter ? typeident ?) (next $)))`,
					out: ['42'],
				});
				expr({
					src: `[1, 'hi'] >> [Int32, String] { $.0 }`,
					ast: `(>> (data (, 1 'hi')) (fn (parameter ? (data (, (propdef ? typeident ?) (propdef ? typeident ?))) ?) (next (. $ 0))))`,
					out: ['1'],
				});
				expr({
					src: `[a = 10, b = 20] >> [a: Int32, b: Int32] { $.a + $.b }`,
					ast: `(>> (data (, (propdef :a ? 10) (propdef :b ? 20))) (fn (parameter ? (data (, (propdef :a typeident ?) (propdef :b typeident ?))) ?) (next (+ (. $ :a) (. $ :b)))))`,
					out: ['30'],
				});
				compileError({
					src: `main { 5 >> Int32 { } >> out }`,
					expected: 'empty',
				});
				compileError({
					src: `main { 5 >> [1, 2] { $ } >> out }`,
					expected: 'expected type',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 3: type-prefix with return `T:R { body }`)', ({ p }) => {
		p(
			`A type-prefix block may assert its output via \`T:R\`; the body
			 (auto-emit or statement body) must produce exactly that signature.
			 \`T:Void\` explicitly describes a terminal stage that emits nothing.`,
			({ expr, compileError, rule }) => {
				expr({
					src: `5 >> Int32:Int32 { $ * 2 }`,
					ast: `(>> 5 (fn (parameter ? typeident typeident) (next (* $ 2))))`,
					out: ['10'],
				});
				expr({
					src: `5 >> Int32:Bool { $ > 0 }`,
					ast: `(>> 5 (fn (parameter ? typeident typeident) (next (> $ 0))))`,
					out: ['true'],
				});
				rule({
					src: `main { 5 >> Int32 { out($) } }`,
					ast: `(root (main (>> 5 (fn (parameter ? typeident ?) (next (call :out $))))))`,
					out: ['5'],
				});
				rule({
					src: `main { [1, 2, 3] >> each >> Int32 { out($) } }`,
					ast: `(root (main (>> (data (, 1 2 3)) :each (fn (parameter ? typeident ?) (next (call :out $))))))`,
					out: ['1', '2', '3'],
				});
				expr({
					src: `5 >> Int32:Int32 { next $; next $ + 1; }`,
					ast: `(>> 5 (fn (parameter ? typeident typeident) (next $) (next (+ $ 1))))`,
					out: ['5', '6'],
				});
				compileError({
					src: `main { 5 >> Int32:Int32 { 'oops' } >> out }`,
					expected: 'is not assignable',
				});
				compileError({
					src: `main { 5 >> Int32 { out($) } >> Int32 { $ + 1 } >> out }`,
					expected: 'unreachable',
				});
				rule({
					src: `main { 5 >> Int32:Void { out($) } }`,
					ast: `(root (main (>> 5 (fn (parameter ? typeident typeident) (next (call :out $))))))`,
					out: ['5'],
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 4: literal-type prefix `:T { body }`)', ({ p }) => {
		p(
			`A leading colon followed by a literal type creates an anonymous-slot block matching that literal type.
			 Use this for matching literal values (\`true\`, \`false\`, \`0\`, \`'on'\`, etc.).
			 Uppercase/named types use Shape 2 (\`T { body }\`) without the leading colon —
			 \`:Int32 { ... }\` is a compile error. Parens around a single anonymous slot
			 (\`(:T) { ... }\`) are likewise an error; the bare \`:T { ... }\` is canonical.`,
			({ expr, compileError }) => {
				expr({
					src: `true >> :true { 1 }`,
					ast: `(>> :true (fn (parameter ? typeident ?) (next 1)))`,
					out: ['1'],
				});
				expr({
					src: `false >> :false { 0 }`,
					ast: `(>> :false (fn (parameter ? typeident ?) (next 0)))`,
					out: ['0'],
				});
				expr({
					pre: `check = (n: Int32): Bool { n > 0 }`,
					src: `check(5) >> :true { 'positive' } | :false { 'non-positive' }`,
					ast: `(>> (call :check 5) (| (fn (parameter ? typeident ?) (next 'positive')) (fn (parameter ? typeident ?) (next 'non-positive'))))`,
					out: ['positive'],
				});
				compileError({
					src: `main { loop >> :true { break } >> out }`,
					expected: 'does not consume',
				});
				expr({
					pre: `mode = (): 'on' | 'off' { 'on' }`,
					src: `mode() >> :'on' { 'enabled' } | :'off' { 'disabled' }`,
					ast: `(>> (call :mode ?) (| (fn (parameter ? typeident ?) (next 'enabled')) (fn (parameter ? typeident ?) (next 'disabled'))))`,
					out: ['enabled'],
				});
				expr({
					src: `0 >> :0 | false | '' { 'falsy' }`,
					ast: `(>> 0 (fn (parameter ? typeident ?) (next 'falsy')))`,
					out: ['falsy'],
				});
				compileError({
					src: `main { 5 >> :Int32 { $ } >> out; }`,
					expected: 'use `Int32`',
				});
				compileError({
					src: `main { 5 >> (:Int32) { $ } >> out }`,
					expected: 'Parens',
				});
				compileError({
					pre: `check = (n: Int32): Bool { n > 0 }`,
					src: `main { check(5) >> :true { 1 } >> out }`,
					expected: 'does not consume',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 6: single-named slot `(name: T) { body }`)', ({ p }) => {
		p(
			`\`(name: T) { body }\` is a single-slot pattern that matches by type and binds the
			 whole upstream value to a local name. Match rule: if upstream type equals/conforms
			 to \`T\`, bind. There is no field projection — to access one field of a multi-field
			 record, use Shape 2 (\`[a: T, b: T] { $.b }\`).

			 Body forms follow Shape 1: a single value-expression auto-emits; a statement body
			 (with \`;\`) uses \`next\` for emissions. A statement body whose only statements are
			 \`next\` of value-expressions is reducible — the compiler forces the shorter comma form.`,
			({ expr, compileError }) => {
				expr({
					src: `5 >> (n: Int32) { n + 1 }`,
					ast: `(>> 5 (fn (parameter :n typeident ?) (next (+ :n 1))))`,
					out: ['6'],
				});
				expr({
					pre: `type Fail = Error & [ code: Int32 ]; fail = (): Fail { [ code = 7 ] }; risky = (n: Int32): Int32 | Fail { n > 0 ? n : fail() }`,
					src: `risky(0) >> Int32 { $ } | (e: Fail) { e.code }`,
					ast: `(>> (call :risky 0) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter :e typeident ?) (next (. :e :code)))))`,
					out: ['7'],
				});
				expr({
					pre: `type Point = [x: Int32, y: Int32]; p: Point = [x = 3, y = 4]`,
					src: `p >> (q: Point) { q.x + q.y }`,
					ast: `(>> :p (fn (parameter :q typeident ?) (next (+ (. :q :x) (. :q :y)))))`,
					out: ['7'],
				});
				expr({
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: ['10'],
				});
				expr({
					pre: `double = (n: Int32) { n * 2 }`,
					src: `double(n = 5)`,
					ast: `(call :double (propdef :n ? 5))`,
					out: ['10'],
				});
				expr({
					src: `5 >> (n: Int32) { doubled = n * 2; next doubled; next doubled + 1; }`,
					ast: `(>> 5 (fn (parameter :n typeident ?) (def :doubled ? (* :n 2)) (next :doubled) (next (+ :doubled 1))))`,
					out: ['10', '11'],
				});
				compileError({
					src: `main { 5 >> (n: Int32) { next n; next n + 1; } >> out }`,
					expected: 'reducible',
				});
				compileError({
					src: `main { [10, 20] >> (n: Int32) { n } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					src: `main { 5 >> (n: Int32) { next n } >> out }`,
					expected: '`next` is not allowed',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 7: single-named slot with return `(name: T): R { body }`)', ({ p }) => {
		p(
			`Shape 7 extends Shape 6 with an explicit return type \`R\`. Every emission from the body
			 (auto-emit or via \`next\`) must produce a value compatible with \`R\`. Without \`:R\`,
			 the return type is inferred; with \`:R\`, it is asserted and checked.`,
			({ expr, compileError, rule }) => {
				expr({
					pre: `double = (n: Int32): Int32 { n * 2 }`,
					src: `double(5)`,
					ast: `(call :double 5)`,
					out: ['10'],
				});
				expr({
					pre: `isPositive = (n: Int32): Bool { n > 0 }`,
					src: `isPositive(5)`,
					ast: `(call :isPositive 5)`,
					out: ['true'],
				});
				expr({
					pre: `type ParseErr = Error & [ code: Int32 ]; parseErr = (): ParseErr { [ code = 0 ] }; parseInt = (s: String): Int32 | Error { length(s) == 0 ? parseErr() : 42 }`,
					src: `parseInt('42')`,
					ast: `(call :parseInt '42')`,
					out: ['42'],
				});
				expr({
					pre: `square = (n: Int32): Int32 { n / 2 >> Int32 { $ * 2 } }`,
					src: `square(6)`,
					ast: `(call :square 6)`,
					out: ['6'],
				});
				rule({
					src: `print = (n: Int32) { out(n) }; main { 5 >> print }`,
					ast: `(root (def :print ? (fn (parameter :n typeident ?) (next (call :out :n)))) (main (>> 5 :print)))`,
					out: ['5'],
				});
				expr({
					pre: `factorial = (n: Int32): Int32 { n <= 1 ? 1 : n * factorial(n - 1) }`,
					src: `factorial(5)`,
					ast: `(call :factorial 5)`,
					out: ['120'],
				});
				expr({
					pre: `pair = (n: Int32): [Int32, Int32] { [n, n + 1] }`,
					src: `pair(5) >> { $.0 + $.1 }`,
					ast: `(>> (call :pair 5) (fn (next (+ (. $ 0) (. $ 1)))))`,
					out: ['11'],
				});
				expr({
					pre: `spread = (n: Int32): { Int32, Int32 } { half = n / 2; next half; next n - half; }`,
					src: `spread(10)`,
					ast: `(call :spread 10)`,
					out: ['5', '5'],
				});
				expr({
					pre: `pair = (n: Int32): { Int32, Bool } { next n; next true }`,
					src: `pair(7)`,
					ast: `(call :pair 7)`,
					out: ['7', 'true'],
				});
				expr({
					pre: `pair = (n: Int32) { next n; next true }`,
					src: `pair(7)`,
					ast: `(call :pair 7)`,
					out: ['7', 'true'],
				});
				expr({
					pre: `pair = (n: Int32): { Int32, Bool } { next n; next true }; triple = (n: Int32): { Int32, Bool, Int32 } { next pair(n); next n + 1 }`,
					src: `triple(7)`,
					ast: `(call :triple 7)`,
					out: ['7', 'true', '8'],
				});
				compileError({
					src: `main { pair = (n: Int32): { Bool, Int32 } { next n; next true }; pair(7) >> out }`,
					expected: 'emission 1',
				});
				compileError({
					src: `main { pair = (n: Int32): { Int32, Bool } { n }; pair(7) >> out }`,
					expected: 'declares 2 emissions but produces 1',
				});
				compileError({
					src: `main { none = (): {} { done }; none() }`,
					expected: 'Use `Void`',
				});
				compileError({
					src: `main { one = (): { Int32 } { 1 }; one() >> out }`,
					expected: 'Use the element type directly',
				});
				compileError({
					src: `main { double = (n: Int32): Int32 { 'oops' }; double(5) >> out; }`,
					expected: 'is not assignable',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 8: multi-slot destructure `(a, b) { body }`)', ({ p }) => {
		p(
			`Multi-slot patterns destructure their input into named slots. The fn's parameter
			 names define labels for \`$\`. Calls and chain piping conform to those labels:
			 positional args bind by slot order, labeled args reorder to match the fn's labels.
			 Mixing positional and labeled args in the same call is forbidden. Labels that don't
			 match the fn's parameter names are a compile error.`,
			({ expr, compileError }) => {
				expr({
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn (parameter :a ? ?) (parameter :b ? ?) (next (+ :a :b))))`,
					out: ['3'],
				});
				expr({
					src: `[1, 2] >> (a: Int32, b: Int32) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn (parameter :a typeident ?) (parameter :b typeident ?) (next (+ :a :b))))`,
					out: ['3'],
				});
				expr({
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `[b = 2, a = 1] >> sub`,
					ast: `(>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :sub)`,
					out: ['-1'],
				});
				expr({
					src: `[10, 20] >> (a, b) { a + b }`,
					ast: `(>> (data (, 10 20)) (fn (parameter :a ? ?) (parameter :b ? ?) (next (+ :a :b))))`,
					out: ['30'],
				});
				expr({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: ['3'],
				});
				expr({
					pre: `sub = (a: Int32, b: Int32) { a - b }`,
					src: `sub(b = 1, a = 2)`,
					ast: `(call :sub (, (propdef :b ? 1) (propdef :a ? 2)))`,
					out: ['1'],
				});
				expr({
					pre: `add3 = (a: Int32, b: Int32, c: Int32) { a + b >> Int32 { $ + c } }`,
					src: `add3(1, 2, 3)`,
					ast: `(call :add3 (, 1 2 3))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3] >> (a, b, c) { a + b + c }`,
					ast: `(>> (data (, 1 2 3)) (fn (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (next (+ (+ :a :b) :c))))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3] >> (a, b) { a + b.0 + b.1 }`,
					ast: `(>> (data (, 1 2 3)) (fn (parameter :a ? ?) (parameter :b ? ?) (next (+ (+ :a (. :b 0)) (. :b 1)))))`,
					out: ['6'],
				});
				expr({
					src: `[1, 2, 3, 4] >> (a, b, c) { a + b + c.0 + c.1 }`,
					ast: `(>> (data (, 1 2 3 4)) (fn (parameter :a ? ?) (parameter :b ? ?) (parameter :c ? ?) (next (+ (+ (+ :a :b) (. :c 0)) (. :c 1)))))`,
					out: ['10'],
				});
				expr({
					src: `[1, 2] >> (a, b) { a + b }`,
					ast: `(>> (data (, 1 2)) (fn (parameter :a ? ?) (parameter :b ? ?) (next (+ :a :b))))`,
					out: ['3'],
				});
				compileError({
					src: `main { 5 >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					src: `main { [1, 2, 3] >> (a, b) { a + b } >> out }`,
					expected: 'numeric operands',
				});
				compileError({
					src: `main { [1, 2, 3] >> (a: Int32, b: Int32) { a + b } >> out }`,
					expected: 'not assignable',
				});
				compileError({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `main { add(x = 1, y = 2) >> out }`,
					expected: 'no match',
				});
				compileError({
					pre: `add = (a: Int32, b: Int32) { a + b }`,
					src: `main { add(1, b = 2) >> out }`,
					expected: 'cannot mix',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 9: multi-slot destructure with return `(a, b): R { body }`)', ({ p }) => {
		p(
			`Shape 9 extends Shape 8 with an explicit return type \`R\`. Every emission from
			 the body must produce a value compatible with \`R\`. Same rules as Shape 7 (single
			 slot + return), but with multiple destructured parameters.`,
			({ expr, compileError }) => {
				expr({
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `add(1, 2)`,
					ast: `(call :add (, 1 2))`,
					out: ['3'],
				});
				expr({
					pre: `eq = (a: Int32, b: Int32): Bool { a == b }`,
					src: `eq(3, 3)`,
					ast: `(call :eq (, 3 3))`,
					out: ['true'],
				});
				expr({
					pre: `type DivErr = Error & [ code: Int32 ]; divErr = (): DivErr { [ code = 0 ] }; divide = (a: Int32, b: Int32): Int32 | Error { b == 0 ? divErr() : a / b }`,
					src: `divide(10, 2)`,
					ast: `(call :divide (, 10 2))`,
					out: ['5'],
				});
				expr({
					pre: `mid = (a: Int32, b: Int32, c: Int32): Int32 { a + b + c >> Int32 { $ / 3 } }`,
					src: `mid(2, 4, 6)`,
					ast: `(call :mid (, 2 4 6))`,
					out: ['4'],
				});
				expr({
					pre: `printPair = (a: Int32, b: Int32) { out(a); out(b); }`,
					src: `printPair(1, 2)`,
					ast: `(call :printPair (, 1 2))`,
					out: ['1', '2'],
				});
				expr({
					pre: `swap = (a: Int32, b: Int32): [Int32, Int32] { [b, a] }`,
					src: `swap(1, 2) >> { $.0 - $.1 }`,
					ast: `(>> (call :swap (, 1 2)) (fn (next (- (. $ 0) (. $ 1)))))`,
					out: ['1'],
				});
				expr({
					pre: `spread = (a: Int32, b: Int32): { Int32, Int32 } { next a; next b; }`,
					src: `spread(7, 11)`,
					ast: `(call :spread (, 7 11))`,
					out: ['7', '11'],
				});
				expr({
					pre: `ack = (m: Int32, n: Int32): Int32 { m == 0 ? n + 1 : (n == 0 ? ack(m - 1, 1) : ack(m - 1, ack(m, n - 1))) }`,
					src: `ack(2, 3)`,
					ast: `(call :ack (, 2 3))`,
					out: ['9'],
				});
				compileError({
					src: `main { bad = (a: Int32, b: Int32): Int32 { 'oops' }; bad(1, 2) >> out; }`,
					expected: 'is not assignable',
				});
			},
		);
	});

	h('Anonymous Blocks (Shape 12: parameter defaults `(name: T = expr) { body }`)', ({ p }) => {
		p(
			`A parameter may declare a default expression via \`= expr\`. The signature's type
			 is effectively \`T | Void\` for callers (they may pass \`void\` to use the default);
			 the body sees the narrowed concrete type \`T\` because the default substitution
			 happens at the param-binding step. Default expressions may reference earlier params.

			 Call rules:
			 - Positional: every slot must be specified. Pass \`void\` to use a defaulted slot's default.
			 - Named: only mention overrides; omitted slots use their defaults.
			 - Empty call \`f()\` requires a 0-param fn (no sugar for "all defaults"; use named or void).`,
			({ expr, compileError }) => {
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(void)`,
					ast: `(call :addOne :void)`,
					out: ['42'],
				});
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(5)`,
					ast: `(call :addOne 5)`,
					out: ['6'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(void, void)`,
					ast: `(call :pair (, :void :void))`,
					out: ['3'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(10, void)`,
					ast: `(call :pair (, 10 :void))`,
					out: ['12'],
				});
				expr({
					pre: `pair = (a: Int32 = 1, b: Int32 = 2): Int32 { a + b }`,
					src: `pair(b = 99)`,
					ast: `(call :pair (propdef :b ? 99))`,
					out: ['100'],
				});
				expr({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `addOne(n = void)`,
					ast: `(call :addOne (propdef :n ? :void))`,
					out: ['42'],
				});
				expr({
					pre: `relate = (a: Int32, b: Int32 = a + 1): Int32 { a + b }`,
					src: `relate(3, void)`,
					ast: `(call :relate (, 3 :void))`,
					out: ['7'],
				});
				compileError({
					pre: `f = (a: Int32, b: Int32): Int32 { a + b }`,
					src: `main { f(void, 2) >> out }`,
					expected: 'not assignable',
				});
				compileError({
					pre: `addOne = (n: Int32 = 41): Int32 { n + 1 }`,
					src: `main { addOne() >> out }`,
					expected: 'No matching overload',
				});
			},
		);
	});

	h('Assignment', ({ ast, rule, compileError, testBlock }) => {
		compileError({
			p: 'An immutable Copy local is redundant when every reference occurs in the immediately following statement and its other inputs are Copy values; repeated references in that statement use one piped value.',
			src: `double = (n: Int32): Int32 {
	value = n * 2;
	next value + value
};
main { double(3) >> out }`,
			expected: 'Redundant intermediate binding "value"; pipe its initializer into the following statement.',
		});
		testBlock({
			p: 'Top-level bindings, mutable-capability bindings, locals retained across an intervening statement, and calculations involving non-Copy locals are not adjacent intermediates.',
			src: `export top = 2;
export keepVar = (n: Int32): Int32 { value: var = n * 2; next value };
export keepLater = (n: Int32): Int32 { value = n * 2; out(n); next value };
export keepHeap = (): Int32 { value = 'x\${1}'; next length(value) };
keepOwner = (a: own Buffer<Int32>): own Buffer<Int32> { size = length(a); next size > 0 ? a : a };
export keepOwnerSize = (): Int32 { length(keepOwner(Buffer<Int32>(1))) };
export keepDollar = (): Int32 { Buffer<Int32>(1) >> Buffer<Int32>:Int32 { size = length($); next size + length($) } };
#test { equal(top, 2); equal(keepVar(3), 6); equal(keepLater(4), 8); equal(keepHeap(), 2); equal(keepOwnerSize(), 0); equal(keepDollar(), 0) }
export target = (): Int32 { 0 }`,
			out: ['4'],
		});
		compileError({
			p: 'A binding type annotation is redundant when the initializer already establishes exactly that type.',
			src: 'cols: Int32 = 10; main { cols >> out }',
			expected: 'Redundant type annotation `Int32`; the initializer is already `Int32`.',
		});
		compileError({
			src: 'main { ratio: Float64 = 1.5; ratio >> out }',
			expected: 'Redundant type annotation `Float64`; the initializer is already `Float64`.',
		});
		compileError({
			src: 'main { bytes: Buffer<Uint8> = Buffer<Uint8>(4); length(bytes) >> out }',
			expected: 'Redundant type annotation `Buffer<Uint8>`; the initializer is already `Buffer<Uint8>`.',
		});
		ast({
			src: `host = 'localhost'`,
			ast: `(def :host ? 'localhost')`,
		});
		ast({
			src: `port = 8080`,
			ast: `(def :port ? 8080)`,
		});
		ast({
			src: `enabled = true`,
			ast: `(def :enabled ? :true)`,
		});
		ast({
			src: `retries: var = 0`,
			ast: `(def @variable :retries ? 0)`,
		});
		rule({
			p: 'Binding identities are immutable. An owning binding can be borrowed mutably without making the binding reassignable.',
			src: `main { buffer = Buffer<Int32>(1); set(buffer, 0, 10); get(buffer, 0) >> out }`,
			ast: `(root (main (def :buffer ? (call typeident 1)) (call :set @intrinsic (, :buffer 0 10)) (>> (call :get @intrinsic (, :buffer 0)) :out)))`,
			out: ['10'],
		});
		rule({
			p: '`var T` parameters borrow an owner exclusively for the call without moving it; the caller can use the owner afterward.',
			src: `write = (b: var Buffer<Int32>, n: Int32) { set(b, 0, n) }; main { b = Buffer<Int32>(1); write(b, 7); get(b, 0) >> out }`,
			ast: `(root (def :write ? (fn (parameter :b typeident ?) (parameter :n typeident ?) (next (call :set @intrinsic (, :b 0 :n))))) (main (def :b ? (call typeident 1)) (call :write (, :b 7)) (>> (call :get @intrinsic (, :b 0)) :out)))`,
			out: ['7'],
		});
		compileError({
			p: 'A shared alias cannot be upgraded to mutable access.',
			src: `main { owner = Buffer<Int32>(1); alias = owner; set(alias, 0, 7) }`,
			expected: 'cannot mutably borrow shared binding',
		});
		compileError({
			p: 'A local `var` annotation cannot upgrade a shared alias.',
			src: `main { owner = Buffer<Int32>(1); alias: var Buffer<Int32> = owner; set(alias, 0, 7) }`,
			expected: 'cannot mutably borrow shared binding',
		});
		compileError({
			p: 'A mutable borrow cannot overlap another argument derived from the same owner.',
			src: `inspect = (b: var Buffer<Int32>, n: Int32) { n >> out }; main { b = Buffer<Int32>(1); inspect(b, length(b)) }`,
			expected: 'overlaps argument',
		});
		testBlock({
			p: 'An explicit `var` result preserves mutable access derived from any mutable parameter.',
			src: `borrow = (b: var Buffer<Int32>): var Buffer<Int32> { b };
choose = (a: var Buffer<Int32>, b: var Buffer<Int32>, first: Bool): var Buffer<Int32> { first ? a : b };
write = (b: var Buffer<Int32>) { set(b, 0, 7) };
#test { equal(target(), 14) }
export target = (): Int32 {
	a = Buffer<Int32>(1);
	b = Buffer<Int32>(1);
	set(a, 0, 1);
	set(b, 0, 2);
	borrow(a) >> write;
	choose(a, b, false) >> write;
	next get(a, 0) + get(b, 0)
}`,
			out: [],
		});
		compileError({
			p: 'A `var` result must originate from a mutable parameter.',
			src: `borrow = (b: Buffer<Int32>): var Buffer<Int32> { b }; main { }`,
			expected: '`var` result must originate from a `var` parameter',
		});
		testBlock({
			p: 'A mutable borrow emitted through a pipeline may be reborrowed mutably or shared without transferring ownership.',
			src: `forward = (a: var Array<Int32>) { a };
write = (a: var Array<Int32>) { set(a, 0, 7) };
read = (a: Array<Int32>): Int32 { get(a, 0) };
#test { equal(target(), 7) }
export target = (): Int32 {
	a = Array<Int32>(1);
	a >> forward >> write;
	a >> forward >> read >> out;
	next get(a, 0)
}`,
			out: ['7'],
		});
		compileError({
			p: 'A mutable borrow emitted through a pipeline cannot move into an owning stage.',
			src: `consume = (a: own Array<Int32>) { length(a) >> out };
forwardThenWrite = (a: var Array<Int32>) { next a; set(a, 0, 99) };
main { a = Array<Int32>(1); set(a, 0, 7); a >> forwardThenWrite >> consume }`,
			expected: 'cannot move mutable borrow',
		});
		compileError({
			p: 'A shared borrow emitted through a pipeline cannot move into an owning stage.',
			src: `consume = (a: own Array<Int32>) { length(a) >> out };
forward = (a: Array<Int32>) { a };
main { a = Array<Int32>(1); a >> forward >> consume }`,
			expected: 'cannot move shared borrow',
		});
		compileError({
			src: `main { count = 1; count = 2 >> out; }`,
			expected: 'Cannot reassign binding',
		});
		compileError({
			src: `main { count: var = 1; count = 2 }`,
			expected: 'Cannot reassign binding',
		});
		compileError({
			p: 'Binding reassignment is rejected inside pipe-stage bodies too.',
			src: `main { count: var = 0; loop >> (i: Int32) { i >= 1 ? break; count = count + 1 } }`,
			expected: 'Cannot reassign binding',
		});
		compileError({
			src: `main { a: Int32 >> out }`,
			expected: 'declaration without value',
		});
		compileError({
			src: `main { x = 1; demo = { x: Int32 = 2; next x; }; demo() >> out; }`,
			expected: 'Cannot redeclare block-scoped variable',
		});
		compileError({
			src: `main { unused = 42 >> out }`,
			expected: 'is declared but never used',
		});
	});

	h('Types', ({ expr, rule, compileError }) => {
		rule({
			p: 'Type names begin uppercase and storage widths are explicit: signed and unsigned integers use `Int8`…`Int64` and `Uint8`…`Uint64`; floats use `Float32` or `Float64`. Other built-ins include `String`, `Bool`, `Void`, `Error`, and `Fn`. Value names and special values are lowercase.',
			src: `count: Int64 = 42; main { count >> out }`,
			ast: `(root (def :count typeident 42) (main (>> :count :out)))`,
			out: ['42'],
		});
		rule({
			src: `pi = 3.14159; main { pi >> out }`,
			ast: `(root (def :pi ? 3.14159) (main (>> :pi :out)))`,
			out: ['3.14159'],
		});
		rule({
			src: `name: String = 'Alice'; main { name >> out }`,
			ast: `(root (def :name typeident 'Alice') (main (>> :name :out)))`,
			out: ['Alice'],
		});
		expr({
			src: "'${Char(72)}${Char(105)}'",
			ast: `(interp (call typeident 72) (call typeident 105))`,
			out: ['Hi'],
		});
		expr({
			src: "'${'foo'}${'bar'}'",
			ast: `(interp 'foo' 'bar')`,
			out: ['foobar'],
		});
		expr({
			src: "'${'Hi'}${Char(33)}'",
			ast: `(interp 'Hi' (call typeident 33))`,
			out: ['Hi!'],
		});
		expr({
			src: `String(Char(72))`,
			ast: `(call typeident (call typeident 72))`,
			out: ['H'],
		});
		expr({
			src: "'${Uint16(233)}'",
			ast: `(interp (call typeident 233))`,
			out: ['233'],
		});
		expr({
			src: `Int32(2.5)`,
			ast: `(call typeident 2.5)`,
			out: ['2'],
		});
		compileError({
			src: `main { Int64('hello') >> out }`,
			expected: 'Cannot convert',
		});
		compileError({
			src: `main { Uint8([1, 2]) >> out }`,
			expected: 'Cannot convert',
		});
		compileError({
			src: `main { Float64('x') >> out }`,
			expected: 'Cannot convert',
		});
		expr({
			src: `[Uint8(72), Uint8(105)].1`,
			ast: `(. (data (, (call typeident 72) (call typeident 105))) 1)`,
			out: ['105'],
		});
		compileError({
			src: `s: String = [Uint8(72), Uint8(105)]`,
			expected: 'not assignable',
		});
		expr({
			src: `'abc' == 'abc'`,
			ast: `(== 'abc' 'abc')`,
			out: ['true'],
		});
		expr({
			src: `'abc' == 'abd'`,
			ast: `(== 'abc' 'abd')`,
			out: ['false'],
		});
		expr({
			src: `'ab' == 'abc'`,
			ast: `(== 'ab' 'abc')`,
			out: ['false'],
		});
		expr({
			src: "'${Char(104)}${Char(105)}' == 'hi'",
			ast: `(== (interp (call typeident 104) (call typeident 105)) 'hi')`,
			out: ['true'],
		});
		expr({
			src: `'abc' != 'abd'`,
			ast: `(!= 'abc' 'abd')`,
			out: ['true'],
		});
		rule({
			src: `flag = true; main { flag >> out }`,
			ast: `(root (def :flag ? :true) (main (>> :flag :out)))`,
			out: ['true'],
		});
		rule({
			src: `mode: 'on' | 'off' = 'on'; main { mode >> out }`,
			ast: `(root (def :mode typeident 'on') (main (>> :mode :out)))`,
			out: ['on'],
		});
		compileError({
			src: `mode: 'on' | 'off' = 'invalid'`,
			expected: 'is not assignable',
		});
		rule({
			src: `n: Int32 | String = 42; main { n >> out }`,
			ast: `(root (def :n typeident 42) (main (>> :n :out)))`,
			out: ['42'],
		});
		rule({
			src: `type Point = [ x: Int32, y: Int32 ]; p: Point = [ x = 10, y = 20 ]; main { p.x >> out }`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :p typeident (data (, (propdef :x ? 10) (propdef :y ? 20)))) (main (>> (. :p :x) :out)))`,
			out: ['10'],
		});
		compileError({
			src: `type Celsius = [ deg: Int32 ]; type Fahrenheit = [ deg: Int32 ]; freezing = (): Celsius { [ deg = 0 ] }; f: Fahrenheit = freezing();`,
			expected: 'not assignable',
		});
		rule({
			src: `type Named = [ name: String ]; type Aged = [ age: Int32 ]; type Person = Named & Aged; person: Person = [ name = 'Alice', age = 30 ]; main { person.name >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Aged (data (propdef :age typeident ?))) (type :Person (& typeident typeident)) (def :person typeident (data (, (propdef :name ? 'Alice') (propdef :age ? 30)))) (main (>> (. :person :name) :out)))`,
			out: ['Alice'],
		});
		rule({
			src: `type Named = [ name: String ]; type Stamped = Named & [ id: Int32 ]; mk = (): Stamped { [ name = 'Ada', id = 7 ] }; nameOf = (n: Named): String { n.name }; main { nameOf(mk()) >> out }`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Stamped (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn typeident (next (data (, (propdef :name ? 'Ada') (propdef :id ? 7)))))) (def :nameOf ? (fn (parameter :n typeident ?) typeident (next (. :n :name)))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Point = [ x: Int32 ]; type Circle = [ r: Int32 ]; mp = (): Point { [ x = 1 ] }; mc = (): Circle { [ r = 9 ] }; shape = (n: Int32): Point | Circle { n > 0 ? mp() : mc() }; main { shape(0 - 1) >> Point { 1 } | Circle { 2 } >> out }`,
			ast: `(root (type :Point (data (propdef :x typeident ?))) (type :Circle (data (propdef :r typeident ?))) (def :mp ? (fn typeident (next (data (propdef :x ? 1))))) (def :mc ? (fn typeident (next (data (propdef :r ? 9))))) (def :shape ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :mp ?) (call :mc ?))))) (main (>> (call :shape (- 0 1)) (| (fn (parameter ? typeident ?) (next 1)) (fn (parameter ? typeident ?) (next 2))) :out)))`,
			out: ['2'],
		});
		rule({
			src: `pick = (n: Int32): own Int32 | String { n > 0 ? 42 : 'hi' }; main { pick(1) >> Int32 { 0 - 1 } | String { 99 } >> out; pick(0) >> Int32 { 0 - 1 } | String { 99 } >> out; }`,
			ast: `(root (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 42 'hi')))) (main (>> (call :pick 1) (| (fn (parameter ? typeident ?) (next (- 0 1))) (fn (parameter ? typeident ?) (next 99))) :out) (>> (call :pick 0) (| (fn (parameter ? typeident ?) (next (- 0 1))) (fn (parameter ? typeident ?) (next 99))) :out)))`,
			out: ['-1', '99'],
		});
		rule({
			src: `d = (n: Int32): own Int32 | DivByZero { 10 / n }; f = (u: Int32 | DivByZero): Int32 { u >> Int32 { $ } | DivByZero { 0 - 1 } }; main { f(d(2)) >> out; f(d(0)) >> out; }`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (def :f ? (fn (parameter :u typeident ?) typeident (next (>> :u (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 1)))))))) (main (>> (call :f (call :d 2)) :out) (>> (call :f (call :d 0)) :out)))`,
			out: ['5', '-1'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; id = (u: Int32 | DivByZero): Int32 | DivByZero { u }; main { id(d(2)) >> Int32 { $ } | DivByZero { 0 } >> out; id(d(0)) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (def :id ? (fn (parameter :u typeident ?) typeident (next :u))) (main (>> (call :id (call :d 2)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out) (>> (call :id (call :d 0)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `pick = (n: Int32): own Int32 | String | Bool { n > 5 ? 1 : (n > 0 ? 'mid' : true) }; main { pick(9) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; pick(3) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; pick(0) >> Int32 { 100 } | String { 200 } | Bool { 300 } >> out; }`,
			ast: `(root (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 5) 1 (? (> :n 0) 'mid' :true))))) (main (>> (call :pick 9) (| (| (fn (parameter ? typeident ?) (next 100)) (fn (parameter ? typeident ?) (next 200))) (fn (parameter ? typeident ?) (next 300))) :out) (>> (call :pick 3) (| (| (fn (parameter ? typeident ?) (next 100)) (fn (parameter ? typeident ?) (next 200))) (fn (parameter ? typeident ?) (next 300))) :out) (>> (call :pick 0) (| (| (fn (parameter ? typeident ?) (next 100)) (fn (parameter ? typeident ?) (next 200))) (fn (parameter ? typeident ?) (next 300))) :out)))`,
			out: ['100', '200', '300'],
		});
		rule({
			src: `mixed = (n: Int32): own Float64 | String { n > 0 ? 3.14 : 'hi' }; main { mixed(1) >> Float64 { $ } | String { 0.0 } >> out; mixed(0) >> Float64 { 1.5 } | String { 2.5 } >> out; }`,
			ast: `(root (def :mixed ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 3.14 'hi')))) (main (>> (call :mixed 1) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out) (>> (call :mixed 0) (| (fn (parameter ? typeident ?) (next 1.5)) (fn (parameter ? typeident ?) (next 2.5))) :out)))`,
			out: ['3.14', '2.5'],
		});
		rule({
			src: `mixed = (n: Int32): own Float64 | String { n > 0 ? 3.14 : 'hello' }; main { mixed(1) >> out; mixed(0) >> out; }`,
			ast: `(root (def :mixed ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) 3.14 'hello')))) (main (>> (call :mixed 1) :out) (>> (call :mixed 0) :out)))`,
			out: ['3.14', 'hello'],
		});
		rule({
			src: `log = (n: Int32) { out(n) }; main { 7 >> log }`,
			ast: `(root (def :log ? (fn (parameter :n typeident ?) (next (call :out :n)))) (main (>> 7 :log)))`,
			out: ['7'],
		});
		rule({
			p: '`Void` is the explicit empty emission signature. A function annotated `Void` must emit nothing.',
			src: `log = (n: Int32): Void { out(n) }; main { 7 >> log }`,
			ast: `(root (def :log ? (fn (parameter :n typeident ?) typeident (next (call :out :n)))) (main (>> 7 :log)))`,
			out: ['7'],
		});
		compileError({
			src: `main { bad = (): Void { 1 }; bad() >> out }`,
			expected: 'declares no emissions but produces 1',
		});
		compileError({
			src: `emit = (n: Int32): Int32 | Void { n }; main { emit(7) >> out }`,
			expected: 'one fixed emission layout',
		});
		compileError({
			src: `emit = (n: Int32): Int32 | { Bool, Int32 } { n }; main { emit(7) >> out }`,
			expected: 'one fixed emission layout',
		});
	});

	h('Int64', ({ rule, compileError }) => {
		rule({
			p: 'An integer literal is typed by its value: `Int32` when it fits, `Int64` otherwise (the analog of float-by-syntax).',
			src: `main { 5000000000 >> out }`,
			ast: `(root (main (>> 5000000000 :out)))`,
			out: ['5000000000'],
		});
		rule({
			p: 'A literal adopts any integer type whose range holds its value in declarations, parameters, and returns. Non-literal values still convert explicitly (`Int64(x)`).',
			src: `n: Int64 = 5;
f = (a: Int64): Int64 { n > 0 ? a + a : 5000000000 };
main {
	f(7) >> out;
	b: Uint8 = 200;
	b >> out;
}`,
			ast: `(root (def :n typeident 5) (def :f ? (fn (parameter :a typeident ?) typeident (next (? (> :n 0) (+ :a :a) 5000000000)))) (main (>> (call :f 7) :out) (def :b typeident 200) (>> :b :out)))`,
			out: ['14', '200'],
		});
		compileError({
			p: 'A literal outside the target range does not adopt.',
			src: `main { b: Uint8 = 300; b >> out }`,
			expected: 'not assignable to declared type "Uint8"',
		});
		compileError({
			p: 'Int literals never adopt float types — a float is written with a point or exponent.',
			src: `main { x: Float64 = 5; x >> out }`,
			expected: 'not assignable to declared type "Float64"',
		});
		rule({
			p: 'Integer literals are exact across the full 64-bit range (parsed as a BigInt past the safe-integer range); only values above 2^64-1 are rejected.',
			src: `main { 9007199254740993 >> out; 18446744073709551615 >> out }`,
			ast: `(root (main (>> 9007199254740993 :out) (>> 18446744073709551615 :out)))`,
			out: ['9007199254740993', '18446744073709551615'],
		});
		compileError({
			src: `main { 20000000000000000000 >> out }`,
			expected: 'Integer literal is too large',
		});
		rule({
			src: `f = (a: Int64, b: Int64): Int64 { a + b };
main {
	f(Int64(5), Int64(7)) >> out
}`,
			ast: `(root (def :f ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))) (main (>> (call :f (, (call typeident 5) (call typeident 7))) :out)))`,
			out: ['12'],
		});
		rule({
			src: `main {
	Int64(1000000) * Int64(1000000) >> out
}`,
			ast: `(root (main (>> (* (call typeident 1000000) (call typeident 1000000)) :out)))`,
			out: ['1000000000000'],
		});
		rule({
			src: `f = (a: Int64, b: Int64): Int64 | DivByZero { a / b };
main {
	f(Int64(20), Int64(4)) >> Int64 { $ } | DivByZero { Int64(0) } >> out;
	f(Int64(20), Int64(0)) >> Int64 { $ } | DivByZero { Int64(0 - 1) } >> out;
}`,
			ast: `(root (def :f ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (/ :a :b)))) (main (>> (call :f (, (call typeident 20) (call typeident 4))) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (call typeident 0)))) :out) (>> (call :f (, (call typeident 20) (call typeident 0))) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (call typeident (- 0 1))))) :out)))`,
			out: ['5', '-1'],
		});
		rule({
			src: `main {
	Int64(10) + 3 >> out
}`,
			ast: `(root (main (>> (+ (call typeident 10) 3) :out)))`,
			out: ['13'],
		});
		rule({
			src: `main {
	Int64(5) < Int64(7) >> out
}`,
			ast: `(root (main (>> (< (call typeident 5) (call typeident 7)) :out)))`,
			out: ['true'],
		});
		rule({
			src: `main {
	Int64(5) + 2.5 >> out
}`,
			ast: `(root (main (>> (+ (call typeident 5) 2.5) :out)))`,
			out: ['7.5'],
		});
	});

	h('Unsigned integers', ({ rule }) => {
		rule({
			p: 'Unsigned types use unsigned arithmetic, comparison, and formatting — a value with the high bit set is not misread as negative. `String`/`out` and the usual arithmetic conversions preserve unsignedness.',
			src: `main { Uint32(4000000000) >> out }`,
			ast: `(root (main (>> (call typeident 4000000000) :out)))`,
			out: ['4000000000'],
		});
		rule({
			src: `main { Uint32(4294967295) >> out }`,
			ast: `(root (main (>> (call typeident 4294967295) :out)))`,
			out: ['4294967295'],
		});
		rule({
			src: `main { (Uint64(9000000000) * Uint64(2000000000)) >> out }`,
			ast: `(root (main (>> (* (call typeident 9000000000) (call typeident 2000000000)) :out)))`,
			out: ['18000000000000000000'],
		});
		rule({
			src: `main { (Uint32(4000000000) / Uint32(10)) >> out }`,
			ast: `(root (main (>> (/ (call typeident 4000000000) (call typeident 10)) :out)))`,
			out: ['400000000'],
		});
		rule({
			src: `main { (Uint32(4000000000) < Uint32(10) ? 'lt' : 'ge') >> out }`,
			ast: `(root (main (>> (? (< (call typeident 4000000000) (call typeident 10)) 'lt' 'ge') :out)))`,
			out: ['ge'],
		});
		rule({
			p: 'Dispatch prefers an exact type match over an int-widening one, so a `Uint32` argument binds the `Uint32` arm rather than a signed `Int32` arm listed before it.',
			src: `classify = (n: Int32): String { 'signed' } | (n: Uint32): String { 'unsigned' };
main { classify(Uint32(5)) >> out; classify(5) >> out }`,
			ast: `(root (def :classify ? (| (fn (parameter :n typeident ?) typeident (next 'signed')) (fn (parameter :n typeident ?) typeident (next 'unsigned')))) (main (>> (call :classify (call typeident 5)) :out) (>> (call :classify 5) :out)))`,
			out: ['unsigned', 'signed'],
		});
	});

	h('Program exit', ({ rule }) => {
		rule({
			p: '`runtime.exit(code)` ends the program immediately; the host receives the code (the CLI exits with it). `main` itself is Void — completion is exit 0.',
			src: `main {
	'bye' >> out;
	runtime.exit(3);
	'unreachable' >> out;
}`,
			ast: `(root (main (>> 'bye' :out) (call (. :runtime :exit) 3) (>> 'unreachable' :out)))`,
			out: ['bye'],
			exit: 3,
		});
	});

	h('Heap', ({ rule }) => {
		rule({
			p: 'The heap grows on demand — allocation is not bounded by the initial 64KB memory page. Freed neighbors coalesce and oversized blocks split on reuse, so even a monotonically growing buffer plateaus near its final size instead of retaining every intermediate copy.',
			src: `growString = (n: Int32): own String { n == 0 ? '' : '\${growString(n - 1)}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };
main { length(growString(1200)) >> out }`,
			ast: `(root (def :growString ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) '' (interp (call :growString (- :n 1))))))) (main (>> (call :length @intrinsic (call :growString 1200)) :out)))`,
			out: ['76800'],
			maxPages: 8,
		});
	});

	h('Heap limit', ({ memoryLimit }) => {
		memoryLimit(
			`growString = (n: Int32): own String { n == 0 ? '' : '\${growString(n - 1)}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };
main { length(growString(1200)) >> out }`,
			2,
		);
	});

	h('Heap — churn shapes', ({ rule }) => {
		rule({
			p: 'Multiple scalar tail-recursive accumulators stay flat while dynamic strings created during iteration are reclaimed.',
			src: `spin = (i: Int32, total: Int32): Int32 { i >= 200000 ? total : spin(i + 1, total + length('v\${i}')) };
main { spin(0, 0) >> out }`,
			ast: `(root (def :spin ? (fn (parameter :i typeident ?) (parameter :total typeident ?) typeident (next (? (>= :i 200000) :total (call :spin (, (+ :i 1) (+ :total (call :length @intrinsic (interp :i))))))))) (main (>> (call :spin (, 0 0)) :out)))`,
			out: ['1288890'],
			maxPages: 3,
		});
		rule({
			p: 'Churn runs flat across allocation shapes: sizes that never repeat still reuse (coalesced neighbors, split blocks, sub-word frees).',
			src: `step = (n: Int32): Int32 { m = 'x\${n}\${n * 7}\${n * 13}'; next length(m) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(400000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :n typeident ?) typeident (def :m ? (interp :n (* :n 7) (* :n 13))) (next (call :length @intrinsic :m)))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 400000 0)) :out)))`,
			out: ['8044701'],
			maxPages: 3,
		});
	});

	h('Heap — churn shapes (tail recursion)', ({ rule }) => {
		rule({
			p: 'A scalar tail-recursive accumulator can mutate an owned Buffer without moving or reallocating it.',
			src: `writeAll = (b: var Buffer<Int32>, i: Int32): Int32 {
	set(b, i, i);
	next i == 99 ? 100 : writeAll(b, i + 1)
};
main {
	b = Buffer<Int32>(100);
	count = writeAll(b, 0);
	reduce(b, count - count, (total: own Int32, n: Int32): own Int32 { total + n }) >> out
}`,
			ast: `(root (def :writeAll ? (fn (parameter :b typeident ?) (parameter :i typeident ?) typeident (call :set @intrinsic (, :b :i :i)) (next (? (== :i 99) 100 (call :writeAll (, :b (+ :i 1))))))) (main (def :b ? (call typeident 100)) (def :count ? (call :writeAll (, :b 0))) (>> (call :reduce (, :b (- :count :count) (fn (parameter :total typeident ?) (parameter :n typeident ?) typeident (next (+ :total :n))))) :out)))`,
			out: ['4950'],
			maxPages: 2,
		});
		rule({
			p: 'Scalar tail recursion runs flat without allocating aggregate state.',
			src: `spin = (i: Int32, total: Int32): Int32 { i >= 100000 ? total : spin(i + 1, total + 6) };
main { spin(0, 0) >> out }`,
			ast: `(root (def :spin ? (fn (parameter :i typeident ?) (parameter :total typeident ?) typeident (next (? (>= :i 100000) :total (call :spin (, (+ :i 1) (+ :total 6))))))) (main (>> (call :spin (, 0 0)) :out)))`,
			out: ['600000'],
			maxPages: 3,
			wasm: {
				fn: 'spin',
				loop: true,
				tailCalls: 0,
				selfTailCalls: 0,
				locals: [0x7f, 0x7f],
			},
		});
		rule({
			p: 'Recursive arguments are evaluated into typed temporaries before parameter locals update, preserving simultaneous swaps.',
			src: `rotate = (n: Int32, a: Int32, b: Int32): Int32 { n == 0 ? a * 100 + b : rotate(n - 1, b, a + b) };
main { rotate(3, 1, 2) >> out }`,
			ast: `(root (def :rotate ? (fn (parameter :n typeident ?) (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (? (== :n 0) (+ (* :a 100) :b) (call :rotate (, (- :n 1) :b (+ :a :b))))))) (main (>> (call :rotate (, 3 1 2)) :out)))`,
			out: ['508'],
			wasm: {
				fn: 'rotate',
				loop: true,
				tailCalls: 0,
				selfTailCalls: 0,
				locals: [0x7f, 0x7f, 0x7f],
			},
		});
		rule({
			p: 'Loop-carried parameter locals retain their concrete WASM widths.',
			src: `wide = (n: Int32, total: Int64): Int64 { n == 0 ? total : wide(n - 1, total + n) };
main { wide(100000, 0) >> out }`,
			ast: `(root (def :wide ? (fn (parameter :n typeident ?) (parameter :total typeident ?) typeident (next (? (== :n 0) :total (call :wide (, (- :n 1) (+ :total :n))))))) (main (>> (call :wide (, 100000 0)) :out)))`,
			out: ['5000050000'],
			wasm: {
				fn: 'wide',
				loop: true,
				tailCalls: 0,
				selfTailCalls: 0,
				locals: [0x7f, 0x7e],
			},
		});
	});

	h('Buffer & Array (push)', ({ rule, testBlock, compileError, runtimeTrap, modules }) => {
		compileError({
			p: 'The unspecialized Buffer constructor requires an element type.',
			src: `main { Buffer(1) }`,
			expected: 'Buffer requires a type argument',
		});
		testBlock({
			p: '`findIndex` returns the first element accepted by a predicate and preserves the specialized Buffer element type.',
			src: `export strings = (): own Buffer<String> {
	push(push(Buffer<String>(0), 'left'), 'right')
};
#test {
	equal(findIndex(range(3, 7), (n: Int32): Bool { n == 5 }), 2);
	equal(findIndex(range(3, 7), (n: Int32): Bool { n == 9 }), 0 - 1);
	equal(findIndex(range(0, 0), (n: Int32): Bool { n == 0 }), 0 - 1);
	equal(findIndex(strings(), (s: String): Bool { s == 'right' }), 1)
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		rule({
			p: '`fill` replaces every existing element from an indexed producer and returns the same mutable borrow for chaining.',
			src: `main {
	a = range(0, 4);
	fill(a, { 7 }) >> values >> out;
	b = range(0, 4);
	fill(b, { $ * 2 }) >> values >> out
}`,
			ast: `(root (main (def :a ? (call :range (, 0 4))) (>> (call :fill (, :a (fn (parameter ? ? ?) (next 7)))) :values :out) (def :b ? (call :range (, 0 4))) (>> (call :fill (, :b (fn (parameter ? ? ?) (next (* $ 2))))) :values :out)))`,
			out: ['7', '7', '7', '7', '0', '2', '4', '6'],
		});
		testBlock({
			p: '`Array<T>` is the public source-level collection over fixed-capacity `Buffer<T>`. `Array<T>(capacity)` constructs an empty Array, zero-capacity push grows to one, and set mutates through exclusive access.',
			src: `export empty = (): own Array<Int32> { Array<Int32>(0) };
export ints = (): own Array<Int32> { push(push(empty(), 3), 5) };
export changed = (): own Array<Int32> { a = empty() -> push(3) -> push(5); set(a, 0, 7); next a };
#test {
	equal(length(empty()), 0);
	equal(length(ints()), 2);
	equal(capacity(ints()), 2);
	equal(get(ints(), 0), 3);
	equal(get(changed(), 0), 7);
	equal(get(changed(), 1), 5)
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: '`reserveCapacity(array, minimumCapacity)` consumes and returns an Array whose total capacity is at least the requested minimum. It preserves length and values, never shrinks, and composes through `->`.',
			src: `export reserved = (): own Array<Int32> {
	Array<Int32>(0) -> reserveCapacity(8) -> push(3) -> push(5)
};
export unchanged = (): own Array<Int32> {
	Array<Int32>(4) -> push(7) -> reserveCapacity(2)
};
export strings = (): own Array<String> {
	Array<String>(1) -> push('left') -> reserveCapacity(8) -> push('right')
};
#test {
	equal(length(reserved()), 2);
	equal(capacity(reserved()), 8);
	equal(get(reserved(), 0), 3);
	equal(get(reserved(), 1), 5);
	equal(length(unchanged()), 1);
	equal(capacity(unchanged()), 4);
	equal(get(unchanged(), 0), 7);
	equal(length(strings()), 2);
	equal(capacity(strings()), 8);
	equal(get(strings(), 0), 'left');
	equal(get(strings(), 1), 'right')
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: '`values` and `slice` emit borrowed elements without consuming the Array. Slice is start-inclusive/end-exclusive, clamps a negative start to zero and stops at length.',
			src: `export ints = (): own Array<Int32> { push(push(push(Buffer<Int32>(3), 2), 4), 6) };
export sumValues = (a: Array<Int32>): Int32 {
	reduce(a, 0, (total: own Int32, n: Int32): own Int32 { total + n }) + length(a)
};
sumSliceAt = (a: Array<Int32>, i: Int32, end: Int32, total: Int32): Int32 {
	i >= end || i >= length(a)
		? total + length(a)
		: sumSliceAt(a, i + 1, end, total + get(a, i))
};
export sumSlice = (a: Array<Int32>, start: Int32, end: Int32): Int32 {
	sumSliceAt(a, start < 0 ? 0 : start, end, 0)
};
#test {
	equal(sumValues(ints()), 15);
	equal(sumSlice(ints(), 1, 3), 13);
	equal(sumSlice(ints(), 3, 8), 3);
	equal(sumSlice(ints(), 0 - 2, 1), 5);
	equal(sumSlice(ints(), 2, 1), 3)
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: 'Array algorithms support heap-owning strings, inline records, nested Arrays, empty inputs, mapping, reduction, search, and borrowed slices.',
			src: `type Item = [ id: Int32, name: String ];
export strings = (): own Array<String> { push(push(Buffer<String>(2), 'a'), 'bb') };
export records = (): own Array<Item> { push(push(Buffer<Item>(2), [ id = 1, name = 'one' ]), [ id = 2, name = 'two' ]) };
export nested = (): own Array<Array<Int32> > { push(Buffer<Array<Int32> >(1), push(Buffer<Int32>(1), 9)) };
export stringLengths = (): own Array<Int32> { map(strings(), (s: String): own Int32 { length(s) }) };
export recordIds = (): own Array<Int32> { map(records(), (item: Item): own Int32 { item.id }) };
sliceTextAt = (a: Array<String>, i: Int32, total: Int32): Int32 {
	i >= 2 || i >= length(a)
		? total + length(a)
		: sliceTextAt(a, i + 1, total + length(get(a, i)))
};
export slicedText = (a: Array<String>): Int32 {
	sliceTextAt(a, 0, 0)
};
#test {
	equal(length(map(Buffer<Int32>(0), (n: Int32): own Int32 { n + 1 })), 0);
	equal(reduce(strings(), 0, (n: own Int32, s: String): own Int32 { n + length(s) }), 3);
	equal(get(stringLengths(), 1), 2);
	equal(get(recordIds(), 1), 2);
	equal(length(get(nested(), 0)), 1);
	equal(get(get(nested(), 0), 0), 9);
	equal(slicedText(strings()), 5);
	ok(contains(strings(), 'bb'));
	equal(indexOf(strings(), 'z'), 0 - 1)
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: 'Array set borrows mutably and leaves the owner usable.',
			src: `export changed = (): own Array<Int32> { a = push(Array<Int32>(1), 7); set(a, 0, 8); next a };
#test { equal(length(changed()), 1); equal(get(changed(), 0), 8) }
export target = (): Int32 { 0 }`,
			out: [],
		});
		compileError({
			p: 'Array capacity reservation consumes its input even when the current capacity is already sufficient.',
			src: `main { a = Array<Int32>(4); b = a -> reserveCapacity(2); length(a) >> out; length(b) >> out }`,
			expected: 'used after move',
		});
		modules({
			p: 'Exported Array contracts preserve borrowing and ownership transfer across module boundaries.',
			files: {
				'/arrays.gb': `export make = (n: Int32): own Array<String> {
	push(push(Buffer<String>(2), 'left\${n}'), 'right\${n}')
};
export size = (a: Array<String>): Int32 { length(a) };
export replace = (a: own Array<String>, value: own String): own Array<String> {
	set(a, 0, value); next a
};`,
				'/main.gb': `(make, size, replace) = @.arrays;
main {
	a = make(7);
	size(a) >> out;
	size(a) >> out;
	b = replace(a, 'new');
	get(b, 0) >> out;
	get(b, 1) >> out
}`,
			},
			entry: '/main.gb',
			out: ['2', '2', 'new', 'right7'],
		});
		modules({
			p: 'An imported consuming Array function moves its argument in the caller.',
			files: {
				'/arrays.gb': `export replace = (a: own Array<String>): own Array<String> {
	set(a, 0, 'new'); next a
};`,
				'/main.gb': `(replace) = @.arrays;
main {
	a = push(Array<String>(1), 'old');
	b = replace(a);
	length(a) >> out;
	length(b) >> out
}`,
			},
			entry: '/main.gb',
			errors: 'used after move',
		});
		runtimeTrap({
			p: 'Array set replaces a live index or appends at length when capacity remains; it rejects gaps, while push is the automatic-growth operation.',
			src: `main { a = push(Array<Int32>(2), 7); set(a, 2, 8) }`,
		});
		runtimeTrap({
			p: 'Array capacity reservation rejects negative and impossible capacities consistently with construction.',
			src: `main { Array<Int32>(0) -> reserveCapacity(0 - 1) >> length >> out }`,
		});
		runtimeTrap({
			src: `main { Array<Int64>(0) -> reserveCapacity(536870911) >> length >> out }`,
		});
		testBlock({
			p: '`Buffer<T>` is the sealed memory floor. `set(buffer: var Buffer<T>, index, value: own T)` mutates without ownership transfer and returns Void; reallocating operations retain own-in/own-out contracts.',
			src: `export mk = (): own Buffer<Int32> { b = Buffer<Int32>(2); set(b, 0, 10); set(b, 1, 20); next push(b, 30) };
export sum = (b: Buffer<Int32>): Int32 { reduce(b, 0, (total: own Int32, n: Int32): own Int32 { total + n }) };
#test {
	equal(length(mk()), 3);
	equal(capacity(mk()), 4);
	equal(get(mk(), 0), 10);
	equal(get(mk(), 2), 30);
	equal(sum(mk()), 60)
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: 'Intrinsics are ordinary function symbols: call syntax and pipe syntax use the same signature, data-block argument spreading, type checking, and backend lowering. Their names have no parser or pipe-stage grammar special case.',
			src: `type Boom = Error & [ id: Int32 ];
boom = (): own Boom { [ id = 1 ] };
export one = (): own Buffer<Int32> { b = Buffer<Int32>(2); set(b, 0, 7); next b };
export pipeLength = (): Int32 { b = one(); next b >> length };
export pipeCapacity = (): Int32 { b = one(); next b >> capacity };
export pipeGet = (): Int32 { [ one(), 0 ] >> get };
export pipeSet = (): Int32 { b = Buffer<Int32>(1); set(b, 0, 9); next length(b) };
export pipeTransfer = (): Int32 { [ one(), Buffer<Int32>(1) ] >> transfer >> length };
export pipeOrigin = (): Int32 { b = boom(); next (b >> origin).line };
export callOrigin = (): Int32 { b = boom(); next origin(b).line };
export pipeFrameAt = (): Int32 { b = boom(); next ([ b, 0 ] >> frameAt).line };
export callFrameAt = (): Int32 { b = boom(); next frameAt(b, 0).line };
export pipeFrames = (): Int32 { b = boom(); next b >> frames };
export pipeStack = (): Int32 { b = boom(); next b >> runtime.stack >> length };
#test {
	equal(length(one()), pipeLength());
	equal(capacity(one()), pipeCapacity());
	equal(get(one(), 0), pipeGet());
	equal(pipeSet(), 1);
	equal(pipeTransfer(), 1);
	equal(pipeOrigin(), callOrigin());
	equal(pipeFrameAt(), callFrameAt());
	equal(pipeFrames(), frames(boom()));
	equal(pipeStack(), length(runtime.stack(boom())))
}
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: '`push` grows full storage internally, preserving live elements and length without exposing reallocation as an Array operation.',
			src: `export grow4 = (): own Array<Int32> { push(push(push(Array<Int32>(2), 7), 8), 9) };
#test { equal(get(grow4(), 0), 7); equal(get(grow4(), 1), 8); equal(get(grow4(), 2), 9); equal(length(grow4()), 3); equal(capacity(grow4()), 4) }
export target = (): Int32 { 0 }`,
			out: [],
		});
		testBlock({
			p: '`transfer` moves a buffer payload into a distinct empty destination, preserving owned elements and adopting the destination capacity.',
			src: `export moved = (): own Buffer<String> { s = Buffer<String>(2); set(s, 0, 'a'); set(s, 1, 'b'); next transfer(s, Buffer<String>(4)) };
#test { equal(get(moved(), 0), 'a'); equal(get(moved(), 1), 'b'); equal(length(moved()), 2); equal(capacity(moved()), 4) }
export target = (): Int32 { 0 }`,
			out: [],
		});
		compileError({
			p: '`transfer` requires source and destination buffers with the same element type.',
			src: `main { source = Buffer<Int32>(1); destination = Buffer<String>(1); transfer(source, destination) >> length >> out }`,
			expected: 'not assignable',
		});
		compileError({
			p: '`transfer` consumes both buffers, so neither input can be used afterward.',
			src: `main { source = Buffer<Int32>(1); destination = Buffer<Int32>(1); moved = transfer(source, destination); length(source) >> out; length(moved) >> out }`,
			expected: 'used after move',
		});
		runtimeTrap({
			p: 'Buffer capacity is nonnegative and its byte size must fit signed runtime allocation arithmetic.',
			src: `main { Buffer<Int32>(0 - 1) >> length >> out }`,
		});
		runtimeTrap({
			src: `main { Buffer<Int64>(268435455) >> length >> out }`,
		});
		runtimeTrap({
			p: '`get` requires `0 <= index < length`.',
			src: `main { b = Buffer<Int32>(1); set(b, 0, 7); get(b, 1) >> out }`,
		});
		runtimeTrap({
			src: `main { b = Buffer<Int32>(1); set(b, 0, 7); get(b, 0 - 1) >> out }`,
		});
		runtimeTrap({
			p: '`set` overwrites a live slot or appends exactly at `length`; it rejects negative indices, gaps, and appends at capacity.',
			src: `main { b = Buffer<Int32>(1); set(b, 0 - 1, 7) }`,
		});
		runtimeTrap({
			src: `main { b = Buffer<Int32>(2); set(b, 1, 7) }`,
		});
		runtimeTrap({
			src: `main { b = Buffer<Int32>(1); set(b, 0, 7); set(b, 1, 8) }`,
		});
		compileError({
			p: '`transfer` requires distinct buffers, an empty destination, and destination capacity at least the source length.',
			src: `main { b = Buffer<Int32>(1); transfer(b, b) >> length >> out }`,
			expected: 'conflicting ownership slots',
		});
		runtimeTrap({
			src: `main { source = Buffer<Int32>(1); destination = Buffer<Int32>(1); set(source, 0, 7); set(destination, 0, 8); transfer(source, destination) >> length >> out }`,
		});
		runtimeTrap({
			src: `main { source = Buffer<Int32>(2); set(source, 0, 7); set(source, 1, 8); transfer(source, Buffer<Int32>(1)) >> length >> out }`,
		});
		testBlock({
			p: 'push grows a scalar Array flat: building and dropping an Array every iteration reuses the heap — internal doubling frees the old block and owned-in threads the accumulator through `push` without a caller temp.',
			src: `export build = (b: own Array<Int32>, n: Int32): own Array<Int32> { n == 0 ? b : build(push(b, n), n - 1) };
export step = (n: Int32): Int32 { b = build(Array<Int32>(0), 8); next length(b) };
#test { equal(spin(50000, 0), 400000) }
export spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) }`,
			out: [],
			maxPages: 3,
		});
		testBlock({
			p: 'push of heap elements (`Array<String>`) stays flat: the value element is moved into the Array (single owner), so per-iteration build-and-drop is bounded.',
			src: `export buildS = (b: own Array<String>, n: Int32): own Array<String> { n == 0 ? b : buildS(push(b, '\${n}'), n - 1) };
export stepS = (n: Int32): Int32 { b = buildS(Array<String>(0), 6); next length(b) };
#test { equal(spinS(30000, 0), 180000) }
export spinS = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spinS(n - 1, acc + stepS(n)) }`,
			out: [],
			maxPages: 3,
		});
		testBlock({
			p: 'Repeated capacity reservation and drop with heap elements reuses memory and remains bounded.',
			src: `export stepReserved = (n: Int32): Int32 {
	a = Array<String>(0) -> reserveCapacity(32) -> push('\${n}');
	next length(a) + capacity(a)
};
#test { equal(spinReserved(30000, 0), 990000) }
export spinReserved = (n: Int32, acc: Int32): Int32 {
	n == 0 ? acc : spinReserved(n - 1, acc + stepReserved(n))
}`,
			out: [],
			maxPages: 3,
		});
		testBlock({
			p: '`range(start, end)` is GB source that produces an ascending, start-inclusive and end-exclusive `Buffer<Int32>`. Its recursive chain threads the owner returned by the intrinsic `set` stage; equal or descending endpoints produce an empty Buffer.',
			src: `#test {
	equal(length(range(3, 7)), 4);
	equal(get(range(3, 7), 0), 3);
	equal(get(range(3, 7), 3), 6);
	equal(reduce(range(3, 7), 0, (total: own Int32, n: Int32): own Int32 { total + n }), 18);
	equal(length(range(5, 5)), 0);
	equal(length(range(7, 3)), 0);
	equal(length(range(0, 100000)), 100000)
}
export target = (): Int32 { 0 }`,
			out: [],
			maxPages: 8,
		});
		testBlock({
			p: 'The prelude `indexOf` returns the first matching index (`-1` if absent) and `contains` reports membership, comparing elements with `==`; both read the buffer by borrow, so the source survives (`length` still `3`).',
			src: `export ints = (): own Buffer<Int32> { b = Buffer<Int32>(4); set(b, 0, 3); set(b, 1, 5); set(b, 2, 7); next b };
export strs = (): own Buffer<String> { s0 = Buffer<String>(2); s1 = push(s0, 'a'); next push(s1, 'b') };
#test {
	equal(indexOf(ints(), 5), 1);
	equal(indexOf(ints(), 9), 0 - 1);
	ok(contains(ints(), 7));
	ok(!contains(ints(), 8));
	equal(length(ints()), 3);
	equal(indexOf(strs(), 'b'), 1);
	equal(indexOf(strs(), 'z'), 0 - 1);
	ok(contains(strs(), 'a'))
}
export target = (): Int32 { 0 }`,
			out: [],
		});
	});

	h('Tail calls', ({ rule }) => {
		rule({
			p: 'Calls in tail position do not grow the stack. Tail positions include a function’s final emitted expression, either branch of a tail-position ternary, and the final stage of a tail-position pipe.',
			src: `sum = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : sum(n - 1, acc + n) };
main {
	sum(100, 0) >> out
}`,
			ast: `(root (def :sum ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :sum (, (- :n 1) (+ :acc :n))))))) (main (>> (call :sum (, 100 0)) :out)))`,
			out: ['5050'],
		});
		rule({
			debug: true,
			src: `countdown = (n: Int32): Int32 { n == 0 ? 0 : countdown(n - 1) };
main {
	countdown(1000000) >> out
}`,
			ast: `(root (def :countdown ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) 0 (call :countdown (- :n 1)))))) (main (>> (call :countdown 1000000) :out)))`,
			out: ['0'],
		});
		rule({
			src: `f = (n: Int32, d: Int32): Int32 | DivByZero { n == 0 ? 10 / d : f(n - 1, d) };
main {
	f(1000000, 2) >> Int32 { $ } | DivByZero { 0 - 1 } >> out;
	f(1000000, 0) >> Int32 { $ } | DivByZero { 0 - 1 } >> out;
}`,
			ast: `(root (def :f ? (fn (parameter :n typeident ?) (parameter :d typeident ?) typeident (next (? (== :n 0) (/ 10 :d) (call :f (, (- :n 1) :d)))))) (main (>> (call :f (, 1000000 2)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 1)))) :out) (>> (call :f (, 1000000 0)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 1)))) :out)))`,
			out: ['5', '-1'],
		});
	});

	h('Forward references & mutual recursion', ({
		rule,
		compileError,
		testBlock,
	}) => {
		rule({
			p: 'Module-scope definitions are order-independent from a function body, `main`, or `#test`. Mutual tail recursion compiles to `return_call`, so cycles run at any depth.',
			src: `isEven = (n: Int32): Bool { n == 0 ? true : isOdd(n - 1) };
isOdd = (n: Int32): Bool { n == 0 ? false : isEven(n - 1) };
main {
	isEven(10) >> out;
	isEven(1000001) >> out;
}`,
			ast: `(root (def :isEven ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) :true (call :isOdd (- :n 1)))))) (def :isOdd ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) :false (call :isEven (- :n 1)))))) (main (>> (call :isEven 10) :out) (>> (call :isEven 1000001) :out)))`,
			out: ['true', 'false'],
			wasm: {
				fn: 'isEven',
				loop: false,
				tailCalls: 1,
				selfTailCalls: 0,
			},
		});
		rule({
			p: '`main` may precede the definitions it calls.',
			src: `main { half(84) >> out }
half = (n: Int32): Int32 { n / 2 };`,
			ast: `(root (main (>> (call :half 84) :out)) (def :half ? (fn (parameter :n typeident ?) typeident (next (/ :n 2)))))`,
			out: ['42'],
		});
		rule({
			p: 'Forward references resolve through `|`-dispatch definitions.',
			src: `pick = (n: Int32): Int32 { later(n) };
later = (n: Int32): Int32 { n + 1 } | (b: Bool): Int32 { 0 };
main { pick(4) >> out }`,
			ast: `(root (def :pick ? (fn (parameter :n typeident ?) typeident (next (call :later :n)))) (def :later ? (| (fn (parameter :n typeident ?) typeident (next (+ :n 1))) (fn (parameter :b typeident ?) typeident (next 0)))) (main (>> (call :pick 4) :out)))`,
			out: ['5'],
		});
		compileError({
			p: 'Top-level initializers evaluate in source order and may only reference earlier definitions.',
			src: `y = x + 1; x = 5; main { y >> out }`,
			expected: 'Identifier not defined',
		});
		compileError({
			p: 'A local cannot be used before its declaration.',
			src: `main { a = b + 1; b = 2; a >> out }`,
			expected: 'Identifier not defined',
		});
		compileError({
			src: `main { missing(1) >> out }`,
			expected: 'Identifier not defined',
		});
		testBlock({
			p: '`#test` may call the definition it precedes.',
			src: `#test { equal(dbl(2), 4); equal(dbl(3), 7) }
export dbl = (n: Int32): Int32 { n * 2 };`,
			out: ['6 != 7'],
		});
	});

	h('Data block layout', ({ rule }) => {
		rule({
			p: 'Data blocks use headerless, per-field layout. Field offsets and arity are compile-time facts; each field retains its full aligned representation, and union fields carry a compiler-owned discriminant separate from their payload.',
			src: `type Point = [ x: Int32, y: Float64 ];
mk = (): Point { [ x = 7, y = 3.5 ] };
main {
	p = mk();
	p.x >> out;
	p.y >> out;
}`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (def :mk ? (fn typeident (next (data (, (propdef :x ? 7) (propdef :y ? 3.5)))))) (main (def :p ? (call :mk ?)) (>> (. :p :x) :out) (>> (. :p :y) :out)))`,
			out: ['7', '3.5'],
		});
		rule({
			src: `main {
	p = [ 1, 3.14 ];
	p.0 >> out;
	p.1 >> out;
}`,
			ast: `(root (main (def :p ? (data (, 1 3.14))) (>> (. :p 0) :out) (>> (. :p 1) :out)))`,
			out: ['1', '3.14'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n };
main {
	pair = [ d(2), d(0) ];
	pair.0 >> Int32 { $ } | DivByZero { 0 - 9 } >> out;
	pair.1 >> Int32 { $ } | DivByZero { 0 - 9 } >> out;
}`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (main (def :pair ? (data (, (call :d 2) (call :d 0)))) (>> (. :pair 0) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 9)))) :out) (>> (. :pair 1) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 9)))) :out)))`,
			out: ['5', '-9'],
		});
		rule({
			src: `type Named = [ name: String ];
type Wide = Named & [ score: Float64 ];
mk = (): Wide { [ name = 'Ada', score = 9.5 ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Wide (& typeident (data (propdef :score typeident ?)))) (def :mk ? (fn typeident (next (data (, (propdef :name ? 'Ada') (propdef :score ? 9.5)))))) (def :nameOf ? (fn (parameter :n typeident ?) typeident (next (. :n :name)))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Named = [ name: String ];
type Tag = [ id: Int32 ];
type Good = Named & Tag;
mk = (): Good { [ name = 'Ada', id = 1 ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Tag (data (propdef :id typeident ?))) (type :Good (& typeident typeident)) (def :mk ? (fn typeident (next (data (, (propdef :name ? 'Ada') (propdef :id ? 1)))))) (def :nameOf ? (fn (parameter :n typeident ?) typeident (next (. :n :name)))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `type Named = [ name: String ];
type Tag = [ id: Int32 ];
type Bad = Tag & Named;
mk = (): Bad { [ id = 1, name = 'Ada' ] };
nameOf = (n: Named): String { n.name };
main {
	nameOf(mk()) >> out
}`,
			ast: `(root (type :Named (data (propdef :name typeident ?))) (type :Tag (data (propdef :id typeident ?))) (type :Bad (& typeident typeident)) (def :mk ? (fn typeident (next (data (, (propdef :id ? 1) (propdef :name ? 'Ada')))))) (def :nameOf ? (fn (parameter :n typeident ?) typeident (next (. :n :name)))) (main (>> (call :nameOf (call :mk ?)) :out)))`,
			out: ['Ada'],
		});
		rule({
			src: `main {
	[ 1, 3.14 ] >> (a: Int32, b: Float64) { b } >> out
}`,
			ast: `(root (main (>> (data (, 1 3.14)) (fn (parameter :a typeident ?) (parameter :b typeident ?) (next :b)) :out)))`,
			out: ['3.14'],
		});
		rule({
			src: `type T = [ flag: Bool, val: Float64, n: Int32 ];
mk = (): T { [ flag = true, val = 2.5, n = 9 ] };
main {
	p = mk();
	p.flag >> out;
	p.val >> out;
	p.n >> out;
}`,
			ast: `(root (type :T (data (, (propdef :flag typeident ?) (propdef :val typeident ?) (propdef :n typeident ?)))) (def :mk ? (fn typeident (next (data (, (propdef :flag ? :true) (propdef :val ? 2.5) (propdef :n ? 9)))))) (main (def :p ? (call :mk ?)) (>> (. :p :flag) :out) (>> (. :p :val) :out) (>> (. :p :n) :out)))`,
			out: ['true', '2.5', '9'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n };
main {
	[ d(2), d(0) ] >> (a: Int32 | DivByZero, b: Int32 | DivByZero) { a } >> Int32 { $ } | DivByZero { 0 - 9 } >> out
}`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (main (>> (data (, (call :d 2) (call :d 0))) (fn (parameter :a typeident ?) (parameter :b typeident ?) (next :a)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next (- 0 9)))) :out)))`,
			out: ['5'],
		});
		rule({
			src: `score = 5;
main {
	[ score, score ] >> (a: Int32, b: Int32) { a + b } >> out
}`,
			ast: `(root (def :score ? 5) (main (>> (data (, :score :score)) (fn (parameter :a typeident ?) (parameter :b typeident ?) (next (+ :a :b))) :out)))`,
			out: ['10'],
		});
		rule({
			src: `type Point = [ x: Int32, y: Int32 ];
type Line = [ from: Point, to: Point ];
mk = (): Line { [ from = [ x = 0, y = 0 ], to = [ x = 3, y = 4 ] ] };
main {
	p = mk();
	p.from.y >> out;
	p.to.x >> out;
}`,
			ast: `(root (type :Point (data (, (propdef :x typeident ?) (propdef :y typeident ?)))) (type :Line (data (, (propdef :from typeident ?) (propdef :to typeident ?)))) (def :mk ? (fn typeident (next (data (, (propdef :from ? (data (, (propdef :x ? 0) (propdef :y ? 0)))) (propdef :to ? (data (, (propdef :x ? 3) (propdef :y ? 4))))))))) (main (def :p ? (call :mk ?)) (>> (. (. :p :from) :y) :out) (>> (. (. :p :to) :x) :out)))`,
			out: ['0', '3'],
		});
		rule({
			src: `main {
	length([ [ 1, 2 ], [ 3, 4 ] ]) >> out
}`,
			ast: `(root (main (>> (call :length @intrinsic (data (, (data (, 1 2)) (data (, 3 4))))) :out)))`,
			out: ['2'],
		});
		rule({
			src: `main {
	b = [ 1, 2 ];
	c = [ 3, 4 ];
	[ b, c ] >> out;
}`,
			ast: `(root (main (def :b ? (data (, 1 2))) (def :c ? (data (, 3 4))) (>> (data (, :b :c)) :out)))`,
			out: ['1', '2', '3', '4'],
		});
	});

	h('Errors', ({ rule, compileError }) => {
		rule({
			p: 'Every error carries a lazy origin trace: `Error = Trace`, one hidden word filled at construction with a static frame pointer — nothing is walked or copied until read. `String(e)`/`out` render it.',
			src: `type NotFound = Error & [ resource: String ];
nf = (r: own String): own NotFound { [ resource = r ] };
main { nf('/etc') >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn (parameter :r typeident ?) typeident (next (data (propdef :resource ? :r))))) (main (>> (call :nf '/etc') :out)))`,
			out: ['NotFound at nf:2'],
		});
		rule({
			p: 'A field-less error’s structure is `[]` — Void — so its default constructor is `Boom()`: the compiler fills the trace, the slot that gives the value existence. An error with fields constructs from its labeled block (`NotFound([ resource = r ])`) or by declared-return coercion.',
			src: `type Boom = Error;
guard = (n: Int32): own Int32 | Boom { n > 0 ? n : Boom() };
main { guard(0) >> Int32 { 'ok' } | Boom { String($) } >> out }`,
			ast: `(root (type :Boom typeident) (def :guard ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call typeident ?))))) (main (>> (call :guard 0) (| (fn (parameter ? typeident ?) (next 'ok')) (fn (parameter ? typeident ?) (next (call typeident $)))) :out)))`,
			out: ['Boom at guard:2'],
		});
		rule({
			p: 'Debug builds maintain a shadow call stack; construction snapshots it, and the trace renders the physical chain innermost-first. Release builds carry only the origin (same handle, `frames(e)` = 1).',
			debug: true,
			src: `type NotFound = Error & [ resource: String ];
nf = (r: own String): own NotFound { [ resource = r ] };
inner = (r: own String): own NotFound { b = nf(r); next b };
outer = (r: own String): own NotFound { b = inner(r); next b };
main { String(outer('/x')) >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn (parameter :r typeident ?) typeident (next (data (propdef :resource ? :r))))) (def :inner ? (fn (parameter :r typeident ?) typeident (def :b ? (call :nf :r)) (next :b))) (def :outer ? (fn (parameter :r typeident ?) typeident (def :b ? (call :inner :r)) (next :b))) (main (>> (call typeident (call :outer '/x')) :out)))`,
			out: ['NotFound at nf:2 <- nf:2 <- inner:3 <- outer:4'],
		});
		rule({
			p: 'A tail call replaces its shadow frame exactly as it replaces the physical one, so TCO chains collapse instead of growing — deep recursion stays flat even in debug builds.',
			debug: true,
			src: `type Boom = Error & [ at: Int32 ];
mk = (n: Int32): own Boom { [ at = n ] };
spin = (n: Int32): own Int32 | Boom { n == 0 ? mk(n) : spin(n - 1) };
main { spin(200000) >> Int32 { 'ok' } | Error { String($) } >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :at typeident ?)))) (def :mk ? (fn (parameter :n typeident ?) typeident (next (data (propdef :at ? :n))))) (def :spin ? (fn (parameter :n typeident ?) typeident (next (? (== :n 0) (call :mk :n) (call :spin (- :n 1)))))) (main (>> (call :spin 200000) (| (fn (parameter ? typeident ?) (next 'ok')) (fn (parameter ? typeident ?) (next (call typeident $)))) :out)))`,
			out: ['Boom at mk:2 <- mk:2 <- spin:3'],
		});
		rule({
			p: '`origin(e)` reads the trace as a `Frame [name, fn, line]`; payload fields are untouched by the hidden slot, and the origin survives upcast to `Error`.',
			src: `type NotFound = Error & [ resource: String ];
nf = (r: own String): own NotFound { [ resource = r ] };
check = (n: Int32): own Int32 | NotFound { n > 0 ? n : nf('/y') };
main {
	e = nf('/x');
	'\${origin(e).fn}:\${origin(e).line} \${e.resource}' >> out;
	check(0) >> Int32 { 'ok' } | Error { String($) } >> out;
}`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn (parameter :r typeident ?) typeident (next (data (propdef :resource ? :r))))) (def :check ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf '/y'))))) (main (def :e ? (call :nf '/x')) (>> (interp (. (call :origin @intrinsic :e) :fn) (. (call :origin @intrinsic :e) :line) (. :e :resource)) :out) (>> (call :check 0) (| (fn (parameter ? typeident ?) (next 'ok')) (fn (parameter ? typeident ?) (next (call typeident $)))) :out)))`,
			out: ['nf:2 /x', 'NotFound at nf:2'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; notFound = (r: own String): own NotFound { [ resource = r ] }; main { notFound('/x') >> Error { 1 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :notFound ? (fn (parameter :r typeident ?) typeident (next (data (propdef :resource ? :r))))) (main (>> (call :notFound '/x') (fn (parameter ? typeident ?) (next 1)) :out)))`,
			out: ['1'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; nf = (): own NotFound { [ resource = 'x' ] }; lookup = (n: Int32): own Int32 | NotFound { n > 0 ? n : nf() }; main { lookup(5) >> Int32 { $ } | NotFound { 0 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn typeident (next (data (propdef :resource ? 'x'))))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 5) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out)))`,
			out: ['5'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; nf = (): own NotFound { [ resource = 'x' ] }; fb = (): own Forbidden { [ resource = 'y' ] }; pick = (n: Int32): own Int32 | NotFound | Forbidden { n > 0 ? nf() : fb() }; main { pick(0 - 1) >> Int32 { 1 } | NotFound { 2 } | Forbidden { 3 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (type :Forbidden (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn typeident (next (data (propdef :resource ? 'x'))))) (def :fb ? (fn typeident (next (data (propdef :resource ? 'y'))))) (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :nf ?) (call :fb ?))))) (main (>> (call :pick (- 0 1)) (| (| (fn (parameter ? typeident ?) (next 1)) (fn (parameter ? typeident ?) (next 2))) (fn (parameter ? typeident ?) (next 3))) :out)))`,
			out: ['3'],
		});
		rule({
			src: `type NotFound = Error & [ resource: String ]; nf = (): own NotFound { [ resource = 'x' ] }; lookup = (n: Int32): own Int32 | NotFound { n > 0 ? n : nf() }; main { lookup(0) >> Int32 { 1 } | Error { 9 } >> out }`,
			ast: `(root (type :NotFound (& typeident (data (propdef :resource typeident ?)))) (def :nf ? (fn typeident (next (data (propdef :resource ? 'x'))))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (call :nf ?))))) (main (>> (call :lookup 0) (| (fn (parameter ? typeident ?) (next 1)) (fn (parameter ? typeident ?) (next 9))) :out)))`,
			out: ['9'],
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; fb = (): Forbidden { [ resource = 'y' ] }; n: NotFound = fb();`,
			expected: 'not assignable',
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; nf = (): own NotFound { [ resource = 'x' ] }; lookup = (n: Int32): own Int32 | NotFound { n > 0 ? n : nf() }; main { lookup(5) >> Int32 { $ } >> out }`,
			expected: 'does not consume',
		});
		compileError({
			src: `type NotFound = Error & [ resource: String ]; type Forbidden = Error & [ resource: String ]; nf = (): own NotFound { [ resource = 'x' ] }; fb = (): own Forbidden { [ resource = 'y' ] }; pick = (n: Int32): own Int32 | NotFound | Forbidden { n > 0 ? nf() : fb() }; main { pick(1) >> Int32 { 1 } | NotFound { 2 } >> out }`,
			expected: 'does not consume "Forbidden"',
		});
		rule({
			p: '`runtime.stack(e)` materializes the whole trace as a collection of `Frame`s — `[count][frame…]`, elements inline — so source-level collection algorithms read it through the Buffer primitives. Outside debug builds it holds the single origin frame.',
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): own Boom { [ id = n ] };
renderFrame = (text: own String, f: Frame): own String { '\${text}\${f.fn}:\${f.line};' };
main { b = mk(5); length(runtime.stack(b)) >> out; reduce(runtime.stack(b), '', renderFrame) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn (parameter :n typeident ?) typeident (next (data (propdef :id ? :n))))) (def :renderFrame ? (fn (parameter :text typeident ?) (parameter :f typeident ?) typeident (next (interp :text (. :f :fn) (. :f :line))))) (main (def :b ? (call :mk 5)) (>> (call :length @intrinsic (call (. :runtime :stack) :b)) :out) (>> (call :reduce (, (call (. :runtime :stack) :b) '' :renderFrame)) :out)))`,
			out: ['1', 'mk:2;'],
		});
		rule({
			p: 'In debug builds the collection carries the captured chain \u2014 the same frames `frameAt` reads, origin first \u2014 and reading it churns flat: the collection is fresh, owned by its consumer, block-freed (its words are static frames).',
			debug: true,
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): own Boom { [ id = n ] };
step = (n: Int32): Int32 { b = mk(n); next reduce(runtime.stack(b), 0, (k: own Int32, f: Frame): own Int32 { k + f.line }) + length(runtime.stack(b)) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn (parameter :n typeident ?) typeident (next (data (propdef :id ? :n))))) (def :step ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mk :n)) (next (+ (call :reduce (, (call (. :runtime :stack) :b) 0 (fn (parameter :k typeident ?) (parameter :f typeident ?) typeident (next (+ :k (. :f :line)))))) (call :length @intrinsic (call (. :runtime :stack) :b)))))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['1499995'],
			maxPages: 3,
		});
		rule({
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): own Boom { [ id = n ] };
step = (n: Int32): Int32 { b = mk(n); next reduce(runtime.stack(b), 0, (k: own Int32, f: Frame): own Int32 { k + f.line }) + length(runtime.stack(b)) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn (parameter :n typeident ?) typeident (next (data (propdef :id ? :n))))) (def :step ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mk :n)) (next (+ (call :reduce (, (call (. :runtime :stack) :b) 0 (fn (parameter :k typeident ?) (parameter :f typeident ?) typeident (next (+ :k (. :f :line)))))) (call :length @intrinsic (call (. :runtime :stack) :b)))))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['300000'],
			maxPages: 3,
		});
		rule({
			debug: true,
			src: `type Boom = Error & [ id: Int32 ];
mk = (n: Int32): own Boom { [ id = n ] };
appendName = (text: own String, f: Frame): own String { '\${text}\${f.fn},' };
main { b = mk(9); s = runtime.stack(b); length(s) >> out; reduce(s, '', appendName) >> out }`,
			ast: `(root (type :Boom (& typeident (data (propdef :id typeident ?)))) (def :mk ? (fn (parameter :n typeident ?) typeident (next (data (propdef :id ? :n))))) (def :appendName ? (fn (parameter :text typeident ?) (parameter :f typeident ?) typeident (next (interp :text (. :f :fn))))) (main (def :b ? (call :mk 9)) (def :s ? (call (. :runtime :stack) :b)) (>> (call :length @intrinsic :s) :out) (>> (call :reduce (, :s '' :appendName)) :out)))`,
			out: ['2', 'mk,mk,'],
		});
	});

	h('Nominal vs structural', ({ rule, compileError }) => {
		rule({
			p: 'Every named type has declaration identity; unnamed literals and parameter lists are structural. A structural value may acquire a named type at a typed boundary, but one named type is not assignable to a different same-shaped named type. Composition with `&` supplies the language’s subtype relationship.',
			src: `type A = [ v: Int32 ]; f = (x: A): Int32 { x.v }; main { f([ v = 5 ]) >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (def :f ? (fn (parameter :x typeident ?) typeident (next (. :x :v)))) (main (>> (call :f (data (propdef :v ? 5))) :out)))`,
			out: ['5'],
		});
		rule({
			src: `type A = [ v: Int32 ]; n: A = [ v = 7 ]; main { n.v >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (def :n typeident (data (propdef :v ? 7))) (main (>> (. :n :v) :out)))`,
			out: ['7'],
		});
		rule({
			src: `type A = [ v: Int32 ]; type B = [ v: Int32 ]; af = (): A { [ v = 1 ] }; bf = (): B { [ v = 2 ] }; pick = (n: Int32): A | B { n > 0 ? af() : bf() }; main { pick(0 - 1) >> A { 10 } | B { 20 } >> out }`,
			ast: `(root (type :A (data (propdef :v typeident ?))) (type :B (data (propdef :v typeident ?))) (def :af ? (fn typeident (next (data (propdef :v ? 1))))) (def :bf ? (fn typeident (next (data (propdef :v ? 2))))) (def :pick ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) (call :af ?) (call :bf ?))))) (main (>> (call :pick (- 0 1)) (| (fn (parameter ? typeident ?) (next 10)) (fn (parameter ? typeident ?) (next 20))) :out)))`,
			out: ['20'],
		});
		compileError({
			src: `type A = [ v: Int32 ]; type B = [ v: Int32 ]; bf = (): B { [ v = 1 ] }; n: A = bf();`,
			expected: 'not assignable',
		});
	});

	h('Grouping', ({ rule }) => {
		rule({
			src: `main { ((2 + 3) * 4) >> out }`,
			ast: `(root (main (>> (* (+ 2 3) 4) :out)))`,
			out: ['20'],
		});
		rule({
			src: `main { ((1 + 2) * (3 + 4)) >> out }`,
			ast: `(root (main (>> (* (+ 1 2) (+ 3 4)) :out)))`,
			out: ['21'],
		});
	});

	h('String-literal types', ({ rule, compileError }) => {
		rule({
			src: `type Mode = 'on'; m: Mode = 'on'; main { m >> out }`,
			ast: `(root (type :Mode typeident) (def :m typeident 'on') (main (>> :m :out)))`,
			out: ['on'],
		});
		rule({
			src: `type Toggle = 'on' | 'off'; t: Toggle = 'off'; main { t >> out }`,
			ast: `(root (type :Toggle typeident) (def :t typeident 'off') (main (>> :t :out)))`,
			out: ['off'],
		});
		compileError({
			src: `type Mode = 'on'; m: Mode = 'off';`,
			expected: 'not assignable',
		});
	});

	h('External declarations', ({ rule }) => {
		rule({
			src: `external host_log: (n: Int32); main { host_log(5) }`,
			ast: `(root (external @external :host_log (fn (parameter :n typeident ?))) (main (call :host_log @external 5)))`,
		});
	});

	h('Operator & condition typing', ({ rule, compileError }) => {
		compileError({
			src: `f = (n: Int32): Int32 { n ? 1 : 2 }; main { f(5) >> out }`,
			expected: 'condition must be',
		});
		compileError({
			src: `main { (1 == 1 == 1) >> out }`,
			expected: 'cannot compare',
		});
		rule({
			src: `main { (5 & 3) >> out }`,
			ast: `(root (main (>> (& 5 3) :out)))`,
			out: ['1'],
		});
		compileError({
			src: `main { (2.5 & 1) >> out }`,
			expected: 'requires integer',
		});
		rule({
			src: `main { (5 | 2) >> out }`,
			ast: `(root (main (>> (| 5 2) :out)))`,
			out: ['7'],
		});
		compileError({
			src: `main { (2.5 | 1) >> out }`,
			expected: 'requires integer',
		});
		rule({
			src: `main { ('ab' == 'ab') >> out }`,
			ast: `(root (main (>> (== 'ab' 'ab') :out)))`,
			out: ['true'],
		});
		compileError({
			src: `main { ('a' + 'b') >> out }`,
			expected: 'cannot be applied',
		});
		compileError({
			src: `main { [] >> out }`,
			expected: 'not a value',
		});
		compileError({
			src: `main { 1 >> out } main { 2 >> out }`,
			expected: 'multiple `main`',
		});
		compileError({
			p: 'A program requires a `main` block; test-mode compiles are exempt (`#test` blocks are the entry).',
			src: `export f = (n: Int32): Int32 { n };`,
			expected: 'a program requires a `main` block',
		});
		compileError({
			p: 'All bitwise operators require integer operands — `|` included, even though it doubles as the dispatch operator.',
			src: `main { 1 == 2 | 4 >> out }`,
			expected: 'requires integer operands',
		});
		compileError({
			p: 'A bare value in `main` is not consumed — the same rule as everywhere else.',
			src: `main { 3 }`,
			expected: 'value is not consumed',
		});
		compileError({
			p: 'A multi-statement stage body must end in `next`, an assignment, or a Void expression — a dangling value has nowhere to go.',
			src: `main { a = 1; 5 >> Int32 { a = 2; a + $ } >> out }`,
			expected: 'value is not consumed',
		});
		compileError({
			src: `main { 0X1F >> out }`,
			expected: 'Expected digit',
		});
	});

	h('Argument binding (positional / named / spread)', ({ rule, compileError }) => {
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(1, 2) >> out }`,
			ast: `(root (def :sub ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :sub (, 1 2)) :out)))`,
			out: ['-1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(b = 1, a = 2) >> out }`,
			ast: `(root (def :sub ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :sub (, (propdef :b ? 1) (propdef :a ? 2))) :out)))`,
			out: ['1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { [1, 2] >> sub >> out }`,
			ast: `(root (def :sub ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, 1 2)) :sub :out)))`,
			out: ['-1'],
		});
		rule({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { [ b = 2, a = 1 ] >> sub >> out }`,
			ast: `(root (def :sub ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :sub :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { a - b }; main { subG(1, 2) >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :subG (, 1 2)) :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { a - b }; main { subG(b = 1, a = 2) >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (call :subG (, (propdef :b ? 1) (propdef :a ? 2))) :out)))`,
			out: ['1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { a - b }; main { [1, 2] >> subG >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, 1 2)) :subG :out)))`,
			out: ['-1'],
		});
		rule({
			src: `subG = (a: Int32, b: Int32): Int32 { a - b }; main { [ b = 2, a = 1 ] >> subG >> out }`,
			ast: `(root (def :subG ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (- :a :b)))) (main (>> (data (, (propdef :b ? 2) (propdef :a ? 1))) :subG :out)))`,
			out: ['-1'],
		});
		compileError({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(1, b = 2) >> out }`,
			expected: 'cannot mix positional and named',
		});
		compileError({
			src: `sub = (a: Int32, b: Int32): Int32 { a - b }; main { sub(a = 1) >> out }`,
			expected: 'missing argument',
		});
	});

	h('Arithmetic safety', ({ expr, rule, compileError }) => {
		expr({
			pre: `half = (n: Int32): Int32 { n / 2 }`,
			src: `half(10)`,
			ast: `(call :half 10)`,
			out: ['5'],
		});
		compileError({
			src: `main { 10 / 0 >> out }`,
			expected: 'zero',
		});
		compileError({
			src: `bad = (n: Int32): Int32 { 10 / n }; main { bad(2) >> out }`,
			expected: 'not assignable',
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; main { d(2) >> Int32 { $ } | DivByZero { 0 } >> out; d(0) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (main (>> (call :d 2) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out) (>> (call :d 0) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `d = (n: Int32): Int32 | DivByZero { 10 / n }; main { x = d(2); y = d(0); x >> Int32 { $ } | DivByZero { 0 } >> out; y >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :d ? (fn (parameter :n typeident ?) typeident (next (/ 10 :n)))) (main (def :x ? (call :d 2)) (def :y ? (call :d 0)) (>> :x (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out) (>> :y (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out)))`,
			out: ['5', '0'],
		});
		rule({
			src: `recip = (n: Int32): Int32 { 10 / n >> Int32 { $ } | DivByZero { 0 } }; main { recip(5) >> out; recip(0) >> out; }`,
			ast: `(root (def :recip ? (fn (parameter :n typeident ?) typeident (next (>> (/ 10 :n) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))))))) (main (>> (call :recip 5) :out) (>> (call :recip 0) :out)))`,
			out: ['2', '0'],
		});
		expr({
			pre: `fdiv = (a: Float64, b: Float64): Float64 { a / b }`,
			src: `fdiv(7.5, 2.5)`,
			ast: `(call :fdiv (, 7.5 2.5))`,
			out: ['3'],
		});
		compileError({
			src: `f = (n: Int32): Int32 { n + 1; next 2; }; main { f(3) >> out }`,
			expected: 'not consumed',
		});
		expr({
			pre: `mod10 = (n: Int32): Int32 { n % 10 }`,
			src: `mod10(43)`,
			ast: `(call :mod10 43)`,
			out: ['3'],
		});
		compileError({
			src: `main { 10 % 0 >> out }`,
			expected: 'zero',
		});
		compileError({
			src: `main { 7.5 % 2.5 >> out }`,
			expected: 'integer operands',
		});
		rule({
			src: `m = (n: Int32): Int32 | DivByZero { 10 % n }; main { m(3) >> Int32 { $ } | DivByZero { 99 } >> out; m(0) >> Int32 { $ } | DivByZero { 99 } >> out; }`,
			ast: `(root (def :m ? (fn (parameter :n typeident ?) typeident (next (% 10 :n)))) (main (>> (call :m 3) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 99))) :out) (>> (call :m 0) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 99))) :out)))`,
			out: ['1', '99'],
		});
		rule({
			src: `nm = (a: Int32, b: Int32): Int32 | DivByZero { a % b }; main { nm(0 - 7, 3) >> Int32 { $ } | DivByZero { 0 } >> out; nm(7, 0 - 3) >> Int32 { $ } | DivByZero { 0 } >> out; }`,
			ast: `(root (def :nm ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (% :a :b)))) (main (>> (call :nm (, (- 0 7) 3)) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out) (>> (call :nm (, 7 (- 0 3))) (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))) :out)))`,
			out: ['-1', '1'],
		});
	});

	h('Function types', ({ p }) => {
		p(
			`Function types are written as function-value signatures *without a body*. The presence of \`{ ... }\` is what distinguishes a function value from a function type. Parameter names in type position are optional — they're documentary; structural equivalence ignores them. Bare \`Fn\` remains the shorthand for "any function" when the signature is not relevant.`,
			({ expr, ast, compileError }) => {
				ast({
					src: `type BinOp = (Int32, Int32): Int32`,
					ast: `(type :BinOp (fn (parameter ? typeident ?) (parameter ? typeident ?) typeident))`,
				});
				ast({
					src: `type T1 = (Int32): Int32; type T2 = (a: Int32): Int32;`,
					ast: `(type :T1 (fn (parameter ? typeident ?) typeident)) (type :T2 (fn (parameter :a typeident ?) typeident))`,
				});
				ast({
					src: `type Pair = { Int32, Bool }`,
					ast: `(type :Pair typeident)`,
				});
				expr({
					pre: `add = (a: Int32, b: Int32): Int32 { a + b }; helper = (cb: (Int32, Int32): Int32): Int32 { cb(5, 10) }`,
					src: `helper(add)`,
					ast: `(call :helper :add)`,
					out: ['15'],
				});
				expr({
					pre: `type Pair<T> = { T, T }; twice = (n: Int32): Pair<Int32> { next n; next n + 1 }; apply = (cb: (Int32): Pair<Int32>, n: Int32): Pair<Int32> { cb(n) }`,
					src: `apply(twice, 5)`,
					ast: `(call :apply (, :twice 5))`,
					out: ['5', '6'],
				});
				compileError({
					pre: `once = (n: Int32): Int32 { n }; apply = (cb: (Int32): Void | Int32, n: Int32): Void | Int32 { cb(n) }`,
					src: `main { apply(once, 5) >> out }`,
					expected: 'one fixed emission layout',
				});
				compileError({
					src: `type Bad = { Int32, Bool } | Int32`,
					expected: 'Emission sequences cannot be unioned',
				});
				compileError({
					pre: `type Pair = { Int32, Int32 }; once = (n: Int32): Int32 { n }; apply = (cb: (Int32): Pair, n: Int32): Pair { cb(n) }`,
					src: `main { apply(once, 5) >> out }`,
					expected: 'not assignable',
				});
				compileError({
					pre: `makeAdder = (x: Int32): ((Int32): Int32) { (y: Int32): Int32 { x + y } }`,
					src: `main { makeAdder(7)(10) >> out }`,
					expected: 'capture',
				});
				expr({
					pre: `constFn = (): ((Int32): Int32) { (y: Int32): Int32 { y + 1 } }`,
					src: `constFn()(10)`,
					ast: `(call (call :constFn ?) 10)`,
					out: ['11'],
				});
				ast({
					src: `type Handler = [name: String, fn: (Int32): Int32]`,
					ast: `(type :Handler (data (, (propdef :name typeident ?) (propdef :fn (fn (parameter ? typeident ?) typeident) ?))))`,
				});
				compileError({
					pre: `type Adder = (Int32): Int32`,
					src: `main { Adder(5) >> out }`,
					expected: 'not callable',
				});
				compileError({
					src: `add = (a: Int32, b: Int32): Int32`,
					expected: 'Expected "{"',
				});
				compileError({
					src: `external pair: (Int32): { Int32, Int32 }; main { pair(1) >> out }`,
					expected: 'host ABI cannot emit multiple values',
				});
				compileError({
					src: `external maybe: (Int32): Void | Int32; main { maybe(1) >> out }`,
					expected: 'one fixed emission layout',
				});
			},
		);
	});

	h('Rest emission types', ({ p }) => {
		p(
			'`{ ...T }` accepts any number of emissions of `T`; fixed elements may precede the rest element, which must be last. A fixed emission sequence is assignable to a compatible rest sequence, but an open rest sequence is not assignable to a fixed sequence.',
			({ ast, compileError, rule }) => {
				ast({
					src: `type Many<T> = { ...T }; type Stream = { Int32, ...String }; type Owned = { ...own String }`,
					ast: `(type :Many (, (parameter :T ? ?)) typeident) (type :Stream typeident) (type :Owned typeident)`,
					test(root) {
						const owned = root.children[2];
						s.equal(owned?.kind, 'type');
						if (owned?.kind !== 'type' || owned.symbol.kind !== 'type') return;
						const type = owned.symbol.type;
						s.equal(type.kind === 'type' && type.family === 'emission', true);
						if (type.kind === 'type' && type.family === 'emission')
							s.equal(type.restOwnership, 'own');
					},
				});
				ast({
					src: `type Producer = (): { Int32, ...String }`,
					ast: `(type :Producer (fn typeident typeident))`,
				});
				rule({
					src: `fixed = (): { Int32, Int32 } { next 1; next 2 }; use = <T>(cb: (): { ...T }): { ...T } { cb() }; main { use(fixed) >> Int32 { out($) } }`,
					ast: `(root (def :fixed ? (fn typeident typeident (next 1) (next 2))) (def :use ? (fn (, (parameter :T ? ?)) (parameter :cb (fn typeident) ?) typeident (next (call :cb ?)))) (main (>> (call :use :fixed) (fn (parameter ? typeident ?) (next (call :out $))))))`,
				});
				compileError({
					src: `type Bad = { ...Int32, String }; main {}`,
					expected: 'Rest emission must be the final element',
				});
				compileError({
					src: `type Bad = { ...Int32, ...Int32 }; main {}`,
					expected: 'Rest emission must be the final element',
				});
				compileError({
					src: `type Bad = { ...Void }; main {}`,
					expected: 'Void cannot be a rest emission type',
				});
				compileError({
					src: `type Bad = { ...{ Int32, Bool } }; main {}`,
					expected: 'Nested emission sequences are not allowed',
				});
				compileError({
					src: `type Bad = { ... }; main {}`,
					expected: 'Expected emission type',
				});
				compileError({
					src: `type Many<T> = { ...T }; bad = (): Many<Int32> { next 1; next true }; main { bad() >> Int32 { out($) } }`,
					expected: 'emission 2 has type "Bool", expected "Int32"',
				});
				compileError({
					src: `bad = (): { Int32, ...Bool } { true }; main { bad() >> Bool { out($) } }`,
					expected: 'emission 1 has type "Bool", expected "Int32"',
				});
				compileError({
					src: `rest = (): { ...Int32 } { next 1; next 2 }; fixedUse = (cb: (): { Int32, Int32 }): { Int32, Int32 } { cb() }; main { fixedUse(rest) >> out }`,
					expected: 'not assignable',
				});
				compileError({
					src: `external many: (): { ...Int32 }; main {}`,
					expected: 'host ABI cannot emit multiple values',
				});
			},
		);
	});

	h('Generics', ({ h }) => {
		h('Generic type aliases', ({ ast, rule }) => {
			ast({
				src: `type Result<T> = T | Error`,
				ast: `(type :Result (, (parameter :T ? ?)) typeident)`,
			});
			rule({
				src: `type Pair<T, U> = [T, U]; p: Pair<Int32, String> = [42, 'hi']; main { p.0 >> out }`,
				ast: `(root (type :Pair (, (parameter :T ? ?) (parameter :U ? ?)) (data (, (propdef ? typeident ?) (propdef ? typeident ?)))) (def :p typeident (data (, 42 'hi'))) (main (>> (. :p 0) :out)))`,
				out: ['42'],
			});
		});

		h('Generic value functions', ({ rule, expr }) => {
			expr({
				pre: `dup = <T>(x: T): { T, T } { next x; next x }`,
				src: `dup(9)`,
				ast: `(call :dup 9)`,
				out: ['9', '9'],
			});
			rule({
				src: `identity = <T>(x: T): T { x }; main { identity(42) >> out; identity(7) >> out; }`,
				ast: `(root (def :identity ? (fn (, (parameter :T ? ?)) (parameter :x typeident ?) typeident (next :x))) (main (>> (call :identity 42) :out) (>> (call :identity 7) :out)))`,
				out: ['42', '7'],
			});
			rule({
				src: `pick = <T, U>(a: T, b: U): T { a }; main { pick(5, 9) >> out }`,
				ast: `(root (def :pick ? (fn (, (parameter :T ? ?) (parameter :U ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident (next :a))) (main (>> (call :pick (, 5 9)) :out)))`,
				out: ['5'],
			});
			rule({
				src: `first = <T>(a: T, b: T): T { a }; main { first(10, 20) >> out }`,
				ast: `(root (def :first ? (fn (, (parameter :T ? ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident (next :a))) (main (>> (call :first (, 10 20)) :out)))`,
				out: ['10'],
			});
			expr({
				pre: `dfold = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : dfold(r, f(acc, h), f) } }; add = (a: Int32, b: Int32): Int32 { a + b }`,
				src: `dfold([1, 2, 3], 0, add)`,
				ast: `(call :dfold (, (data (, 1 2 3)) 0 :add))`,
				out: ['6'],
			});
			// A higher-order arg may also be an inline function literal, not just a
			// named fn: it is lifted to a real function and bound to the param.
			expr({
				pre: `dfold = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : dfold(r, f(acc, h), f) } }`,
				src: `dfold([1, 2, 3], 0, (a: Int32, b: Int32): Int32 { a + b })`,
				ast: `(call :dfold (, (data (, 1 2 3)) 0 (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))))`,
				out: ['6'],
			});
			// A recursive generic monomorphized over a non-Int32 element (Float64):
			// each spec's param must take its concrete arg's wasm type (f64), not
			// the Int32 default left by the in-place type-param placeholder.
			expr({
				pre: `dfold = <T, A>(t: T, acc: A, f: (A, A): A): A { t >> (h, r) { length(r) == 0 ? f(acc, h) : dfold(r, f(acc, h), f) } }; addF = (a: Float64, b: Float64): Float64 { a + b }`,
				src: `dfold([1.5, 2.5, 3.5], 0.5, addF)`,
				ast: `(call :dfold (, (data (, 1.5 2.5 3.5)) 0.5 :addF))`,
				out: ['8'],
			});
			rule({
				p: 'A generic may recurse on a value with a fixed type — it monomorphizes once and self-calls, terminating at runtime like any recursion (termination is not proven, mirroring non-generic recursion). Type-reducing recursion (`dfold` above) still unrolls per level.',
				src: `rep = <T>(x: T, n: Int32): String { n <= 0 ? '' : '\${x}\${rep(x, n - 1)}' };
main { rep('ab', 3) >> out }`,
				ast: `(root (def :rep ? (fn (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (next (? (<= :n 0) '' (interp :x (call :rep (, :x (- :n 1)))))))) (main (>> (call :rep (, 'ab' 3)) :out)))`,
				out: ['ababab'],
			});
			rule({
				src: `rep = <T>(x: T, n: Int32): String { n <= 0 ? '' : '\${x}\${rep(x, n - 1)}' };
main { rep(7, 4) >> out }`,
				ast: `(root (def :rep ? (fn (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (next (? (<= :n 0) '' (interp :x (call :rep (, :x (- :n 1)))))))) (main (>> (call :rep (, 7 4)) :out)))`,
				out: ['7777'],
			});
			rule({
				src: `countDown = <T>(x: T, n: Int32): Int32 { n <= 0 ? 0 : 1 + countDown(x, n - 1) };
main { countDown('z', 5) >> out }`,
				ast: `(root (def :countDown ? (fn (, (parameter :T ? ?)) (parameter :x typeident ?) (parameter :n typeident ?) typeident (next (? (<= :n 0) 0 (+ 1 (call :countDown (, :x (- :n 1)))))))) (main (>> (call :countDown (, 'z' 5)) :out)))`,
				out: ['5'],
			});
			rule({
				p: 'A generic may wrap another generic and return its result: `join<T>` delegates to `fold`, whose type-param return resolves through the wrapper — piped or bound.',
				src: `cat = (a: String, b: String): String { '\${a}\${b}' };
join = <T>(t: T): String { fold(t, '', cat) };
main { join([ 'a', 'b', 'c' ]) >> out }`,
				ast: `(root (def :cat ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (interp :a :b)))) (def :join ? (fn (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (next (call :fold (, :t '' :cat))))) (main (>> (call :join (data (, 'a' 'b' 'c'))) :out)))`,
				out: ['abc'],
			});
			rule({
				src: `add = (a: Int32, b: Int32): Int32 { a + b };
sum = <T>(t: T): Int32 { fold(t, 0, add) };
main { sum([ 1, 2, 3, 4 ]) >> out }`,
				ast: `(root (def :add ? (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))) (def :sum ? (fn (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (next (call :fold (, :t 0 :add))))) (main (>> (call :sum (data (, 1 2 3 4))) :out)))`,
				out: ['10'],
			});
			rule({
				src: `join = <T>(t: T): String { fold(t, '', (a: String, b: String): String { '\${a}\${b}' }) };
main { join([ 'x', 'y', 'z' ]) >> out }`,
				ast: `(root (def :join ? (fn (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (next (call :fold (, :t '' (fn (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (interp :a :b)))))))) (main (>> (call :join (data (, 'x' 'y' 'z'))) :out)))`,
				out: ['xyz'],
			});
			rule({
				p: 'A multi-emit generic composes with another: `triple` re-emits `double`\\u2019s stream then one more, so `triple(3)` yields three values.',
				src: `double = <T>(f: T) { f, f };
triple = <T>(f: T) { double(f), f };
main { triple(3) >> out }`,
				ast: `(root (def :double ? (fn (, (parameter :T ? ?)) (parameter :f typeident ?) (next (, :f :f)))) (def :triple ? (fn (, (parameter :T ? ?)) (parameter :f typeident ?) (next (, (call :double :f) :f)))) (main (>> (call :triple 3) :out)))`,
				out: ['3', '3', '3'],
			});
		});

		h('Type-level chain in RHS', ({ ast }) => {
			ast({
				src: `type First<T> = T >> [H, R] { H }`,
				ast: `(type :First (, (parameter :T ? ?)) (>> typeident (fn (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (next typeident))))`,
			});
		});

		h('Type-level chain reduction', ({ rule }) => {
			rule({
				src: `type First<T> = T >> [H, R] { H }; v: First<[Int32, String]> = 42; main { v >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (next typeident)))) (def :v typeident 42) (main (>> :v :out)))`,
				out: ['42'],
			});
			rule({
				src: `type Each<T> = T >> [H, R] { H | Each<R> }; w: Each<[Int32, Bool]> = 7; main { w >> out }`,
				ast: `(root (type :Each (, (parameter :T ? ?)) (>> typeident (fn (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (next typeident)))) (def :w typeident 7) (main (>> :w :out)))`,
				out: ['7'],
			});
			rule({
				src: `type First<T> = T >> [H, R] { H }; firstOf = <T>(t: T): First<T> { t.0 }; main { firstOf([42, 99]) >> out }`,
				ast: `(root (type :First (, (parameter :T ? ?)) (>> typeident (fn (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (next typeident)))) (def :firstOf ? (fn (, (parameter :T ? ?)) (parameter :t typeident ?) typeident (next (. :t 0)))) (main (>> (call :firstOf (data (, 42 99))) :out)))`,
				out: ['42'],
			});
		});

		h('Recursive type definitions with implicit Void termination', ({ ast }) => {
			ast({
				src: `type Reverse<T> = T >> [H, R] { [Reverse<R>, H] }`,
				ast: `(type :Reverse (, (parameter :T ? ?)) (>> typeident (fn (parameter ? (data (, (parameter :H ? ?) (parameter :R ? ?))) ?) (next (data (, (propdef ? typeident ?) (propdef ? typeident ?)))))))`,
			});
		});

		h('Constraints via unions', ({ rule, compileError }) => {
			rule({
				src: `add = <T: Int32 | Int64>(a: T, b: T): T { a + b }; main { add(3, 4) >> out }`,
				ast: `(root (def :add ? (fn (, (parameter :T typeident ?)) (parameter :a typeident ?) (parameter :b typeident ?) typeident (next (+ :a :b)))) (main (>> (call :add (, 3 4)) :out)))`,
				out: ['7'],
			});
			compileError({
				pre: `numeric = <T: Int32 | Float64>(x: T): T { x }`,
				src: `main { numeric('hi') >> out }`,
				expected: 'does not satisfy constraint',
			});
		});

		h('Compile errors', ({ compileError }) => {
			compileError({
				pre: `type Box<T> = [T, T]`,
				src: `b: Box<Int32, String> = [1, 2]`,
				expected: 'type argument',
			});
			compileError({
				pre: `type Pair<T, U> = [T, U]`,
				src: `p: Pair<Int32> = [42]`,
				expected: 'type argument',
			});
		});
	});

	h('Built-in identifiers', ({ h }) => {
		h('length', ({ expr }) => {
			expr({
				p: '`length` is total and is the canonical basis for emptiness tests: it returns zero for `void`, one for a scalar, the member count for data, and the byte count for `String`.',
				src: `length('hello')`,
				ast: `(call :length @intrinsic 'hello')`,
				out: ['5'],
			});
			expr({
				src: `length([1, 2, 3])`,
				ast: `(call :length @intrinsic (data (, 1 2 3)))`,
				out: ['3'],
			});
			expr({
				src: `length(5)`,
				ast: `(call :length @intrinsic 5)`,
				out: ['1'],
			});
			expr({
				src: `length([3])`,
				ast: `(call :length @intrinsic (data 3))`,
				out: ['1'],
			});
			expr({
				src: `length([ 'hi' ])`,
				ast: `(call :length @intrinsic (data 'hi'))`,
				out: ['2'],
			});
			expr({
				src: `length(void)`,
				ast: `(call :length @intrinsic :void)`,
				out: ['0'],
			});
		});
	});

	h('Modules', ({ p, modules }) => {
		p(
			`A module is a single source file; \`export\` marks its public surface. The standard library is a global prelude — its symbols (\`out\`, \`each\`, …) are in scope unqualified. \`@.seg.seg\` names a local module relative to the importing file; \`@name\` names a library through the entry's \`#importmap\`. \`(a, b) = @…\` binds exports by name (two or more names); \`m = @…\` binds the whole module as a namespace. A library never sees the program's map — its own \`#importmap\` starts a fresh unit, so published libraries carry no dependencies.`,
			({ ast }) => {
				ast({
					src: `export helper = (x: Int32) { x * 2 }`,
					ast: `(def @export :helper ? (fn (parameter :x typeident ?) (next (* :x 2))))`,
				});
			},
		);
		modules({
			p: 'Local modules, by-name destructuring, and namespace binds.',
			files: {
				'/util.gb': `export double = (n: Int32): Int32 { n * 2 };
export triple = (n: Int32): Int32 { n * 3 };`,
				'/geo.gb': `export area = (w: Int32, h: Int32): Int32 { w * h };`,
				'/main.gb': `(double, triple) = @.util;
geo = @.geo;
main { double(21) >> out; triple(7) >> out; 6 -> geo.area(7) >> out }`,
			},
			entry: '/main.gb',
			out: ['42', '21', '42'],
		});
		modules({
			p: 'Imported functions preserve exact finite emission signatures.',
			files: {
				'/pair.gb': `export pair = (n: Int32): { Int32, Bool } { next n; next true }; export id = (n: Int32): Int32 { n };`,
				'/main.gb': `pairModule = @.pair; main { pairModule.pair(4) >> out }`,
			},
			entry: '/main.gb',
			out: ['4', 'true'],
		});
		modules({
			p: 'Bundled functions preserve exact finite emission signatures.',
			bundles: {
				'/vendor/pair.gbm': {
					entry: '/dev/pair/lib.gb',
					files: {
						'/dev/pair/lib.gb': `export pair = (n: Int32): { Int32, Int32 } { next n; next n + 1 }; export id = (n: Int32): Int32 { n };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap { @pair = './vendor/pair.gbm'; }
(pair, id) = @pair;
main { pair(4) >> out }`,
			},
			entry: '/main.gb',
			out: ['4', '5'],
		});
		modules({
			p: 'A library resolves through the entry\u2019s `#importmap`, uses its own local modules, and its `main`-free exports fuse into the one program wasm.',
			files: {
				'/vendor/math/lib.gb': `(sq, cb) = @.impl;
export square = (n: Int32): Int32 { sq(n) };
export cube = (n: Int32): Int32 { cb(n) };`,
				'/vendor/math/impl.gb': `export sq = (n: Int32): Int32 { n * n };
export cb = (n: Int32): Int32 { n * n * n };`,
				'/main.gb': `#importmap { @math = './vendor/math/lib.gb'; }
(square, cube) = @math;
main { square(6) >> out; cube(3) >> out }`,
			},
			entry: '/main.gb',
			out: ['36', '27'],
		});
		modules({
			p: 'A `.gbm` bundle seals a library\u2019s closure — elaborated, post-check ASTs plus per-module hashes; the map accepts it interchangeably with a directory, and consumers assemble it without re-parsing or re-checking. Two bundles embedding an identical module dedupe by closure hash at assembly.',
			bundles: {
				'/vendor/a.gbm': {
					entry: '/dev/a/lib.gb',
					files: {
						'/dev/a/lib.gb': `(base, basex) = @.shared;
export ten = (n: Int32): Int32 { base(n) };`,
						'/dev/a/shared.gb': `export base = (n: Int32): Int32 { n * 10 };
export basex = (n: Int32): Int32 { n };`,
					},
				},
				'/vendor/b.gbm': {
					entry: '/dev/b/lib.gb',
					files: {
						'/dev/b/lib.gb': `(base, basex) = @.shared;
export eleven = (n: Int32): Int32 { base(n) + n };`,
						'/dev/b/shared.gb': `export base = (n: Int32): Int32 { n * 10 };
export basex = (n: Int32): Int32 { n };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap {
	@a = './vendor/a.gbm';
	@b = './vendor/b.gbm';
}
a = @a;
b = @b;
main { a.ten(4) >> out; b.eleven(4) >> out }`,
			},
			entry: '/main.gb',
			out: ['40', '44'],
		});
		modules({
			p: 'Bundled signatures preserve specialized Buffer element types.',
			bundles: {
				'/vendor/buffer.gbm': {
					entry: '/dev/buffer.gb',
					files: {
						'/dev/buffer.gb': `export first = (b: Buffer<Int32>): Int32 { get(b, 0) };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap { @buffer = './vendor/buffer.gbm'; }
(first) = @buffer;
main { b = Buffer<Int32>(1); set(b, 0, 7); first(b) >> out }`,
			},
			entry: '/main.gb',
			out: ['7'],
		});
		modules({
			p: 'A destructure pattern binds exported values and exported types by the same name rule — the program writes signatures against a library\u2019s nominal types.',
			files: {
				'/items.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };`,
				'/main.gb': `(Item, mk) = @.items;
report = (i: Item): Int32 { i.id };
main { report(mk(7)) >> out }`,
			},
			entry: '/main.gb',
			out: ['7'],
		});
		modules({
			p: 'Closure-hash dedup unifies identical vendored modules across bundles: a value produced against one copy\u2019s nominal type is accepted by the other\u2019s typed consumer, because both copies became one module.',
			bundles: {
				'/vendor/a.gbm': {
					entry: '/dev/a/lib.gb',
					files: {
						'/dev/a/lib.gb': `(Item, mk) = @.shared;
export produce = (n: Int32): Item { mk(n) };
export producex = (n: Int32): Int32 { n };`,
						'/dev/a/shared.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };
export idOf = (i: Item): Int32 { i.id };`,
					},
				},
				'/vendor/b.gbm': {
					entry: '/dev/b/lib.gb',
					files: {
						'/dev/b/lib.gb': `(Item, idOf) = @.shared;
export consume = (i: Item): Int32 { idOf(i) + 100 };
export consumex = (n: Int32): Int32 { n };`,
						'/dev/b/shared.gb': `export type Item = Error & [ id: Int32 ];
export mk = (n: Int32): Item { [ id = n ] };
export idOf = (i: Item): Int32 { i.id };`,
					},
				},
			},
			files: {
				'/main.gb': `#importmap { @liba = './vendor/a.gbm'; @libb = './vendor/b.gbm'; }
(produce, producex) = @liba;
(consume, consumex) = @libb;
main { consume(produce(7)) >> out }`,
			},
			entry: '/main.gb',
			out: ['107'],
		});
		modules({
			p: 'An error constructed in a module carries its file in the origin frame; single-file programs omit it.',
			files: {
				'/items.gb': `export type Missing = Error & [ what: String ];
export find = (n: Int32): Int32 | Missing { n > 0 ? n : [ what = 'thing' ] };`,
				'/main.gb': `(Missing, find) = @.items;
main { find(0) >> Int32 { 'ok' } | Error { String($) } >> out }`,
			},
			entry: '/main.gb',
			out: ['Missing at find:2 (items.gb)'],
		});
		modules({
			p: 'Import cycles are an error.',
			files: {
				'/a.gb': `(b1, bx) = @.b; export a1 = (n: Int32): Int32 { n };
export ax = (n: Int32): Int32 { n };`,
				'/b.gb': `(a1, ax) = @.a; export b1 = (n: Int32): Int32 { n };
export bx = (n: Int32): Int32 { n };`,
				'/main.gb': `(a1, ax) = @.a;
main { }`,
			},
			entry: '/main.gb',
			errors: 'import cycle',
		});
		modules({
			p: 'A module cannot declare `main` — it belongs to the program entry.',
			files: {
				'/lib.gb': `export f = (n: Int32): Int32 { n }; main { }`,
				'/main.gb': `(f, g) = @.lib;
main { }`,
			},
			entry: '/main.gb',
			errors: 'cannot declare `main`',
		});
		modules({
			p: 'Imported-module diagnostics retain the primary parser error and module location.',
			files: {
				'/lib.gb': `export bad = (value: var): Int32 { value };
export good = (): Int32 { 1 };`,
				'/main.gb': `(good) = @.lib;
main { good() >> out }`,
			},
			entry: '/main.gb',
			errors: 'module "/lib.gb" line 1: Expected type expression',
		});
		modules({
			p: 'An unmapped library name says exactly what to add.',
			files: {
				'/main.gb': `(a, b) = @nope;
main { }`,
			},
			entry: '/main.gb',
			errors: 'not in the import map',
		});
		modules({
			p: 'A single-name destructure `(a) = @…` binds that one export — same rule as `(a, b) = @…`; a module-ref RHS is what distinguishes it from a grouped assignment.',
			files: {
				'/lib.gb': `export foo = (): Int32 { 42 };
export bar = (): Int32 { 7 };`,
				'/main.gb': `(foo) = @.lib;
main { foo() >> out }`,
			},
			entry: '/main.gb',
			out: ['42'],
		});
		modules({
			files: {
				'/lib.gb': `export foo = (): Int32 { 42 };
export bar = (): Int32 { 7 };`,
				'/main.gb': `(bar) = @.lib;
main { bar() >> out }`,
			},
			entry: '/main.gb',
			out: ['7'],
		});
		modules({
			p: 'The single-name form binds an exported type too.',
			files: {
				'/lib.gb': `export type Pt = [ x: Int32 ];
export mk = (n: Int32): Pt { [ x = n ] };`,
				'/main.gb': `(Pt) = @.lib;
(mk) = @.lib;
report = (p: Pt): Int32 { p.x };
main { report(mk(9)) >> out }`,
			},
			entry: '/main.gb',
			out: ['9'],
		});
	});

	h('Statement separators', ({ rule, ast, compileError }) => {
		ast({
			src: `a = 1; b = 2;`,
			ast: '(def :a ? 1) (def :b ? 2)',
		});
		rule({
			src: `helper = (x: Int32) { x + 1 }; main { helper(1) >> out }`,
			ast: '(root (def :helper ? (fn (parameter :x typeident ?) (next (+ :x 1)))) (main (>> (call :helper 1) :out)))',
			out: ['2'],
		});
		compileError({
			src: `count = 1; main { count >> out };`,
			expected: '";" is not allowed after',
		});
		compileError({
			src: `a = 1 b = 2`,
			expected: 'Expected ";"',
		});
		ast({
			src: `a = 1;`,
			ast: '(def :a ? 1)',
		});
		rule({
			p: '`;` separates statements and the trailing `;` is optional — a single statement, or the last statement in a block, may carry one or omit it.',
			src: `main { x = 5; x >> out }`,
			ast: '(root (main (def :x ? 5) (>> :x :out)))',
			out: ['5'],
		});
	});

	h('Statements', ({ h }) => {
		h('loop', ({ rule, compileError }) => {
			rule({
				p: '`loop` is the single infinite emitter and yields `0, 1, 2, …`. `break` stops the nearest pipe chain, while `done` ends the nearest statement-body function.',
				src: `until = (n: Int32) { loop >> { $ >= n ? break : $ } }; main { until(3) >> out }`,
				ast: '(root (def :until ? (fn (parameter :n typeident ?) (next (>> loop (fn (next (? (>= $ :n) break $))))))) (main (>> (call :until 3) :out)))',
				out: ['0', '1', '2'],
			});
			compileError({
				src: `main { 0 >> loop >> (counter: Int32) { counter + 1 } }`,
				expected: '`loop` is valid only as a pipe source; use tail recursion for loop-carried state',
			});
		});

		h('break', ({ compileError }) => {
			compileError({
				src: `main { break }`,
				expected: '`break` outside pipe stage',
			});
			compileError({
				src: `f = (): Int32 { break }; main { f() >> out }`,
				expected: '`break` outside pipe stage',
			});
		});
	});

	h('Test blocks', ({ ast, compileError, rule, testBlock }) => {
		ast({
			src: `#test { 5 == 5 } target = (): Int32 { 5 }`,
			ast: `(test (== 5 5)) (def :target ? (fn typeident (next 5)))`,
		});
		rule({
			src: `#test { ok(true) } export dbl = (n: Int32): Int32 { n * 2 }; main { dbl(5) >> out }`,
			ast: `(root (test (call :ok :true)) (def @export :dbl ? (fn (parameter :n typeident ?) typeident (next (* :n 2)))) (main (>> (call :dbl 5) :out)))`,
			out: ['10'],
		});
		compileError({
			src: `#test { missingHelper(1) } target = (): Int32 { 1 }`,
			expected: 'Identifier not defined',
		});
		compileError({
			src: `#test { missingHelper(1) } target = (): Int32 { 1 }`,
			expected: 'Identifier not defined',
			testMode: true,
		});
		compileError({
			src: `#test { ok(true) } main { }`,
			expected: 'must immediately precede a function definition',
		});
		compileError({
			src: `#test { ok(true) } helper = (n: Int32): Int32 { n + 1 }; main { }`,
			expected: 'declared but never used',
		});
		testBlock({
			src: `#test { ok(5 == 5) } export target = (): Int32 { 5 }`,
			out: [],
		});
		testBlock({
			src: `#test { ok(5 == 6) } export target = (): Int32 { 5 }`,
			out: ['assertion failed'],
		});
		testBlock({
			src: `#test { equal(5, 5); equal(1, 2); equal(3, 3); } export target = (): Int32 { 5 }`,
			out: ['1 != 2'],
		});
		testBlock({
			src: "export hi = (): String { '${Char(72)}${Char(105)}' }; #test { equal(hi(), 'Hi') } export target = (): Int32 { 5 };",
			out: [],
		});
		testBlock({
			src: `#test { actual = target(); equal(actual, 5) } export target = (): Int32 { 5 }`,
			out: [],
		});
	});

	h('Ownership', ({ expr, compileError, rule, p }) => {
		p(
			`Ownership belongs to bindings and crosses function boundaries explicitly. A plain parameter \`x: T\` is shared access, \`x: var T\` is exclusive mutable access for the call, and \`x: own T\` moves the value from caller to callee. A plain heap result \`: T\` is borrowed, while \`: own T\` moves ownership to the caller. Every binding identity is immutable; an owned local can be passed to a \`var T\` parameter without a local annotation, and a local \`var\` annotation never upgrades a shared alias. Mutable capability cannot be returned. Copy values (\`Int32\`, \`Float64\`, \`Bool\`, \`Char\`, and static literals) keep their ordinary copy behavior through every mode, so generic contracts such as \`value: own T\` work for both Copy and heap-owning substitutions.

			 \`next\` preserves its input mode: it copies a Copy value, propagates a shared borrow, or moves an owned value. It never upgrades a borrow into an owner. An \`own T\` result therefore accepts only owned or Copy emissions, and a plain heap \`T\` result accepts only borrowed or static emissions; every branch and emission of that result must agree. When result annotations are omitted, type and ownership mode are inferred locally under the same rules.

			 Borrow provenance is part of the function type, not source syntax: a function that emits a borrowed parameter or an element reached through it records that parameter as an origin. Alternative branches may add multiple origins. The summary is serialized with libraries and propagated at calls, so checking never depends on callee names or whole-program call sites. A derived borrow remains valid only while all of its possible owners remain live. Borrow lifetimes end at last use; a temporary passed to a borrow-returning call is retained by the caller until the last derived borrow dies.

			 Binding an owner creates the owner; binding an existing heap name creates a shared alias with the same provenance. An owner cannot move or drop while a shared alias remains live. Passing one owner to two consuming arguments in the same call is rejected. At a control-flow join a value is unavailable if any continuing branch moved it, and borrow origins are the union of the continuing branches.

			 Records and collections own their heap fields and elements. Embedding an owned value moves it to the container; the old name becomes a shared borrow of that container-owned value and becomes invalid when the container moves. A borrowed value cannot be embedded. Element reads produce Copy values for Copy elements and shared borrows tied to the collection for heap elements. Removing a heap element must transfer ownership by consuming the collection and returning both owners.

			 Contracts compose uniformly through generics and recursion: \`set(a: var Buffer<T>, index: Int32, value: own T)\` mutates without moving the Buffer and returns Void; \`push(a: own Array<T>, value: own T): own Array<T>\` consumes and returns the Array ownership thread; \`get(a: Array<T>, index: Int32): T\` borrows an element; and \`take(a: own Array<T>, index: Int32): own [Array<T>, T]\` returns two owners. Recursive calls obey these declared modes, including tail re-passes, without ownership inference from their call sites.

			 Raw host calls are the unsafe lifetime boundary. Plain exported heap parameters borrow host-held module-memory values, and \`own\` parameters transfer such values so the host must not reuse them. Borrowed results retain their recorded host-input origins. Owned heap results are rejected until the host ABI exposes typed destruction; Copy results cross directly. Inside GB, the checker enforces the same contracts on exported functions as on every other call.`,
			({ rule }) => {
				rule({
					src: `id = (s: String): String { s };
main { t = 'q\${1}'; length(id(t)) + length(t) >> out }`,
					ast: `(root (def :id ? (fn (parameter :s typeident ?) typeident (next :s))) (main (def :t ? (interp 1)) (>> (+ (call :length @intrinsic (call :id :t)) (call :length @intrinsic :t)) :out)))`,
					out: ['4'],
				});
			},
		);
		rule({
			p: 'Drop glue: an owned heap value not moved out is freed at its block’s exit, so repeated allocation runs in constant memory (the free list is reused).',
			src: `step = (t: String): Int32 { s = 'xxxxxxxx\${t}yyyyyyyy'; next length(s) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step('zzzz')) };
main { spin(50000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :t typeident ?) typeident (def :s ? (interp :t)) (next (call :length @intrinsic :s)))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step 'zzzz')))))))) (main (>> (call :spin (, 50000 0)) :out)))`,
			out: ['1000000'],
			maxPages: 3,
		});
		rule({
			p: 'Expression temporaries — unbound results whose freshness is structural (an interp, a conversion, a call whose every return path is fresh-or-static) — are freed at their consumption point, so formatting in a loop runs in constant memory.',
			src: `spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + length('v\${n}')) };
main { spin(50000, 0) >> out }`,
			ast: `(root (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :length @intrinsic (interp :n))))))))) (main (>> (call :spin (, 50000 0)) :out)))`,
			out: ['288894'],
			maxPages: 3,
		});
		rule({
			p: 'A binding of an owned call result becomes its owner and frees it at block exit unless it moves again.',
			src: `mkpad = (n: Int32): own String { s = 'p\${n}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; next s };
probe = (n: Int32): Int32 { b = mkpad(n); next length(b) };
churn = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : churn(n - 1, acc + probe(n)) };
main { churn(50000, 0) >> out }`,
			ast: `(root (def :mkpad ? (fn (parameter :n typeident ?) typeident (def :s ? (interp :n)) (next :s))) (def :probe ? (fn (parameter :n typeident ?) typeident (def :b ? (call :mkpad :n)) (next (call :length @intrinsic :b)))) (def :churn ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :churn (, (- :n 1) (+ :acc (call :probe :n)))))))) (main (>> (call :churn (, 50000 0)) :out)))`,
			out: ['1888894'],
			maxPages: 3,
		});
		rule({
			p: 'Error values, union payloads (branched on the live member\u2019s tag), and record literals are dropped like every owned value — error frees include the trace chain, so debug builds also run flat.',
			debug: true,
			src: `type Miss = Error & [ id: Int32 ];
lookup = (n: Int32): own Int32 | Miss { n > 0 ? n : [ id = n ] };
step = (n: Int32): Int32 { r = lookup(n - 50000); next r >> Int32 { $ } | Miss { 0 } };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (type :Miss (& typeident (data (propdef :id typeident ?)))) (def :lookup ? (fn (parameter :n typeident ?) typeident (next (? (> :n 0) :n (data (propdef :id ? :n)))))) (def :step ? (fn (parameter :n typeident ?) typeident (def :r ? (call :lookup (- :n 50000))) (next (>> :r (| (fn (parameter ? typeident ?) (next $)) (fn (parameter ? typeident ?) (next 0))))))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['1250025000'],
			maxPages: 3,
		});
		compileError({
			p: '`var` grants mutable access to a value but never makes its binding reassignable.',
			src: `main { s: var = 'a\${1}'; s = 'b'; s >> out }`,
			expected: 'Cannot reassign binding',
		});
		rule({
			p: 'Embedding an owned local in a labeled record member moves it — the record owns its members and dropping it frees them too (nested inline records included); the source name stays readable, as a borrow, until the record itself moves.',
			src: `step = (n: Int32): Int32 { m = 'x\${n}'; r = [ msg = m, id = n ]; next length(m) + r.id - n };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :step ? (fn (parameter :n typeident ?) typeident (def :m ? (interp :n)) (def :r ? (data (, (propdef :msg ? :m) (propdef :id ? :n)))) (next (- (+ (call :length @intrinsic :m) (. :r :id)) :n)))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		compileError({
			src: `gen = (n: Int32) { m = 'x\${n}'; r = [ msg = m ]; next r; next [ msg = 'y\${length(m)}' ] };
main { gen(3) >> each >> out }`,
			expected: 'moved with',
		});
		compileError({
			src: `main { m = 'x\${1}'; r = [ a = m, b = m ]; length(r.a) >> out }`,
			expected: 'embedded twice',
		});
		compileError({
			src: `main { a = 'x\${1}'; b = a; r = [ msg = b ]; r.msg >> out }`,
			expected: 'cannot embed borrowed',
		});
		rule({
			p: 'A fresh value passed to a borrowing parameter remains caller-owned and is freed after its last derived borrow. A tail call demotes to a plain call when caller-owned temporaries must be released; self-recursion can retain a loop backedge when ownership is re-passed.',
			src: `use = (s: String): Int32 { length(s) };
step = (n: Int32): Int32 { use('x\${n}') };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :use ? (fn (parameter :s typeident ?) typeident (next (call :length @intrinsic :s)))) (def :step ? (fn (parameter :n typeident ?) typeident (next (call :use (interp :n))))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		rule({
			p: 'A bound borrowed result retains its fresh argument owners until the result’s last use. Emitting a borrow whose recorded owner dies in the current block is rejected.',
			src: `pick = (a: String, b: String, k: Int32): String { k > 0 ? a : b };
step = (n: Int32): Int32 { r = pick('x\${n}', 'y', n); next length(r) };
spin = (n: Int32, acc: Int32): Int32 { n == 0 ? acc : spin(n - 1, acc + step(n)) };
main { spin(100000, 0) >> out }`,
			ast: `(root (def :pick ? (fn (parameter :a typeident ?) (parameter :b typeident ?) (parameter :k typeident ?) typeident (next (? (> :k 0) :a :b)))) (def :step ? (fn (parameter :n typeident ?) typeident (def :r ? (call :pick (, (interp :n) 'y' :n))) (next (call :length @intrinsic :r)))) (def :spin ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :spin (, (- :n 1) (+ :acc (call :step :n)))))))) (main (>> (call :spin (, 100000 0)) :out)))`,
			out: ['588895'],
			maxPages: 3,
		});
		compileError({
			src: `f = (): String { a = 'x\${1}'; b = a; next b };
main { f() >> out }`,
			expected: 'dies with this block',
		});
		rule({
			p: 'An `own` recursive accumulator is an explicit ownership thread: each iteration frees or moves the previous accumulator, and a tail re-pass moves it into the next loop iteration.',
			src: `build = (n: Int32, acc: own String): own String { n == 0 ? acc : build(n - 1, '\${acc}x') };
main { length(build(200000, '')) >> out }`,
			ast: `(root (def :build ? (fn (parameter :n typeident ?) (parameter :acc typeident ?) typeident (next (? (== :n 0) :acc (call :build (, (- :n 1) (interp :acc))))))) (main (>> (call :length @intrinsic (call :build (, 200000 ''))) :out)))`,
			out: ['200000'],
			maxPages: 16,
		});
		rule({
			p: 'Tail recursion frees bound values created by each iteration before transferring control, so recursive loops run flat.',
			src: `spin = (i: Int32, total: Int32): Int32 {
	m = 'x\${i}';
	next i >= 50000 ? total : spin(i + 1, total + length(m) - length(m) + 4)
};
main { spin(0, 0) >> out }`,
			ast: `(root (def :spin ? (fn (parameter :i typeident ?) (parameter :total typeident ?) typeident (def :m ? (interp :i)) (next (? (>= :i 50000) :total (call :spin (, (+ :i 1) (+ (- (+ :total (call :length @intrinsic :m)) (call :length @intrinsic :m)) 4))))))) (main (>> (call :spin (, 0 0)) :out)))`,
			out: ['200000'],
			maxPages: 3,
		});
		rule({
			p: 'An owned value emitted through an `own` result moves to the receiver and is not freed by its creating block.',
			src: `mk = (n: Int32): own String { s = 'm\${n}'; next s };
main { a = mk(1); b = mk(2); a >> out; b >> out; }`,
			ast: `(root (def :mk ? (fn (parameter :n typeident ?) typeident (def :s ? (interp :n)) (next :s))) (main (def :a ? (call :mk 1)) (def :b ? (call :mk 2)) (>> :a :out) (>> :b :out)))`,
			out: ['m1', 'm2'],
		});
		rule({
			p: 'A callee never frees what it borrows — the owner’s value stays valid after the call.',
			src: `peek = (s: String): Int32 { length(s) };
main { t = 'q\${1}'; peek(t) >> out; peek(t) >> out; t >> out; }`,
			ast: `(root (def :peek ? (fn (parameter :s typeident ?) typeident (next (call :length @intrinsic :s)))) (main (def :t ? (interp 1)) (>> (call :peek :t) :out) (>> (call :peek :t) :out) (>> :t :out)))`,
			out: ['2', '2', 'q1'],
		});
		rule({
			p: '`own` function contracts consume heap arguments and return ownership without callee-name rules.',
			src: `consume = <T>(value: own T): Int32 { length(value) };
make = (n: Int32): own String { 'v\${n}' };
main { consume(make(1)) >> out }`,
			ast: `(root (def :consume ? (fn (, (parameter :T ? ?)) (parameter :value typeident ?) typeident (next (call :length @intrinsic :value)))) (def :make ? (fn (parameter :n typeident ?) typeident (next (interp :n)))) (main (>> (call :consume (call :make 1)) :out)))`,
			out: ['2'],
		});
		compileError({
			src: `consume = (value: own String): Int32 { length(value) };
main { value = 'v\${1}'; consume(value) >> out; length(value) >> out }`,
			expected: 'used after move',
		});
		compileError({
			src: `consume = (value: own String): Int32 { length(value) };
relay = (value: String): Int32 { consume(value) };
main { relay('v') >> out }`,
			expected: 'cannot move borrowed',
		});
		compileError({
			src: `invalid = (value: String): own String { value };
main { invalid('v') >> out }`,
			expected: 'emits a borrowed value',
		});
		compileError({
			src: `join = (left: own String, right: own String): Int32 { length(left) + length(right) };
main { value = 'v\${1}'; join(value, value) >> out }`,
			expected: 'conflicting ownership slots',
		});
		expr({
			p: 'Scalars (`Int32`, `Float64`, `Bool`, `Char`) and interned string literals are copied, not owned — they may be rebound and read any number of times.',
			pre: 'a = 5; b = a',
			src: 'a + b',
			ast: '(+ :a :b)',
			out: ['10'],
		});
		expr({
			p: 'A heap value (a computed `String`, a data block, …) is owned by the block that creates it and freed at that block’s exit, with its owned fields. Reading it — a field access, `length`, or a plain parameter — borrows it; ownership leaves only through `next` to an `own` result, an `own` parameter, or embedding.',
			pre: 'twice = (s: String): Int32 { length(s) + length(s) }',
			src: "twice('hi')",
			ast: "(call :twice 'hi')",
			out: ['4'],
		});
		expr({
			p: '`next` of a borrowed value — a plain parameter, alias, or heap element — propagates the borrow and its owner provenance, never a move. It may be emitted repeatedly while the owner remains live, which makes `triple(x){x,x,x}` and `filter` expressible.',
			pre: 'triple = (s: String) { next s; next s; next s }',
			src: "triple('hi')",
			ast: "(call :triple 'hi')",
			out: ['hi', 'hi', 'hi'],
		});
		compileError({
			p: '`next` of a value owned here moves it through an `own` result; the block no longer owns it, so later use is an error. Emitting an owned value twice would require an explicit copy operation.',
			src: "g = () { s = '${Char(65)}'; next s; next s }; main { g() >> out }",
			expected: 'used after move',
		});
		compileError({
			src: `type Pair = { String, own String }; main { pair = (s: String): Pair { next s; next s }; pair('x') >> out }`,
			expected: 'declares an `own` result but emits a borrowed value',
		});
		expr({
			p: 'A binding never transfers ownership: `b = a` borrows, so both names read one value that is freed once. Ownership transfers only when `next` crosses an `own` result, an argument crosses an `own` parameter, or a value is embedded in an owning field; none of these implicitly clones.',
			pre: "dup = (): Int32 { s = '${Char(65)}'; b = s; next length(b) + length(s) }",
			src: 'dup()',
			ast: '(call :dup ?)',
			out: ['2'],
		});
		compileError({
			p: 'A binding that is never read is rejected as unused.',
			src: "main { s = 'hi'; b = s }",
			expected: 'never used',
		});
	});

	h('Diagnostics', ({ diagnostics }) => {
		const invalidParameter =
			'bad = (value: var): Int32 { value }; main { missing >> out }';
		diagnostics({
			p: 'Invalid declarations recover at the next statement and preserve independent diagnostics.',
			src: invalidParameter,
			expected: [
				{
					message: 'Expected type expression',
					start: invalidParameter.indexOf('):'),
					end: invalidParameter.indexOf('):') + 1,
				},
				{
					message: 'Identifier not defined',
					start: invalidParameter.indexOf('missing'),
					end: invalidParameter.indexOf('missing') + 7,
				},
			],
		});
		const invalidField = 'type Bad = [value: own String]; main { }';
		diagnostics({
			src: invalidField,
			expected: [
				{
					message:
						'`own` is valid only on function parameters and results',
					start: invalidField.indexOf('own'),
					end: invalidField.indexOf('own') + 3,
				},
			],
		});
		const badArgument =
			'id = (n: Int32): Int32 { n }; main { id(true) >> out }';
		diagnostics({
			src: badArgument,
			expected: [
				{
					message:
						'Argument of type "Bool" is not assignable to parameter of type "Int32".',
					start: badArgument.lastIndexOf('id('),
					end: badArgument.lastIndexOf('id(') + 8,
				},
			],
		});
		const moved =
			'consume = (s: own String) { done }; main { a = String(1); consume(a); length(a) >> out }';
		diagnostics({
			src: moved,
			expected: [
				{
					message:
						'"a" used after move into `own` parameter "s" of "consume" at line 1, column 67',
					start: moved.lastIndexOf('a)'),
					end: moved.lastIndexOf('a)') + 1,
				},
			],
		});
	});
});
