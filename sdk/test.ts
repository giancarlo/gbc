import { spec, type TestApi } from '@cxl/spec';
import {
	type BaseNode,
	type BinaryNodeBase,
	childNodes,
	CompilerError,
	createCaseInsensitiveTrie,
	createHighlighter,
	highlightTokens,
	type Scanner,
	type HighlightKind,
	type HighlightToken,
	createTrie,
	findNodeAtIndex,
	Flags,
	enrichHighlightToken,
	foldToken,
	formatting,
	type Highlighter,
	type LeafNode,
	matchers,
	ParserApi,
	ReferenceSymbolTable,
	type RootNodeBase,
	ScannerApi,
	stringEscape,
	text,
	type TernaryNodeBase,
	tokenize,
	type UnaryNodeBase,
} from './index.js';
import type { NodeWithChildren, Symbol, Token, Type } from './index.js';
import type {
	RuntimeEvent,
	RuntimeExports,
	RuntimeInputResponse,
	RuntimeRunRecord,
} from './index.js';

type TestLeaf = LeafNode<'leaf'>;
type TestRoot = RootNodeBase<TestLeaf>;
type TestUnary = UnaryNodeBase<TestLeaf>;
type TestBinary = BinaryNodeBase<TestLeaf>;
type TestTernary = TernaryNodeBase<TestLeaf>;
type TestOptional = TernaryNodeBase<TestLeaf, true>;
type TestArgument = LeafNode<'argument'>;
type TestNodeMap = {
	leaf: TestLeaf;
	arguments: Token<'arguments'> & { children: TestArgument[] };
	unary: Token<'unary'> & { children: [TestLeaf] };
};
type TestArgumentParent = NodeWithChildren<TestNodeMap, TestArgument[]>;

const _ident = /\w/;
const ident = (ch: string) => ch === '_' || _ident.test(ch);
const notIdent = (ch: string) => !ident(ch);

function drain<Node, Result>(iterator: Generator<Node, Result>) {
	const tokens: Node[] = [];
	for (;;) {
		const next = iterator.next();
		if (next.done) return { tokens, checkpoint: next.value };
		tokens.push(next.value);
	}
}

function resumable() {
	return createHighlighter(() => 0, function* (window, count) {
		let line = window.line;
		for (let index = 0; index < window.text.length; index++) {
			const start = window.start + index;
			yield Object.assign(enrichHighlightToken(Object.assign(window.position(start, start + 1, line), { kind: 'char' }), 'text'), { ordinal: count++ });
			if (window.text.charAt(index) === '\n') line++;
		}
		return { state: count, committed: window.start + window.text.length };
	});
}

