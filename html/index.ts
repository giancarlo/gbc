import { ScannerApi } from '../sdk/index.js';

export function scanner(src: string) {
	const {
		current,
		tk,
		skipWhitespace,
		matchWhile,
		backtrack: apiBacktrack,
	} = ScannerApi({ source: src });
	let inTag = false;
	let expectTagName = false;
	const states = new Map<
		number,
		{ inTag: boolean; expectTagName: boolean }
	>();

	function emit<Kind extends string>(kind: Kind, consume: number) {
		const start = tk('', 0).end;
		states.set(start, { inTag, expectTagName });
		return tk(kind, consume);
	}

	function isCommentStart() {
		return (
			current() === '<' &&
			current(1) === '!' &&
			current(2) === '-' &&
			current(3) === '-'
		);
	}

	function next() {
		skipWhitespace();
		const ch = current();

		if (!ch) return emit('eof', 0);

		if (isCommentStart()) {
			const start = tk('', 0).end;
			const closeIdx = src.indexOf('-->', start + 4);
			const consume =
				closeIdx === -1 ? src.length - start : closeIdx + 3 - start;
			const token = emit('comment', consume);
			inTag = false;
			expectTagName = false;
			return token;
		}

		if (ch === '<') {
			const token = emit('openTag', 1);
			inTag = true;
			expectTagName = true;
			return token;
		}

		if (ch === '>') {
			const token = emit('gt', 1);
			inTag = false;
			expectTagName = false;
			return token;
		}

		if (ch === '/') return emit('slash', 1);

		if (ch === '=') return emit('equals', 1);

		if (ch === '"' || ch === "'") {
			const quote = ch;
			let consumed = 1;
			while (current(consumed)) {
				if (current(consumed) === quote)
					return emit('string', consumed + 1);
				consumed +=
					current(consumed) === '\\' && current(consumed + 1)
						? 2
						: 1;
			}
			return emit('string', consumed);
		}

		if (expectTagName && /[a-zA-Z]/.test(ch)) {
			const consumed = matchWhile(ch => /[a-zA-Z0-9\-_:]/.test(ch));
			const token = emit('tagName', consumed);
			expectTagName = false;
			return token;
		}

		if (inTag && ch === '.' && /[a-zA-Z]/.test(current(1))) {
			return emit(
				'attrName',
				matchWhile(ch => /[a-zA-Z0-9\-_:]/.test(ch), 1),
			);
		}

		if (inTag && /[a-zA-Z]/.test(ch)) {
			return emit(
				'attrName',
				matchWhile(ch => /[a-zA-Z0-9\-_:]/.test(ch)),
			);
		}

		if (!inTag) {
			return emit('text', matchWhile(ch => ch !== '<'));
		}

		return emit('text', 1);
	}

	function backtrack(pos: Parameters<typeof apiBacktrack>[0]) {
		apiBacktrack({ ...pos, end: pos.start });
		const state = states.get(pos.start);
		if (state) {
			inTag = state.inTag;
			expectTagName = state.expectTagName;
		}
	}

	return {
		next,
		backtrack,
	};
}
