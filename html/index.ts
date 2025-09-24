import { ScannerApi } from 'gbc/sdk/index.js';

export function scanner(src: string) {
	const { current, tk, skipWhitespace, matchWhile, backtrack } = ScannerApi({
		source: src,
	});

	function next() {
		skipWhitespace();
		const ch = current();

		if (!ch) return tk('eof', 0);

		// Comments: <!-- ... -->
		if (ch === '<' && src.substr(tk('', 0).end, 3) === '!--') {
			const start = tk('', 0).end;
			const closeIdx = src.indexOf('-->', start);
			if (closeIdx === -1)
				return tk('comment', src.length - tk('', 0).end);
			const len = closeIdx + 3 - tk('', 0).end;
			return tk('comment', len);
		}

		// Opening tag: <
		if (ch === '<') {
			const nc = current(1);
			if (nc === '/') return tk('closeTag', 2);
			return tk('openTag', 1);
		}

		// Closing tag: >
		if (ch === '>') {
			return tk('gt', 1);
		}

		// Slash: /
		if (ch === '/') {
			return tk('slash', 1);
		}

		// Equals: =
		if (ch === '=') {
			return tk('equals', 1);
		}

		// String: "..." or '...'
		if (ch === '"' || ch === "'") {
			const quote = ch;
			let consumed = 1;
			while (current(consumed) && current(consumed) !== quote) {
				// support for \" or \'
				if (
					current(consumed) === '\\' &&
					current(consumed + 1) === quote
				)
					consumed += 2;
				else consumed++;
			}
			consumed++; // closing quote
			return tk('string', consumed);
		}

		// Tag/Attribute name: [a-zA-Z][a-zA-Z0-9-]*
		if (
			/[a-zA-Z]/.test(ch) &&
			(current(-1) === '<' || current(-1) === '/' || current(-1) === ' ')
		) {
			const consumed = matchWhile(ch => /[a-zA-Z0-9\-_:]/.test(ch));
			if (current(-1) === '<' || current(-2) === '<') {
				return tk('tagName', consumed);
			}
			return tk('attrName', consumed);
		}

		// Text between tags (stop at < )
		if (ch !== '<') {
			let consumed = 0;
			while (current(consumed) && current(consumed) !== '<') {
				consumed++;
			}
			return tk('text', consumed);
		}

		// Fallback, skip 1 character
		return tk('text', 1);
	}

	return {
		next,
		backtrack,
	};
}
