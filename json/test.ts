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

export default spec('json', it => {
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
});
