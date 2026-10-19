import { CompilerError, enrichHighlightToken, type HighlightKind, type HighlightToken, type Highlighter, type Position, type Token, type TokenizerError } from './index.js';

export interface HighlightSource {
	readonly id: object;
	readonly version: string | number;
	readonly length: number;
	read(start: number, end: number): string;
	text(): string;
}

export interface HighlightInput {
	readonly source: HighlightSource;
	readonly end?: number;
	readonly edit?: { readonly previousVersion: string | number; readonly start: number };
}

declare const checkpointState: unique symbol;

export interface HighlightCheckpoint<State> {
	readonly offset: number;
	readonly line: number;
	readonly committed: number;
	readonly done: boolean;
	readonly [checkpointState]?: State;
}

export interface HighlightWindow {
	readonly text: string;
	readonly start: number;
	readonly line: number;
	readonly final: boolean;
	position(start: number, end: number, line: number, token?: Position): Position;
}

export interface HighlightState<State> {
	readonly state: State;
	readonly committed: number;
}

function validateWindow(length: number, start: number, end: number) {
	if (!Number.isSafeInteger(length) || length < 0 ||
		!Number.isSafeInteger(end) || end < start || end > length)
		throw new RangeError('Invalid highlight window');
}

function validEdit(edit: HighlightInput['edit'], version: string | number, start: number, length: number) {
	if (!edit) return false;
	return edit.previousVersion === version && Number.isSafeInteger(edit.start) &&
		edit.start >= start && edit.start <= length;
}

function validateCommitted(committed: number, start: number, end: number, final: boolean) {
	if (!Number.isSafeInteger(committed) || committed < start || committed > end || (final && committed !== end))
		throw new Error('Invalid committed highlight boundary');
}

function countLines(text: string): number {
	let lines = 0;
	for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) lines++;
	return lines;
}

export function createHighlighter<Node extends Token<string>, State>(
	initial: () => State,
	scan: (window: HighlightWindow, state: Readonly<State>) => Generator<Node & HighlightToken, HighlightState<State>>,
): Highlighter<Node, State> {
	const checkpoints = new WeakMap<HighlightCheckpoint<State>, {
		state: State;
		id: object;
		version: string | number;
	}>();

	function* resume(input: HighlightInput, checkpoint?: HighlightCheckpoint<State>): Generator<Node & HighlightToken, HighlightCheckpoint<State>> {
		const { source, edit } = input;
		const { id, version, length } = source;
		function validateSource() {
			if (source.id !== id || source.version !== version || source.length !== length)
				throw new Error('Highlight source changed');
		}
		const previous = checkpoint ? checkpoints.get(checkpoint) : undefined;
		const start = checkpoint?.offset ?? 0;
		const end = input.end ?? length;
		validateWindow(length, start, end);
		if (checkpoint && (previous?.id !== id ||
			(previous.version !== version && !validEdit(edit, previous.version, start, length)) || checkpoint.done))
			throw new Error('Invalid highlight checkpoint');
		const value = source.read(start, end);
		validateSource();
		if (value.length !== end - start) throw new RangeError('Incomplete highlight read');
		const sourceDescriptor: PropertyDescriptor = { enumerable: true, configurable: true, get: () => source.text() };
		const prototype: object = Object.prototype;
		const complete = start === 0 && end === length;
		const window: HighlightWindow = {
			text: value,
			start,
			line: checkpoint?.line ?? 0,
			final: end === length,
			position(start, end, line, token) {
				if (complete && !token) return { start, end, line, source: value };
				const position: Position = token ?? Object.create(prototype);
				position.start = start;
				position.end = end;
				position.line = line;
				Object.defineProperty(position, 'source', complete
					? { value, enumerable: true, configurable: true, writable: true }
					: sourceDescriptor);
				return position;
			},
		};
		const result = yield* scan(window, previous ? previous.state : initial());
		validateSource();
		validateCommitted(result.committed, checkpoint?.committed ?? 0, end, window.final);
		const line = window.line + countLines(value);
		const next: HighlightCheckpoint<State> = Object.freeze({
			offset: end, line, committed: result.committed, done: window.final,
		});
		if (!window.final) checkpoints.set(next, { state: result.state, id, version });
		return next;
	}

	return { resume };
}

