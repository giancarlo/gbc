import { spec, type TestApi } from '@cxl/spec';
import { text, type Highlighter, type HighlightCheckpoint, type HighlightToken } from '@cxl/gbc.sdk';
import { highlight } from './index.js';

function input(value: string, id = {}, version = 1) {
	return { id, version, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function drain<T, R>(iterator: Generator<T, R>) {
	const tokens: T[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}

export default spec('python', it => {
	it.should('classify Python tokens and preserve source positions', (a: TestApi) => {
		const source = 'async def café(x):\n\treturn True if x >= .5e-2j else None # comment\n';
		const tokens = [...highlight().resume({ source: input(source) })];
		a.equalValues(tokens.map(token => [text(token), token.highlight]), [
			['async', 'keyword'], ['def', 'keyword'], ['café', 'identifier'], ['(', 'punctuation'],
			['x', 'identifier'], [')', 'punctuation'], [':', 'punctuation'], ['return', 'keyword'],
			['True', 'literal'], ['if', 'keyword'], ['x', 'identifier'], ['>=', 'operator'],
			['.5e-2j', 'number'], ['else', 'keyword'], ['None', 'literal'], ['# comment', 'comment'],
		]);
		for (const token of tokens) {
			a.equal(token.source, source);
			a.equal(token.line, source.slice(0, token.start).split('\n').length - 1);
			a.assert(token.end > token.start);
		}
	});
	it.should('recognize numeric forms, longest operators, and soft keyword identifiers', (a: TestApi) => {
		const source = '0x_FF 0b_10 0o_77 1_000 1. .25 2e+3 4J ... **= //= >>= := -> match case type _';
		const tokens = [...highlight().resume({ source: input(source) })];
		a.equalValues(tokens.map(token => token.highlight), [
			...Array<string>(8).fill('number'), 'punctuation', ...Array<string>(5).fill('operator'),
			...Array<string>(4).fill('identifier'),
		]);
		a.equalValues(tokens.map(text), source.split(' '));
	});
	it.should('highlight prefixed strings and fold only strings and structural brackets', (a: TestApi) => {
		for (const prefix of ['', 'r', 'u', 'b', 'f', 'br', 'rb', 'fr', 'rf', 'R', 'F']) {
			const source = prefix + '"""first\n# [text] {value}\nlast"""';
			const tokens = [...highlight().resume({ source: input(source) })];
			a.equal(tokens.length, 1);
			a.equal(tokens[0]?.highlight, 'string');
			a.equal(tokens[0]?.foldStart, 1);
			a.equal(tokens[0]?.foldEnd, 1);
			a.equal(tokens[0] && text(tokens[0]), source);
		}
		const tokens = [...highlight().resume({ source: input('([{}]) "[]" # {}') })];
		a.equalValues(tokens.map(token => [token.foldStart, token.foldEnd]), [[1, 0], [1, 0], [1, 0], [0, 1], [0, 1], [0, 1], [0, 0], [0, 0]]);
	});
	it.should('recover from incomplete strings and invalid characters', (a: TestApi) => {
		for (const value of ['"unfinished', "'''unfinished", '$', '`', '\u0000'])
			a.assert([...highlight().resume({ source: input(value) })].some(token => token.highlight === 'error'));
		const tokens = [...highlight().resume({ source: input('"bad\nreturn False') })];
		a.equalValues(tokens.map(token => token.highlight), ['error', 'keyword', 'literal']);
		a.equal(tokens[1]?.line, 1);
	});
	it.should('match full highlighting at every split, retry, cancellation, and single-character window', (a: TestApi) => {
		const cases = ['', '\n', "''\nx=1", '""\n', "'''a\n'b''c\n'''\nx", 'r"a\\"b"',
			'"line\\\ncontinued"\nTrue', '"line\\\r\ncontinued"\r\nFalse',
			'"bad\n# comment\nreturn 1', 'x := [0x_FF, .2e+3j]\n', 'f"{value}"', '𐐀 = 1\n',
			'"""escaped\\"""still\nstring"""', "'''unterminated\n", '# comment\r\nx',
		];
		for (const value of cases) {
			const highlighter: Highlighter = highlight();
			const source = input(value);
			const expected = [...highlighter.resume({ source })];
			for (let end = 0; end < value.length; end++) {
				const prefix = drain(highlighter.resume({ source, end }));
				const rest = drain(highlighter.resume({ source }, prefix.checkpoint));
				a.equalValues([...prefix.tokens, ...rest.tokens], expected);
				const cancelled = highlighter.resume({ source }, prefix.checkpoint);
				if (!cancelled.next().done) cancelled.return(prefix.checkpoint);
				a.equalValues(drain(highlighter.resume({ source }, prefix.checkpoint)).tokens, rest.tokens);
			}
			let checkpoint: HighlightCheckpoint<unknown> | undefined;
			const tokens: HighlightToken[] = [];
			let materialized = 0;
			const lazy = { ...source, text() { materialized++; return value; } };
			for (let end = 0; end <= value.length; end++) {
				const result = drain(highlighter.resume({ source: lazy, end }, checkpoint));
				tokens.push(...result.tokens); checkpoint = result.checkpoint;
			}
			a.equal(materialized, 0);
			a.equalValues(tokens, expected);
			a.equal(checkpoint?.committed, value.length);
			a.equal(checkpoint?.done, true);
		}
	});
	it.should('reuse checkpoints for edits and reject stale or foreign input', (a: TestApi) => {
		const highlighter = highlight();
		let value = 'x = 1\ny = "old"';
		const source = { ...input(value), text: () => value };
		const prefix = drain(highlighter.resume({ source, end: 9 }));
		value = 'x = 1\ny = True';
		const edited = input(value, source.id, 2);
		const suffix = drain(highlighter.resume({ source: edited, edit: { previousVersion: 1, start: 9 } }, prefix.checkpoint));
		a.equalValues([...prefix.tokens, ...suffix.tokens], [...highlighter.resume({ source: edited })]);
		a.throws(() => [...highlighter.resume({ source: edited }, prefix.checkpoint)]);
		a.throws(() => [...highlight().resume({ source }, prefix.checkpoint)]);
		a.throws(() => [...highlighter.resume({ source: input(source.text()) }, prefix.checkpoint)]);
		a.throws(() => [...highlighter.resume({ source, end: -1 })]);
		a.throws(() => [...highlighter.resume({ source: edited }, suffix.checkpoint)]);
	});
	it.should('relocate checkpoints with pending multiline strings', (a: TestApi) => {
		const highlighter = highlight();
		const value = 'x = """first\nsecond\nlast"""\n';
		const source = input(value);
		const prefix = drain(highlighter.resume({ source, end: 15 }));
		const shifted = input('\n' + value, source.id, 2);
		const checkpoint = highlighter.rebase(prefix.checkpoint, shifted, 1, 1);
		const fresh = drain(highlighter.resume({ source: shifted, end: 16 }));
		a.assert(highlighter.equivalent(checkpoint, fresh.checkpoint));
		a.equalValues([...highlighter.resume({ source: shifted }, checkpoint)], [...highlighter.resume({ source: shifted }, fresh.checkpoint)]);
	});
	it.should('read long incomplete strings once across bounded windows', (a: TestApi) => {
		const value = 'value = """' + 'long text\n'.repeat(2000) + '"""\n';
		let read = 0;
		const source = { ...input(value), read(start: number, end: number) {
			read += end - start; return value.slice(start, end);
		} };
		const highlighter: Highlighter = highlight();
		let checkpoint: HighlightCheckpoint<unknown> | undefined;
		const tokens: HighlightToken[] = [];
		for (let end = 0; end < value.length; end += 127) {
			const result = drain(highlighter.resume({ source, end }, checkpoint));
			tokens.push(...result.tokens); checkpoint = result.checkpoint;
		}
		tokens.push(...highlighter.resume({ source }, checkpoint));
		a.equal(read, value.length);
		a.equalValues(tokens, [...highlighter.resume({ source: input(value) })]);
	});
});
