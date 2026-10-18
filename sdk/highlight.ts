import type { HighlightToken, Highlighter, Position, Token } from './index.js';

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
	position(start: number, end: number, line: number): Position;
}

export interface HighlightState<State> {
	readonly state: State;
	readonly committed: number;
}

export interface ResumableHighlighter<Node extends Token<string>, State> extends Highlighter<Node> {
	resume(input: HighlightInput, checkpoint?: HighlightCheckpoint<State>): Generator<Node & HighlightToken, HighlightCheckpoint<State>>;
}

export function isResumableHighlighter<Node extends Token<string>>(highlight: Highlighter<Node>): highlight is ResumableHighlighter<Node, unknown> {
	return typeof highlight.resume === 'function';
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

export function createResumableHighlighter<Node extends Token<string>, State>(
	highlight: Highlighter<Node>,
	initial: () => State,
	scan: (window: HighlightWindow, state: Readonly<State>) => Generator<Node & HighlightToken, HighlightState<State>>,
): ResumableHighlighter<Node, State> {
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
		const window: HighlightWindow = {
			text: value,
			start,
			line: checkpoint?.line ?? 0,
			final: end === length,
			position(start, end, line) {
				return { start, end, line, get source() { return source.text(); } };
			},
		};
		const result = yield* scan(window, previous ? previous.state : initial());
		validateSource();
		validateCommitted(result.committed, checkpoint?.committed ?? 0, end, window.final);
		let line = window.line;
		for (const ch of value) if (ch === '\n') line++;
		const next: HighlightCheckpoint<State> = Object.freeze({
			offset: end, line, committed: result.committed, done: window.final,
		});
		checkpoints.set(next, { state: result.state, id, version });
		return next;
	}

	return Object.assign((source: string) => highlight(source), { resume });
}
