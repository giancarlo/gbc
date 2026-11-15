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

export default spec('go', it => {
	it.should('classify Go tokens and preserve source positions', (a: TestApi) => {
		const value = 'package main\nfunc café(x int) { return true /* note\n */ }';
		const tokens = [...highlight().resume({ source: input(value) })];
		a.equalValues(tokens.map(token => [text(token), token.highlight]), [
			['package', 'keyword'], ['main', 'identifier'], ['func', 'keyword'], ['café', 'identifier'],
			['(', 'punctuation'], ['x', 'identifier'], ['int', 'type'], [')', 'punctuation'],
			['{', 'punctuation'], ['return', 'keyword'], ['true', 'literal'], ['/* note\n */', 'comment'], ['}', 'punctuation'],
		]);
		for (const token of tokens) {
			a.equal(token.source, value);
			a.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
			a.assert(token.end > token.start);
		}
	});
	it.should('recognize numeric forms and longest operators', (a: TestApi) => {
		const value = '0x_FF 0b_10 0o_77 0600 1_000 1. .25 2e+3 4i 0x1.fp-2 0X.8P+2i ... &^= <<= >>= := <- ++ -- ~';
		const tokens = [...highlight().resume({ source: input(value) })];
		a.equalValues(tokens.map(token => token.highlight), [
			...Array<string>(11).fill('number'), 'punctuation', ...Array<string>(8).fill('operator'),
		]);
		a.equalValues(tokens.map(text), value.split(' '));
	});
	it.should('fold multiline strings, comments and structural brackets only', (a: TestApi) => {
		const tokens = [...highlight().resume({ source: input('([{}]) "[]" // {}\n`a\nb` /* x\ny */') })];
		a.equalValues(tokens.map(token => [token.foldStart, token.foldEnd]), [
			[1, 0], [1, 0], [1, 0], [0, 1], [0, 1], [0, 1], [0, 0], [0, 0], [1, 1], [1, 1],
		]);
	});
	it.should('recover from incomplete input and invalid characters', (a: TestApi) => {
		for (const value of ['"unfinished', "'unfinished", '`unfinished', '/* unfinished', '$', '\u0000'])
			a.assert([...highlight().resume({ source: input(value) })].some(token => token.highlight === 'error'));
		const tokens = [...highlight().resume({ source: input('"bad\nreturn nil') })];
		a.equalValues(tokens.map(token => token.highlight), ['error', 'keyword', 'literal']);
		a.equal(tokens[1]?.line, 1);
	});
	it.should('match full highlighting at every split, retry, cancellation, and single-character window', (a: TestApi) => {
		const cases = ['', '\n', 'package main\nfunc main() { println("hi") }',
			'/* a\nb */ x := 1\n', '/**/\n', '/*/ unfinished\n', '// comment\r\nx',
			'`raw\n// not comment\n`\nx', '"bad\nreturn false', "'a' '🚀'", '𐐀 := 1\n',
			'x / 2\ny /= 2\n', '"escaped\\"quote"', '`unterminated\n', '0x_1.fp+2i <-chan int',
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
		value = 'x = 1\ny = true';
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
		const value = 'x = `first\nsecond\nlast`\n';
		const source = input(value);
		const prefix = drain(highlighter.resume({ source, end: 15 }));
		const shifted = input('\n' + value, source.id, 2);
		const checkpoint = highlighter.rebase(prefix.checkpoint, shifted, 1, 1);
		const fresh = drain(highlighter.resume({ source: shifted, end: 16 }));
		a.assert(highlighter.equivalent(checkpoint, fresh.checkpoint));
		a.equalValues([...highlighter.resume({ source: shifted }, checkpoint)], [...highlighter.resume({ source: shifted }, fresh.checkpoint)]);
	});
	it.should('read long incomplete strings once across bounded windows', (a: TestApi) => {
		const value = 'value = `' + 'long text\n'.repeat(2000) + '`\n';
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