export function highlightToken<Node extends Token<string>>(window: HighlightWindow, token: Node, offset = 0, line = 0): Node {
	const prototype: object | null = Object.getPrototypeOf(token);
	const result: Node = Object.create(prototype, Object.getOwnPropertyDescriptors(token));
	window.position(token.start + offset, token.end + offset, token.line + line, result);
	if ('error' in token && token.error instanceof CompilerError)
		Object.assign(result, { error: new CompilerError(token.error.message, window.position(
			token.error.position.start + offset, token.error.position.end + offset, token.error.position.line + line,
		)) });
	return result;
}

export function* highlightTokens<Node extends Token<string>, Result>(
	window: HighlightWindow,
	tokens: Iterable<Node | TokenizerError>,
	classify: (token: Node) => HighlightKind,
	completion: Result,
	fold?: (token: Node & HighlightToken) => readonly [number, number],
	errorLine = window.line,
): Generator<(Node | TokenizerError) & HighlightToken, Result> {
	const isScannedToken = (token: Node | TokenizerError): token is Node => token.kind !== 'tokenizer-error';
	let line = 0;
	let nextLine = window.text.indexOf('\n');
	for (const token of tokens) {
		while (nextLine >= 0 && nextLine < token.start) {
			line++;
			nextLine = window.text.indexOf('\n', nextLine + 1);
		}
		token.line = line;
		if (isScannedToken(token)) {
			const result = enrichHighlightToken(token, classify(token));
			if (fold) [result.foldStart, result.foldEnd] = fold(result);
			if (window.start || !window.final)
				window.position(result.start + window.start, result.end + window.start, result.line + window.line, result);
			yield result;
		} else {
			const result: TokenizerError & HighlightToken = Object.assign(window.position(
				token.start + window.start, token.end + window.start, line + window.line,
			), {
				kind: token.kind, highlight: 'error' as const, foldStart: 0, foldEnd: 0,
				error: new CompilerError(token.error.message, window.position(
					token.error.position.start + window.start, token.error.position.end + window.start, token.error.position.line + errorLine,
				)),
			});
			token.line += window.line;
			yield result;
		}
	}
	return completion;
}

interface HighlightFragment {
	readonly text: string;
	readonly previous: HighlightFragment | undefined;
}

export interface HighlightBuffer {
	readonly start: number;
	readonly line: number;
	readonly fragment: HighlightFragment | undefined;
}

export function* highlightSegments(
	window: HighlightWindow,
	previous: HighlightBuffer,
	boundary: (ch: string) => boolean,
	splitFinal = false,
): Generator<HighlightWindow, HighlightBuffer> {
	let { start, line, fragment } = previous;
	let offset = 0;
	let endLine = window.line;
	function segment(end: number): HighlightWindow {
		const parts = [window.text.slice(offset, end)];
		for (let part = fragment; part; part = part.previous) parts.push(part.text);
		return { ...window, text: parts.toReversed().join(''), start, line, final: window.final && end === window.text.length };
	}
	if (window.final && !splitFinal) {
		endLine += countLines(window.text);
		if (window.text || fragment) yield segment(window.text.length);
		return { start: window.start + window.text.length, line: endLine, fragment: undefined };
	}
	for (let index = 0; index < window.text.length; index++) {
		const ch = window.text.charAt(index);
		if (ch === '\n') endLine++;
		if (boundary(ch)) {
			const value = segment(index + 1);
			offset = index + 1;
			start = window.start + offset;
			line = endLine;
			fragment = undefined;
			yield value;
		}
	}
	if (window.final && (offset < window.text.length || fragment)) {
		const value = segment(window.text.length);
		start = window.start + window.text.length;
		line = endLine;
		fragment = undefined;
		yield value;
	} else if (offset < window.text.length)
		return { start, line, fragment: { text: window.text.slice(offset), previous: fragment } };
	return { start, line, fragment };
}
