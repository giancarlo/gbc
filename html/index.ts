import { ScannerApi } from '@cxl/gbc.sdk';

export function scanner(src: string, xml = false) {
	const {
		current,
		tk,
		skipWhitespace,
		matchWhile,
		backtrack: apiBacktrack,
	} = ScannerApi({ source: src });
	const nameStart = xml ? /[\p{L}_:]/u : /[a-zA-Z]/;
	const namePart = xml ? /[\p{L}\p{N}\p{M}\-_.:\u00b7]/u : /[a-zA-Z0-9\-_:]/;
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

	function xmlMarkup() {
		const start = tk('', 0).end;
		const terminator = src.startsWith('<![CDATA[', start) ? ']]>' : src.startsWith('<?', start) ? '?>' : '';
		if (terminator) {
			const end = src.indexOf(terminator, start + (terminator === ']]>' ? 9 : 2));
			return emit(terminator === ']]>' ? 'cdata' : 'processingInstruction', end < 0 ? src.length - start : end + terminator.length - start);
		}
		if (current(1) === '!' && !isCommentStart()) {
			let quote = '';
			let depth = 0;
			let consumed = 2;
			for (; current(consumed); consumed++) {
				const ch = current(consumed);
				if (quote) { if (ch === quote) quote = ''; }
				else if (ch === '"' || ch === "'") quote = ch;
				else if (ch === '[') depth++;
				else if (ch === ']') depth--;
				else if (ch === '>' && depth === 0) return emit('declaration', consumed + 1);
			}
			return emit('declaration', consumed);
		}
	}

	function string(quote: string) {
		let consumed = 1;
		while (current(consumed)) {
			if (current(consumed) === quote)
				return emit('string', consumed + 1);
			consumed +=
				!xml && current(consumed) === '\\' && current(consumed + 1)
					? 2
					: 1;
		}
		return emit('string', consumed);
	}

	function comment() {
		const start = tk('', 0).end;
		const closeIdx = src.indexOf('-->', start + 4);
		const consume =
			closeIdx === -1 ? src.length - start : closeIdx + 3 - start;
		const token = emit('comment', consume);
		inTag = false;
		expectTagName = false;
		return token;
	}

	function next() {
		skipWhitespace();
		const ch = current();

		if (!ch) return emit('eof', 0);

		if (xml && !inTag && ch !== '<') return emit('text', matchWhile(ch => ch !== '<'));
		if (isCommentStart()) return comment();

		if (ch === '<') {
			if (xml) {
				const token = xmlMarkup();
				if (token) return token;
			}
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

		if (ch === '"' || ch === "'") return string(ch);
		if (!xml && inTag && ch === '.' && /[a-zA-Z]/.test(current(1))) {
			return emit(
				'attrName',
				matchWhile(ch => /[a-zA-Z0-9\-_:]/.test(ch), 1),
			);
		}

		if (inTag && nameStart.test(ch)) {
			const token = emit(expectTagName ? 'tagName' : 'attrName', matchWhile(ch => namePart.test(ch)));
			expectTagName = false;
			return token;
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