function highlightSource(value: string) {
	return { id: {}, version: 1, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
}

function tokenHighlighter<Node extends Token<string>>(
	scanner: Scanner<Node>,
	classify: (token: Node) => HighlightKind,
	fold?: (token: Node & HighlightToken) => readonly [number, number],
) {
	return createHighlighter(() => undefined, function* (window) {
		yield* highlightTokens(window, tokenize(scanner, window.text), classify, undefined, fold);
		return { state: undefined, committed: window.start + window.text.length };
	});
}

export default spec('sdk', s => {
	s.test('look up checkpoint-only highlighters through the public contract', (a: TestApi) => {
		const registered: Record<string, Highlighter> = { native: resumable() };
		const native = registered.native;
		a.assert(native);
		a.equal(typeof native, 'object');
		a.equalValues(drain(native.resume({ source: highlightSource('ab') })).tokens.map(text), ['a', 'b']);
	});
	s.test('complete windows reuse the read snapshot without materializing the source', (a: TestApi) => {
		const value = 'a\nb';
		const source = { ...highlightSource(value), text(): string { throw new Error('Unexpected materialization'); } };
		const tokens = drain(resumable().resume({ source })).tokens;
		a.equalValues(tokens.map(token => token.source), [value, value, value]);
		a.equal(JSON.stringify(tokens).includes('"source":"a\\nb"'), true);
	});
	s.test('bounded highlighting validates public input before reading', (a: TestApi) => {
		const highlight = resumable();
		let reads = 0;
		const source = { ...highlightSource('abc'), read(start: number, end: number) { reads++; return 'abc'.slice(start, end); } };
		for (const end of [-1, 0.5, 4, NaN, Infinity])
			a.throws(() => drain(highlight.resume({ source, end })));
		for (const length of [-1, 1.5, NaN, Infinity])
			a.throws(() => drain(highlight.resume({ source: { ...source, length } })));
		a.equal(reads, 0);
		const prefix = drain(highlight.resume({ source, end: 1 }));
		a.throws(() => drain(highlight.resume({ source, end: 0 }, prefix.checkpoint)));
		a.throws(() => drain(highlight.resume({ source: { ...source, read: () => '' } }, prefix.checkpoint)));
		a.throws(() => drain(highlight.resume({ source: { ...source, read: () => 'toolong' } }, prefix.checkpoint)));
		a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens.map(token => token.ordinal), [1, 2]);
	});
	s.test('checkpoints reject foreign, forged, stale and final input', (a: TestApi) => {
		const highlight = resumable();
		const source = highlightSource('abc');
		const prefix = drain(highlight.resume({ source, end: 1 }));
		a.throws(() => drain(resumable().resume({ source }, prefix.checkpoint)));
		a.throws(() => drain(highlight.resume({ source }, { ...prefix.checkpoint })));
		a.throws(() => drain(highlight.resume({ source: highlightSource('abc') }, prefix.checkpoint)));
		a.throws(() => drain(highlight.resume({ source: { ...source, version: 2 } }, prefix.checkpoint)));
		for (const edit of [
			{ previousVersion: 0, start: 1 }, { previousVersion: 1, start: 0 },
			{ previousVersion: 1, start: NaN }, { previousVersion: 1, start: 1.5 },
			{ previousVersion: 1, start: 4 },
		]) a.throws(() => drain(highlight.resume({ source: { ...source, version: 2 }, edit }, prefix.checkpoint)));
		const changed = { ...source, version: 2, length: 2, read: (start: number, end: number) => 'az'.slice(start, end), text: () => 'az' };
		const final = drain(highlight.resume({ source: changed, edit: { previousVersion: 1, start: 1 } }, prefix.checkpoint));
		a.equalValues(final.tokens.map(text), ['z']);
		a.throws(() => drain(highlight.resume({ source: changed }, final.checkpoint)));
		a.throws(() => drain(highlight.resume({ source: { ...changed, version: 3 }, edit: { previousVersion: 2, start: 2 } }, final.checkpoint)));
	});
	s.test('bounded highlighting isolates interleaved sessions and cancelled retries', (a: TestApi) => {
		const highlight = resumable();
		const source = highlightSource('a\nb');
		const other = highlightSource('xy');
		const first = drain(highlight.resume({ source, end: 1 }));
		const second = drain(highlight.resume({ source: other, end: 1 }));
		const cancelled = highlight.resume({ source }, first.checkpoint);
		a.equal(cancelled.next().done, false);
		cancelled.return(first.checkpoint);
		a.equalValues(drain(highlight.resume({ source: other }, second.checkpoint)).tokens.map(token => [text(token), token.ordinal]), [['y', 1]]);
		const result = drain(highlight.resume({ source }, first.checkpoint));
		a.equalValues(result.tokens.map(token => [text(token), token.start, token.line, token.ordinal]), [['\n', 1, 0, 1], ['b', 2, 1, 2]]);
		a.equal(result.checkpoint.line, 1);
		a.equal(result.checkpoint.offset, 3);
		a.equal(result.checkpoint.committed, 3);
		a.equalValues([...highlight.resume({ source: highlightSource('ab') })].map(text), ['a', 'b']);
		const empty = drain(highlight.resume({ source: highlightSource('') }));
		a.equalValues(empty.tokens, []);
		a.equal(empty.checkpoint.done, true);
	});
	s.test('bounded highlighting rolls back read and scanner failures', (a: TestApi) => {
		const source = highlightSource('abc');
		let fail = false;
		const highlight = createHighlighter(() => 0, function* (window, count) {
			yield Object.assign(enrichHighlightToken(Object.assign(window.position(window.start, window.start + 1, window.line), { kind: 'char' }), 'text'), { ordinal: count });
			if (fail) throw new Error('Scanner failed');
			return { state: count + 1, committed: window.start + window.text.length };
		});
		const prefix = drain(highlight.resume({ source, end: 1 }));
		const readError = new Error('Read failed');
		a.throws(() => drain(highlight.resume({ source: { ...source, read() { throw readError; } } }, prefix.checkpoint)), readError);
		fail = true;
		a.throws(() => drain(highlight.resume({ source }, prefix.checkpoint)));
		fail = false;
		a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens.map(token => token.ordinal), [1]);
	});
	s.test('bounded highlighting rejects invalid mode commitment', (a: TestApi) => {
		const source = highlightSource('ab');
		for (const committed of [-1, 0.5, 3, NaN, 0]) {
			const highlight = createHighlighter(() => 0, function* (window) {
				yield Object.assign(enrichHighlightToken(Object.assign(window.position(0, 1, 0), { kind: 'char' }), 'text'), { ordinal: 0 });
				return { state: 0, committed };
			});
			a.throws(() => drain(highlight.resume({ source })));
		}
	});
	s.test('resume preserves undefined state without initializing another session', (a: TestApi) => {
		let sessions = 0;
		const highlight = createHighlighter(() => { sessions++; }, function* (window) {
			yield Object.assign(enrichHighlightToken(Object.assign(window.position(window.start, window.start + 1, 0), { kind: 'char' }), 'text'), { ordinal: 0 });
			return { state: undefined, committed: window.start + window.text.length };
		});
		const source = highlightSource('ab');
		const prefix = drain(highlight.resume({ source, end: 1 }));
		drain(highlight.resume({ source }, prefix.checkpoint));
		a.equal(sessions, 1);
	});
	s.test('resume rejects source revisions changed during a read or suspended scan', (a: TestApi) => {
		const highlight = resumable();
		const source = highlightSource('abc');
		const prefix = drain(highlight.resume({ source, end: 1 }));
		const iterator = highlight.resume({ source }, prefix.checkpoint);
		a.equal(iterator.next().done, false);
		source.version = 2;
		a.throws(() => drain(iterator));
		source.version = 1;
		const changed = { ...source, read(start: number, end: number) { changed.version++; return 'abc'.slice(start, end); } };
		a.throws(() => highlight.resume({ source: changed }, prefix.checkpoint).next());
		a.equalValues(drain(highlight.resume({ source }, prefix.checkpoint)).tokens.map(text), ['b', 'c']);
	});
	s.test('parentheses do not mark fold boundaries', a => {
		const highlight = tokenHighlighter(source => {
			const api = ScannerApi({ source });
			return {
				backtrack: api.backtrack,
				next() {
					api.skipWhitespace();
					return api.eof() ? api.tk('eof', 0) : api.tk('symbol', 1);
				},
			};
		}, () => 'punctuation', foldToken);
		for (const source of ['()', '(\n)'])
			a.equalValues([...highlight.resume({ source: highlightSource(source) })].map(token => [token.foldStart, token.foldEnd]), [[0, 0], [0, 0]]);
	});

	s.test('fold classifiers receive highlighted tokens and skip errors', (a: TestApi) => {
		const calls: string[] = [];
		const highlight = tokenHighlighter(source => {
			const api = ScannerApi({ source });
			return {
				backtrack: api.backtrack,
				next() {
					if (api.current() === '?') throw api.error('Unexpected input', 1);
					return api.eof() ? api.tk('eof', 0) : api.tk('symbol', 1);
				},
			};
		}, () => 'punctuation', token => {
			a.equal(token.highlight, 'punctuation');
			calls.push(text(token));
			return foldToken(token);
		});
		const iterator = highlight.resume({ source: highlightSource('(?[])') });
		a.equal(calls.length, 0);
		const first = iterator.next();
		a.assert(!first.done);
		a.equal(calls.length, 1);
		a.equalValues(
			[first.value, ...iterator].map(token => [token.foldStart, token.foldEnd]),
			[[0, 0], [0, 0], [1, 0], [0, 1], [0, 0]],
		);
		a.equalValues(calls, ['(', '[', ']', ')']);
	});

	s.test('preserves enriched token metadata in a lazy checkpoint stream', (a: TestApi) => {
		const source = 'a\nb';
		const scanned: Token<'word'>[] = [];
		const highlight = tokenHighlighter(value => {
			const api = ScannerApi({ source: value });
			return {
				backtrack: api.backtrack,
				next() {
					api.skipWhitespace();
					if (api.eof()) return api.tk('eof', 0);
					const token = Object.assign(api.tk('word', 1), { value: api.current(-1) });
					scanned.push(token);
					return token;
				},
			};
		}, () => 'identifier');
		const stream = highlight.resume({ source: highlightSource(source) });
		a.equal(scanned.length, 0);
		const first = stream.next();
		a.equal(first.done, false);
		if (!first.done) {
			a.equal(scanned.length, 1);
			a.equal(first.value.kind, 'word');
			a.equal(first.value.highlight, 'identifier');
			if (first.value.kind === 'word') a.equal(first.value.value, 'a');
			a.equal(first.value.foldStart, 0);
			a.equal(first.value.foldEnd, 0);
			a.equal(first.value.source, source);
			const rest = [...stream];
			a.equal(rest.length, 1);
			a.equal(rest[0]?.line, 1);
			a.equal(first.value.highlight, 'identifier');
		}
		a.equalValues([...highlight.resume({ source: highlightSource('') })], []);
	});

	s.test('highlighter recovery', a => {
		const highlight = tokenHighlighter(source => {
			const api = ScannerApi({ source });
			return {
				next: () => {
					if (api.current() === '?') throw api.error('Unexpected input', 1);
					return api.eof() ? api.tk('eof', 0) : api.tk('word', 1);
				},
				backtrack: api.backtrack,
			};
		}, () => 'identifier', () => [2, 1]);
		const tokens = [...highlight.resume({ source: highlightSource('a?b') })];
		a.equalValues(tokens.map(token => [token.highlight, token.start, token.end]), [
			['identifier', 0, 1], ['error', 1, 2], ['identifier', 2, 3],
		]);
		a.equal(tokens[1]?.kind, 'tokenizer-error');
		a.equal(tokens[1]?.foldStart, 0);
		a.equal(tokens[1]?.foldEnd, 0);
		a.equalValues(tokens.filter(token => token.kind === 'word')
			.map(token => [token.foldStart, token.foldEnd]), [[2, 1], [2, 1]]);
		if (tokens[1]?.kind === 'tokenizer-error')
			a.ok(tokens[1].error instanceof CompilerError);
	});

	s.test('runtime contracts', it => {
		it.should('describe direct numeric Wasm calls and reject invalid record shapes', a => {
			type Assignable<From, To> = [From] extends [To] ? true : false;
			const checks: [
				Assignable<Parameters<RuntimeExports['input']>, [number, number, number]>,
				Assignable<Parameters<RuntimeExports['advance']>, [number]>,
				Assignable<ReturnType<RuntimeExports['advance']>, void>,
				Assignable<ReturnType<RuntimeExports['init']>, number>,
				Assignable<ReturnType<RuntimeExports['start']>, number>,
				Assignable<ReturnType<RuntimeExports['pause']>, number>,
				Assignable<ReturnType<RuntimeExports['resume']>, number>,
				Assignable<ReturnType<RuntimeExports['stop']>, number>,
				Assignable<ReturnType<RuntimeExports['dispose']>, number>,
				Assignable<ReturnType<RuntimeExports['cancel']>, number>,
				Assignable<ReturnType<RuntimeExports['commandBuffer']>, number>,
				Assignable<ReturnType<RuntimeExports['read']>, number>,
				Assignable<{ inputId: number; type: 'number'; value: string }, RuntimeInputResponse>,
				Assignable<{ kind: 'commandResult'; commandId: number; status: 99 }, RuntimeEvent>,
				Assignable<{ kind: 'completed'; reason: 'disposed'; exitCode: number }, RuntimeEvent>,
				Assignable<{ kind: 'state'; state: 'completed' }, RuntimeEvent>,
				Assignable<{ kind: 'failed'; error: { message: string } }, RuntimeEvent>,
				Assignable<{ record: RuntimeEvent }, RuntimeRunRecord>,
			] = [true, true, true, true, true, true, true, true, true, true, true, true,
				false, false, false, false, false, false];
			a.equal(checks.length, 18);
		});

		it.should('preserve input, lifecycle, diagnostic, and error data through serialization', a => {
			const position = { start: 0, end: 2, line: 0, source: '😀\n' };
			const events: readonly RuntimeEvent[] = [
				{ kind: 'state', state: 'ready' },
				{ kind: 'state', state: 'running' },
				{ kind: 'state', state: 'paused' },
				{ kind: 'state', state: 'stopping' },
				{ kind: 'commandResult', commandId: 1, status: 0 },
				{ kind: 'commandResult', commandId: 2, status: -4 },
				{ kind: 'commandResult', commandId: 3, status: -9 },
				{ kind: 'input', request: { inputId: 1, type: 'string', prompt: 'Name?' } },
				{ kind: 'input', request: { inputId: 2, type: 'number', prompt: 'Count?' } },
				{ kind: 'input', request: { inputId: 3, type: 'boolean', prompt: 'Continue?' } },
				{ kind: 'inputCancelled', inputId: 3 },
				{ kind: 'diagnostic', diagnostic: { severity: 'warning', message: 'A warning', code: 'W1', position } },
				{ kind: 'completed', reason: 'returned', exitCode: 7 },
				{ kind: 'completed', reason: 'stopped', exitCode: 0 },
				{ kind: 'failed', error: { name: 'NumericOverflow', message: 'Overflow', code: 'E1', position, stack: 'program:1' } },
				{ kind: 'disposed' },
			];
			const records: RuntimeRunRecord[] = events.map(record => ({ runId: 'run-1', record }));
			const responses: RuntimeRunRecord<RuntimeInputResponse>[] = [
				{ runId: 'run-1', record: { inputId: 1, type: 'string', value: '😀' } },
				{ runId: 'run-1', record: { inputId: 2, type: 'number', value: 42.5 } },
				{ runId: 'run-1', record: { inputId: 3, type: 'boolean', value: false } },
			];
			a.equalValues(JSON.parse(JSON.stringify(records)), records);
			a.equalValues(JSON.parse(JSON.stringify(responses)), responses);
		});
	});

	s.test('formatter', it => {
		const { concat, group, indent, line, render } = formatting;
		const document = group(
			concat(['condition ?', indent(concat([line, 'truthy'])), line, ': falsy']),
		);

		it.should('keep groups flat when they fit', a => {
			a.equal(render(document, { lineWidth: 40 }), 'condition ? truthy : falsy');
		});

		it.should('break and indent groups that do not fit', a => {
			a.equal(
				render(document, { lineWidth: 15, initialIndent: '\t' }),
				'condition ?\n\t\ttruthy\n\t: falsy',
			);
		});

		it.should('account for the starting column', a => {
			a.equal(
				render(group(concat(['left', line, 'right'])), {
					lineWidth: 12,
					initialColumn: 8,
				}),
				'left\nright',
			);
		});

		it.should('break a group that contains a hard line', a => {
			a.equal(
				render(group(concat(['left', line, 'middle', formatting.hardline, 'right']))),
				'left\nmiddle\nright',
			);
		});
	});

	s.test('shared AST and scanner helpers', a => {
		const source = 'ab';
		const leaf: BaseNode = { start: 0, end: 1, line: 0, source };
		const parent: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [leaf, undefined],
		};
		a.equal(childNodes(leaf), undefined);
		a.equalValues(childNodes(parent), [leaf, undefined]);
		a.equal(matchers.horizontalSpace('\t'), true);
		a.equal(matchers.lineBreak('\r'), true);
		a.equal(matchers.notLineBreak('x'), true);
		a.equal(matchers.notLineBreak('\n'), false);
		a.equal(matchers.octalDigit('7'), true);
		a.equal(matchers.octalDigit('8'), false);
	});

	s.test('parser API', it => {
		it.should('filter child shapes and look ahead without consuming', a => {
			const source = 'a ! b';
			const argument: TestArgument = {
				kind: 'argument',
				start: 0,
				end: 1,
				line: 0,
				source,
			};
			const parent: TestArgumentParent = {
				kind: 'arguments',
				start: 0,
				end: 1,
				line: 0,
				source,
				children: [argument],
			};
			const parser = ParserApi(value => {
				const scanner = ScannerApi({ source: value });
				return {
					backtrack: scanner.backtrack,
					next() {
						scanner.skipWhitespace();
						if (scanner.eof()) return scanner.tk('eof', 0);
						if (scanner.current() === '!')
							throw scanner.error('Unexpected input', 1);
						return scanner.tk(scanner.current() === 'a' ? 'a' : 'b', 1);
					},
				};
			});

			parser.start(source);
			a.equal(parent.kind, 'arguments');
			a.equal(parser.peekKind('b'), true);
			a.equal(parser.current().kind, 'a');
			a.equal(parser.errors.length, 0);
			a.equal(parser.next().kind, 'b');
			a.equal(parser.errors.length, 1);
		});
	});

	s.test('reference-aware symbol table', it => {
		const position = { start: 2, end: 7, line: 1, source: '\n value' };
		const variable = (): Symbol => ({ kind: 'variable', flags: Flags.Variable });

		it.should('resolve globals and misses without recording plain lookups', a => {
			const value = variable();
			const table = ReferenceSymbolTable({ value });
			a.equal(table.get('value'), value);
			a.equal(value.references, undefined);
			a.equal(table.getWithReference('missing', position), undefined);
			a.equal(table.getWithReference('value', position), value);
			a.equal(value.references?.[0], position);
			a.equalValues(value.references, [position]);
			const next = { ...position, start: 3 };
			table.getWithReference('value', next);
			a.equalValues(value.references, [position, next]);
		});

		it.should('record only the nearest shadow and restore the outer scope', a => {
			const outer = variable();
			const inner = variable();
			const table = ReferenceSymbolTable({ value: outer });
			const result = table.withScope(() => {
				a.equal(table.set('value', inner), inner);
				a.equal(table.getWithReference('value', position), inner);
				a.equal(outer.references, undefined);
				return 42;
			});
			a.equal(result, 42);
			a.equal(table.getWithReference('value', position), outer);
			a.equalValues(inner.references, [position]);
			a.equalValues(outer.references, [position]);
		});

		it.should('suppress references and allow local exceptions from the selected depth', a => {
			const outer = variable();
			const local = variable();
			const nested = variable();
			const table = ReferenceSymbolTable({ value: outer }, true);
			table.getWithReference('value', position);
			a.equal(outer.references, undefined);
			table.localReferenceDepth = 1;
			table.withScope(() => {
				table.setSymbols({ value: local });
				table.withScope(() => {
					a.equal(table.getWithReference('value', position), local);
					table.set('value', nested);
					a.equal(table.getWithReference('value', position), nested);
				});
				table.localReferenceDepth = undefined;
				table.getWithReference('value', position);
			});
			a.equalValues(local.references, [position]);
			a.equalValues(nested.references, [position]);
			a.equal(outer.references, undefined);
			table.ignoreReferences = false;
			table.getWithReference('value', position);
			a.equalValues(outer.references, [position]);
		});

		it.should('include depth zero and exclude symbols below the selected depth', a => {
			const outer = variable();
			const table = ReferenceSymbolTable({ value: outer }, true);
			table.localReferenceDepth = 1;
			table.withScope(() => table.getWithReference('value', position));
			a.equal(outer.references, undefined);
			table.localReferenceDepth = 0;
			table.getWithReference('value', position);
			a.equalValues(outer.references, [position]);
		});

		it.should('isolate tables and remove nested scopes after throws', a => {
			const outer = variable();
			const table = ReferenceSymbolTable({ value: outer });
			const other = ReferenceSymbolTable<Symbol>(undefined, true);
			const error = new Error('scope failed');
			let caught: unknown;
			try {
				table.withScope(() => {
					table.set('value', variable());
					table.withScope(() => {
						table.set('temporary', variable());
						throw error;
					});
				});
			} catch (value) {
				caught = value;
			}
			a.equal(caught, error);
			a.equal(table.get('temporary'), undefined);
			a.equal(table.getWithReference('value', position), outer);
			a.equal(other.get('value'), undefined);
			other.set('value', variable());
			other.localReferenceDepth = 0;
			a.equal(table.ignoreReferences, false);
			a.equal(table.localReferenceDepth, undefined);
			a.equalValues(outer.references, [position]);
			table.set('after', variable());
			a.ok(table.get('after'));
		});
	});

	s.test('shared semantic types', a => {
		const source = 'value';
		const definition: TestLeaf = {
			kind: 'leaf',
			start: 0,
			end: source.length,
			line: 0,
			source,
		};
		const type = { kind: 'type', name: 'Integer' } as const satisfies Type;
		const symbol: Symbol<typeof definition, typeof type> = {
			kind: 'variable',
			name: 'value',
			definition,
			type,
			flags: Flags.Variable,
		};
		a.equal(symbol.kind, 'variable');
		a.equal(symbol.definition, definition);
		a.equal(symbol.type, type);
		a.equal(symbol.flags, Flags.Variable);
	});

	s.test('findNodeAtIndex', it => {
		const source = 'ab';
		const left: BaseNode = { start: 0, end: 1, line: 0, source };
		const right: BaseNode = { start: 1, end: 2, line: 0, source };
		const branch: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [left, right],
		};
		const root: BaseNode = {
			start: 0,
			end: 2,
			line: 0,
			source,
			children: [branch],
		};

		it.should('return the most specific nested node', a => {
			a.equal(findNodeAtIndex(root, 0), left);
		});

		it.should('use half-open source boundaries', a => {
			a.equal(findNodeAtIndex(branch, 1), right);
		});

		it.should('return undefined outside the node span', a => {
			a.equal(findNodeAtIndex(root, -1), undefined);
			a.equal(findNodeAtIndex(root, 2), undefined);
		});

		it.should('skip absent tuple children', a => {
			const leaf: TestLeaf = {
				kind: 'leaf',
				start: 0,
				end: 1,
				line: 0,
				source,
			};
			const rootShape: TestRoot = { children: [leaf] };
			const unaryShape: TestUnary = { children: [leaf] };
			const binaryShape: TestBinary = { children: [leaf, leaf] };
			const ternaryShape: TestTernary = { children: [leaf, leaf, leaf] };
			const optionalShape: TestOptional = {
				children: [leaf, leaf, undefined],
			};
			const optional: BaseNode = {
				start: 0,
				end: 2,
				line: 0,
				source,
				children: [left, right, undefined],
			};
			a.equalValues(
				[
					rootShape.children.length,
					unaryShape.children.length,
					binaryShape.children.length,
					ternaryShape.children.length,
					optionalShape.children.length,
				],
				[1, 1, 2, 3, 3],
			);
			a.equal(findNodeAtIndex(optional, 1), right);
		});
	});

	s.test('ScannerApi', s => {
		s.test('lineToken', a => {
			const api = ScannerApi({ source: '\r\nx' });
			const eol = api.lineToken('eol', 2);
			const ident = api.tk('ident', 1);
			a.equalValues(
				[eol.start, eol.end, eol.line, ident.start, ident.end, ident.line],
				[0, 2, 0, 2, 3, 1],
			);
		});

		s.test('createTrieMatcher', it => {
			it.should('parse keywords that contain each other', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'main' });
				const matcher = createTrieMatcher(
					createTrie('ma', 'main'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'main');
			});
			it.should('return undefined for no match', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'xtz' });
				const matcher = createTrieMatcher(
					createTrie('xy', 'xyz'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
			it.should('handle partial matches correctly', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'mat-ch' });
				const matcher = createTrieMatcher(
					createTrie('mat', 'match'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'mat');
			});
			it.should('match case-insensitive tries with canonical kinds', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'pRiNt' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'PRINT');
			});
			it.should('match overlapping case-insensitive keywords', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'gOtO' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('GO', 'GOTO'),
					notIdent,
				);
				a.equal(matcher()?.kind, 'GOTO');
			});
			it.should('respect case-insensitive keyword boundaries', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'PRINTABLE' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
			it.should('reject case-insensitive non-matches', a => {
				const { createTrieMatcher } = ScannerApi({ source: 'plot' });
				const matcher = createTrieMatcher(
					createCaseInsensitiveTrie('PRINT'),
					notIdent,
				);
				a.equal(matcher()?.kind, undefined);
			});
		});

		s.test('matchEnclosed', it => {
			const notQuote = (ch: string) => ch !== "'";

			it.should('match a string at offset 0', a => {
				const { matchEnclosed } = ScannerApi({ source: "'abc'" });
				a.equal(matchEnclosed(notQuote, stringEscape), 4);
			});
			it.should('honor escape inside the enclosure', a => {
				const { matchEnclosed } = ScannerApi({
					source: "'a\\'b'",
				});
				a.equal(matchEnclosed(notQuote, stringEscape), 5);
			});
			it.should('honor escape when not at source start', a => {
				const { matchEnclosed, skip } = ScannerApi({
					source: "xx'a\\'b'",
				});
				skip(2);
				a.equal(matchEnclosed(notQuote, stringEscape), 5);
			});
			it.should(
				'stop at closing delimiter when no escape precedes it',
				a => {
					const { matchEnclosed, skip } = ScannerApi({
						source: "xx'line\\nA\\u{42}'",
					});
					skip(2);
					a.equal(matchEnclosed(notQuote, stringEscape), 14);
				},
			);
		});
	});

	s.test('tokenize', it => {
		it.should('retain positioned tokens and recover scanner errors', a => {
			const source = 'one ! two';
			const scanner = (value: string) => {
				const api = ScannerApi({ source: value });
				return {
					backtrack: api.backtrack,
					next() {
						api.skipWhitespace();
						if (api.eof()) return api.tk('eof', 0);
						if (api.current() === '!')
							throw api.error('Unexpected input', 1);
						return api.tk(
							'word',
							api.matchWhile(ch => ch !== ' ' && ch !== '!'),
						);
					},
				};
			};
			const tokens = [...tokenize(scanner, source)];
			a.equalValues(
				tokens.map(({ kind, start, end }) => ({ kind, start, end })),
				[
					{ kind: 'word', start: 0, end: 3 },
					{ kind: 'tokenizer-error', start: 4, end: 5 },
					{ kind: 'word', start: 6, end: 9 },
				],
			);
			a.ok(
				tokens[1]?.kind === 'tokenizer-error' &&
					tokens[1].error instanceof CompilerError,
			);
		});

		it.should('stop when an error cannot advance', a => {
			const tokens = [
				...tokenize(
					source => ({
						backtrack() {},
						next() {
							throw new CompilerError('Incomplete input', {
								start: 0,
								end: 0,
								line: 0,
								source,
							});
						},
					}),
					'',
				),
			];
			a.equalValues(
				tokens.map(({ kind, start, end }) => ({ kind, start, end })),
				[{ kind: 'tokenizer-error', start: 0, end: 0 }],
			);
		});
	});
});
