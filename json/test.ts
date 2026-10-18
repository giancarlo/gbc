import { spec, type TestApi } from '@cxl/spec';
import { CompilerError, text, tokenize } from '@cxl/gbc.sdk';
import { parse, scan } from './index.js';
import { highlight } from './highlight.js';

const benchmarkSource = JSON.stringify(Array.from({ length: 100 }, (_, id) => ({
	id,
	name: 'Sample item',
	active: true,
	values: [1.25, -2e3, null, 'escaped\ntext'],
})), null, '\t');

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}

function input(value: string, id = {}, version = 1) {
	return { id, version, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function windowed(value: string, ends: number[]) {
	const source = input(value);
	let result = drain(highlight.resume({ source, end: ends[0] }));
	const tokens = [...result.tokens];
	for (const end of ends.slice(1)) {
		result = drain(highlight.resume({ source, end }, result.checkpoint));
		tokens.push(...result.tokens);
	}
	return { tokens, checkpoint: result.checkpoint };
}

export default spec('json', it => {
	it.should('match full highlighting at every split and single-character windows', (a: TestApi) => {
		const cases = [
			'', ' ', '\r\n', '{}', '[]', 'true', 'false', 'null', '12', '-1.25e+20',
			'-0', '0e1', '-0.1', '1E-2', '1.', '-', '+1', '0x10', 'NaN', '1e',
			'{"key" \t\r\n: [true, false, null, -2e3, "text", "😀"]}',
			'"key"', '"key" \n', '"key" \n :', '"a\\\\\\"b"',
			'"\\u0041\\uD83D\\uDE00"', '"\\u"', '"\\u12"', '"\\uZZZZ"',
			'"\\u\\""', '"\\u12\\\\"', '"bad\ntrue', '"bad\rnull',
			'"\\\ntrue', '"\u0000" null', '"unterminated', '"\\',
			'"\\x" null', '01 true', '1e+ false', 'truefalse null',
			'wrong"string" : 1', '"a":{}\n"b" : []',
		];
		for (const value of cases) {
			const full = [...highlight(value)];
			for (let end = 0; end < value.length; end++)
				a.equalValues(windowed(value, [end, value.length]).tokens, full);
			const result = windowed(value, Array.from({ length: value.length + 1 }, (_, index) => index));
			a.equalValues(result.tokens, full);
			a.equal(result.checkpoint.committed, value.length);
			a.equal(result.checkpoint.done, true);
		}
	});
	it.should('match legacy recovery for deterministic malformed windows', (a: TestApi) => {
		let seed = 1416;
		const alphabet = '"\\u0123456789abcdeftruenls :{},[]\n\r\t\u0000';
		for (let index = 0; index < 50; index++) {
			let value = '';
			for (let n = 0; n < 40; n++) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				value += alphabet.charAt(seed % alphabet.length);
			}
			a.equalValues(windowed(value, [10, 20, 30, 40]).tokens, [...highlight(value)]);
		}
	});
	it.should('reuse checkpoints after edits only beyond their consumed input', (a: TestApi) => {
		let current = '{"key"   : 123}';
		const original = { ...input(current), text: () => current };
		const prefix = drain(highlight.resume({ source: original, end: 8 }));
		for (const value of ['{"key"   : false}', '{"key"   }', '{"key"   ', '{"key"   : "new\\nvalue"}']) {
			current = value;
			const source = input(value, original.id, 2);
			const result = drain(highlight.resume({ source, edit: { previousVersion: 1, start: 8 } }, prefix.checkpoint));
			a.equalValues([...prefix.tokens, ...result.tokens], [...highlight(value)]);
		}
		a.throws(() => drain(highlight.resume({ source: input('{"changed":1}', original.id, 2) }, prefix.checkpoint)));
		a.throws(() => drain(highlight.resume({ source: input('{"changed":1}', original.id, 2), edit: { previousVersion: 1, start: 2 } }, prefix.checkpoint)));
		current = '{"key"   : 123}';
		a.equalValues(drain(highlight.resume({ source: original }, prefix.checkpoint)).tokens, [...highlight(original.text())].slice(1));
	});
	it.should('keep sources lazy and serializable across pending tokens and errors', (a: TestApi) => {
		const value = '{"key" \n: 01, "bad\\x"}';
		let materializations = 0;
		const source = { ...input(value), text() { materializations++; return value; } };
		const prefix = drain(highlight.resume({ source, end: 7 }));
		const result = drain(highlight.resume({ source }, prefix.checkpoint));
		a.equal(materializations, 0);
		const tokens = [...prefix.tokens, ...result.tokens];
		a.equalValues(JSON.parse(JSON.stringify(tokens)), JSON.parse(JSON.stringify([...highlight(value)])));
		a.assert(materializations > 0);
		for (const token of tokens) {
			a.equal(token.source, value);
			if (token.kind === 'tokenizer-error') {
				a.assert(token.error instanceof CompilerError);
				a.equal(token.error.position.source, value);
			}
		}
	});
	it.should('retain pending state without rescanning long windows or mutating retries', (a: TestApi) => {
		const value = '{"' + 'x'.repeat(4000) + '"' + ' \n'.repeat(2000) + ': true}';
		let read = 0;
		const source = { ...input(value), read(start: number, end: number) { read += end - start; return value.slice(start, end); } };
		let result = drain(highlight.resume({ source, end: 2 }));
		const tokens = [...result.tokens];
		for (let end = 32; end < value.length; end += 32) {
			result = drain(highlight.resume({ source, end }, result.checkpoint));
			tokens.push(...result.tokens);
		}
		const iterator = highlight.resume({ source }, result.checkpoint);
		const next = iterator.next();
		a.assert(!next.done);
		a.equal(next.value.kind, 'string');
		iterator.return(result.checkpoint);
		const final = drain(highlight.resume({ source }, result.checkpoint));
		a.equalValues([...tokens, ...final.tokens], [...highlight(value)]);
		a.assert(read <= value.length + 32);
	});
	it.should('resume bounded windows without committing property lookahead', (a: TestApi) => {
		const value = '{"key" \n: 12}';
		const reads: number[][] = [];
		const source = {
			id: {}, version: 1, length: value.length,
			read(start: number, end: number) {
				reads.push([start, end]);
				return value.slice(start, end);
			},
			text: () => value,
		};
		const first = highlight.resume({ source, end: 8 });
		const token = first.next();
		a.assert(!token.done);
		a.equal(text(token.value), '{');
		const checkpoint = first.next();
		a.assert(checkpoint.done);
		a.equal(checkpoint.value.committed, 1);
		const rest = highlight.resume({ source }, checkpoint.value);
		a.equalValues([token.value, ...rest], [...highlight(value)]);
		a.equalValues(reads, [[0, 8], [8, value.length]]);
	});
	it.should('parse nested objects and arrays with positioned properties', (a: TestApi) => {
		const source = '{"items": [true, false, null, -1.5e+2, "text", {}, []]}';
		const result = parse(source);
		a.equalValues(result.errors, []);
		const root = result.node;
		a.assert(root?.kind === 'object');
		a.equal(text(root), source);
		const property = root.children[0];
		a.assert(property);
		a.equal(property.kind, 'property');
		a.equal(property.children[0].value, 'items');
		a.equal(text(property), source.slice(1, -1));
		const array = property.children[1];
		a.assert(array.kind === 'array');
		a.equalValues(array.children.map(node => node.kind), ['literal', 'literal', 'literal', 'number', 'string', 'object', 'array']);
		a.equalValues(array.children.slice(0, 5).map(node => node.kind === 'string' || node.kind === 'number' || node.kind === 'literal' ? node.value : undefined), [true, false, null, -150, 'text']);
	});
	it.should('parse all scalar roots and string escapes', (a: TestApi) => {
		for (const source of ['0', '-0', '1.25', '1e-2', '1E+2', 'true', 'false', 'null', '""', '"\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\uD83D\\uDE00"']) {
			const result = parse(' \t\r\n' + source + ' \n');
			a.equalValues(result.errors, []);
			a.assert(result.node && (result.node.kind === 'string' || result.node.kind === 'number' || result.node.kind === 'literal'));
			a.equalValues(result.node.value, JSON.parse(source));
			a.equal(result.node.line, 1);
			a.equal(text(result.node), source);
		}
	});
	it.should('reject invalid JSON with positioned diagnostics', (a: TestApi) => {
		const cases = ['', ' ', '{', '[', '{"a":}', '{a:1}', '{"a" 1}', '{"a":1,}', '[1,]', '[,1]', '[1 2]', 'true false', '01', '-01', '+1', '.1', '1.', '1e', '1e+', '0x10', '1_000', 'NaN', 'Infinity', 'undefined', 'TRUE', "'text'", '`text`', '// comment', '/* comment */', '\ufeffnull', '\vnull', '"unterminated', '"\\x20"', '"\\u12"', '"\\uZZZZ"', '"line\nbreak"', '"\t"', '"\u0000"', '"\\', '"\\\n"'];
		for (const source of cases) {
			const result = parse(source);
			a.equal(result.node, undefined);
			a.assert(result.errors.length > 0, source);
			for (const error of result.errors) {
				a.assert(error instanceof CompilerError);
				a.equal(error.position.source, source);
				a.assert(error.position.start >= 0 && error.position.end <= source.length);
			}
		}
	});
	it.should('preserve scan positions and support backtracking', (a: TestApi) => {
		const source = '{\n "a": -2.5e3\n}';
		a.equalValues([...tokenize(scan, source)].map(token => [token.kind, text(token), token.start, token.end, token.line]), [
			['{', '{', 0, 1, 0], ['string', '"a"', 3, 6, 1], [':', ':', 6, 7, 1], ['number', '-2.5e3', 8, 14, 1], ['}', '}', 15, 16, 2],
		]);
		a.equalValues([...tokenize(scan, '"bad\ntrue')].map(token => [token.kind, token.line]), [['tokenizer-error', 0], ['true', 1]]);
		const scanner = scan(source);
		const first = scanner.next();
		const second = scanner.next();
		scanner.backtrack(first);
		a.equalValues(scanner.next(), second);
	});
	it.should('isolate parsing calls and diagnostics', (a: TestApi) => {
		const invalid = parse('[1,]');
		const snapshot = [...invalid.errors];
		a.equalValues(parse('{}').errors, []);
		a.equalValues(invalid.errors, snapshot);
		a.equalValues(parse('[true]'), parse('[true]'));
	});
	it.should('highlight categories and fold only structural delimiters', (a: TestApi) => {
		const source = '{"key" \n: ["{}[]", -2, true, false, null]}';
		const tokens = [...highlight(source)];
		a.equalValues(tokens.map(token => token.highlight), ['punctuation', 'attribute', 'punctuation', 'punctuation', 'string', 'punctuation', 'number', 'punctuation', 'literal', 'punctuation', 'literal', 'punctuation', 'literal', 'punctuation', 'punctuation']);
		a.equalValues(tokens.filter(token => token.foldStart || token.foldEnd).map(token => [text(token), token.foldStart, token.foldEnd]), [['{', 1, 0], ['[', 1, 0], [']', 0, 1], ['}', 0, 1]]);
		a.assert(tokens.every(token => token.source === source));
		a.equalValues(tokens.map(token => token.line), tokens.map(token => source.slice(0, token.start).split('\n').length - 1));
		a.equalValues([...highlight('')], []);
		a.equalValues([...highlight(source)], tokens);
		const iterator = highlight(source);
		a.equalValues(iterator.next().value, tokens[0]);
		a.equalValues([...highlight(source)], tokens);
		a.equalValues([...iterator], tokens.slice(1));
	});
	it.should('highlight incomplete input and recover after lexical errors', (a: TestApi) => {
		for (const source of ['{', '[1,', '{"key": "unfinished', '01 true', '"\\x" null']) {
			const tokens = [...highlight(source)];
			a.assert(tokens.length > 0);
			a.assert(tokens.every(token => token.start < token.end && token.end <= source.length));
			if (source.includes('unfinished') || source === '01 true' || source === '"\\x" null')
				a.assert(tokens.some(token => token.highlight === 'error'));
		}
		a.equalValues([...highlight('01 true')].map(token => [text(token), token.highlight]), [['01', 'error'], ['true', 'literal']]);
	});
	it.should('parse editor-sized JSON', a => a.benchmark(() => parse(benchmarkSource), {
		warmup: 50, sampleTime: 20, samples: 10, maxRegression: 15,
	}));
	it.should('highlight editor-sized JSON', a => a.benchmark(() => [...highlight(benchmarkSource)].length, {
		warmup: 50, sampleTime: 20, samples: 10, maxRegression: 15,
	}));
	it.should('resume a trailing JSON window', async a => {
		const source = input(benchmarkSource);
		const prefix = drain(highlight.resume({ source, end: source.length - 64 }));
		await a.benchmark(() => drain(highlight.resume({ source }, prefix.checkpoint)).tokens.length, {
			warmup: 50, sampleTime: 20, samples: 10, maxRegression: 15,
		});
	});
});
