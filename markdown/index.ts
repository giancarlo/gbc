import {
	Token,
	MakeNodeMap,
	ScannerApi,
	ParserApi,
	text,
	MatchFn,
} from '../sdk/index.js';

type Children = Node[];
/* eslint @typescript-eslint/no-empty-object-type: off */
type NodeMapBase = {
	code: { value: string };
	em: { children: Children };
	p: { children: Children };
	strong: { children: Children };
	delim: { ch: string; count: number; canOpen: boolean; canClose: boolean };
	root: {
		children: Children;
		pCount: number;
		linkDefinitions: Record<string, LinkDefinition | undefined>;
	};
	heading: { level: number; children: Children };
	ul: { children: Children; loose: boolean };
	ol: { children: Children; loose: boolean; listStart?: string };
	linkdef: LinkDefinition;
	li: {
		children: Children;
		indent: number;
		pCount: number;
		bullet: string;
		bulletOrder?: string;
	};
	eol: { count: number };
	text: { value: string; children?: Node[] };
	hr: {};
	br: {};
	block: { info?: string; value: string };
	blockquote: { children: Children; pCount: number };
	a: LinkDefinition;
	img: LinkDefinition;
	html: { block: boolean };
};
type NodeMap = MakeNodeMap<NodeMapBase>;

export type Node = NodeMap[keyof NodeMap];

type BlockToken = ReturnType<ReturnType<typeof scannerBlock>['next']>;
type InlineToken = ReturnType<ReturnType<typeof scannerInline>['next']>;
type InlineBlockToken = Extract<
	BlockToken,
	{
		// indent from start to textStart
		indent: number;
		textStart: number;
		// logical indentation to compare
		textIndent: number;
		// Indentation to create block
		blockIndent: number;
	}
>;
export type LinkDefinition = {
	href: string;
	title?: string;
	children: Node[];
};

const isEol = (c: string) => c === '\n';
const isSpace = (c: string) => c === ' ' || c === '\t';
const escape = (i: number, src: string) =>
	src.charAt(i) !== '\n' &&
	src.charAt(i - 1) === '\\' &&
	src.charAt(i - 2) !== '\\';
const isSpaceOrEol = (c: string) => isSpace(c) || isEol(c);
const alpha = (ch: string) =>
	(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const alphaDash = (ch: string) => alpha(ch) || ch === '-';
const alphaDashPlus = (c: string) => alpha(c) || c === '-' || c === '+';
const isHash = (c: string) => c === '#';
const notStartInline = (ch: string) =>
	ch !== '`' &&
	ch !== '\n' &&
	ch !== '_' &&
	ch !== '*' &&
	ch !== '<' &&
	ch !== '[' &&
	ch !== '!';
const digit = (ch: string) => ch >= '0' && ch <= '9';
const uWhiteSpace = /\p{White_Space}/u;
const uPunctuation = /\p{P}|\p{S}/u;
const isUnicodeWhiteSpace = (ch: string) => ch === '' || uWhiteSpace.test(ch);

function countSpaces(
	matchWhile: (match: MatchFn, consumed?: number) => number,
	offset = 0,
) {
	// max tab length is 4, depending on where in the text it is.
	let indent = offset;
	const textStart = matchWhile(ch => {
		const count = ch === '\t' ? 4 - (indent % 4) : ch === ' ' ? 1 : 0;
		indent += count;
		return !!count;
	}, offset);
	indent -= offset;
	return { indent, textStart };
}

function matchBlock(
	api: ReturnType<typeof ScannerApi>,
	ch: string,
	len: number,
	consumed: number,
	inline: boolean,
	endFn: (consumed: number, lineStart: number, lineCount: number) => boolean,
) {
	const blockStart = consumed;
	let blockEnd = 0,
		indent = 0,
		stopIndent = 0,
		lineCount = 0,
		lineStart = 0,
		cur;

	while ((cur = api.current(consumed))) {
		if (cur === '\n') {
			indent = stopIndent = 0;
			lineCount++;
			lineStart = consumed;
		} else if (!stopIndent) {
			if (cur === ' ') indent++;
			else if (cur === '\t') indent += 4;
			else stopIndent = 1;
		}
		consumed++;

		let found = 0;
		const maybeClose = api.matchWhile(c => c === ch, consumed);
		if (inline) {
			if (maybeClose - consumed === len) found = maybeClose;
			else consumed = maybeClose;
		} else if (maybeClose - consumed >= len) {
			found = api.matchWhile(isSpace, maybeClose);
		}

		if (found && endFn(found, indent, lineCount)) {
			blockEnd = consumed;
			consumed = found;
			break;
		}
	}
	return { consumed, blockEnd, blockStart, lineStart, lineCount };
}

const htmlRule6 =
	/^(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;
const htmlRule1 = /pre|script|style|textarea/i;

function htmlScanner(api: ReturnType<typeof ScannerApi>) {
	const { matchWhile, current, eof, matchString, matchUntil } = api;

	function matchTagName(start: number) {
		let tagName = '',
			tagNameEnd = start,
			ch;

		while (
			(ch = current(tagNameEnd)) &&
			(alphaDash(ch) || (tagName && digit(ch)))
		) {
			tagName += ch;
			tagNameEnd++;
		}

		return { tagNameEnd, tagName };
	}

	function matchAttributes(start: number, oneLine: boolean) {
		let n = start;
		while (true) {
			const wsStart = n;
			let prevNl = false;
			while (true) {
				const c = current(n);
				if (c === ' ' || c === '\t') {
					n++;
					prevNl = false;
				} else if (c === '\n' && !oneLine && !prevNl) {
					n++;
					prevNl = true;
				} else break;
			}
			const c = current(n);
			if (c === '>' || c === '/' || c === '') return n;
			if (n === wsStart) return -1;
			if (!alpha(c) && c !== '_' && c !== ':') return -1;
			n++;
			while (true) {
				const a = current(n);
				if (
					alpha(a) ||
					digit(a) ||
					a === '_' ||
					a === '.' ||
					a === ':' ||
					a === '-'
				)
					n++;
				else break;
			}
			let k = n;
			while (current(k) === ' ' || current(k) === '\t') k++;
			if (current(k) !== '=') {
				continue;
			}
			k++;
			while (current(k) === ' ' || current(k) === '\t') k++;
			const v = current(k);
			if (v === '"' || v === "'") {
				k++;
				while (
					current(k) &&
					current(k) !== v &&
					(!oneLine || current(k) !== '\n')
				)
					k++;
				if (current(k) !== v) return -1;
				n = k + 1;
			} else {
				const vs = k;
				while (true) {
					const u = current(k);
					if (
						!u ||
						u === ' ' ||
						u === '\t' ||
						u === '\n' ||
						u === '"' ||
						u === "'" ||
						u === '=' ||
						u === '<' ||
						u === '>' ||
						u === '`'
					)
						break;
					k++;
				}
				if (k === vs) return -1;
				n = k;
			}
		}
	}

	function matchTag(start: number, oneLine = false) {
		let ch = current(start);
		const isClosingTag = ch === '/';
		if (isClosingTag) ch = current(start++);

		const { tagNameEnd, tagName } = matchTagName(start);
		if (!tagName) return;

		const isRule6 = htmlRule6.test(tagName);

		if (isClosingTag) {
			const skipSpaces = matchWhile(isSpace, tagNameEnd);
			if (current(skipSpaces) !== '>') return;
			return {
				tagName,
				tagEnd: skipSpaces + 1,
				isClosingTag,
				isRule6,
			};
		}

		if (oneLine && (isRule6 || htmlRule1.test(tagName))) {
			const after = current(tagNameEnd);
			if (
				after !== ' ' &&
				after !== '\t' &&
				after !== '\n' &&
				after !== '>' &&
				after !== '/' &&
				after !== ''
			)
				return;
			let p = '';
			const tagEnd = matchWhile(c => {
				const r = c !== '>' && !(c === '\n' && p === '\n');
				p = c;
				return r;
			}, tagNameEnd);
			if (eof(tagEnd))
				return { tagName, tagEnd, isClosingTag, isRule6 };
			return current(tagEnd) === '>'
				? { tagName, tagEnd: tagEnd + 1, isClosingTag, isRule6 }
				: 0;
		}

		const afterAttrs = matchAttributes(tagNameEnd, oneLine);
		if (afterAttrs < 0) return;
		let tagEnd = afterAttrs;
		if (current(tagEnd) === '/') tagEnd++;
		if (current(tagEnd) === '>')
			return { tagName, tagEnd: tagEnd + 1, isClosingTag, isRule6 };
		if (oneLine && eof(tagEnd))
			return { tagName, tagEnd, isClosingTag, isRule6 };
		return 0;
	}

	function matchComment(start: number, closing: string, block = true) {
		while (!eof(start++)) {
			const end = matchString(closing, undefined, start);
			if (end) return block ? matchUntil(isEol, start) : end;
		}
		return 0;
	}

	function matchInline(start: number) {
		if (current(start) === '!') {
			if (current(start + 1) === '-' && current(start + 2) === '-')
				return matchComment(start, '-->', false);
			if (matchString('[CDATA[', undefined, start + 1))
				return matchComment(start + 8, ']]>', false);
			else return matchComment(start + 1, '>', false);
		} else if (current(start) === '?')
			return matchComment(start + 1, '?>', false);

		const openTag = matchTag(start);

		if (!openTag) return 0;

		return openTag.tagEnd;
	}

	function isLineEnd(start: number) {
		const spaces = matchWhile(isSpace, start);
		return current(spaces) === '\n' || current(spaces) === '';
	}

	function matchHtml(start: number, block = false) {
		if (current(start) === '!') {
			if (current(start + 1) === '-' && current(start + 2) === '-')
				return matchComment(start + 3, '-->');
			else return matchComment(start + 1, '>');
		} else if (current(start) === '?') return matchComment(start + 1, '?>');

		const openTag = matchTag(start, block);

		if (!openTag) return 0;

		const { tagName, tagEnd, isClosingTag, isRule6 } = openTag;
		if (eof(tagEnd)) return tagEnd;

		if (!isRule6) {
			if (htmlRule1.test(tagName)) {
				if (isClosingTag) return 0;
				const closing = `</`;
				let closeTag = tagEnd;
				while (!eof(closeTag++)) {
					if (matchString(closing, undefined, closeTag)) {
						const tag = matchTag(closeTag + 1);
						if (tag && htmlRule1.test(tag.tagName)) {
							return matchUntil(isEol, tag.tagEnd);
						}
					}
				}
				return closeTag - 2;
			} else if (!isLineEnd(tagEnd)) return 0;
		}

		// Read until blank line
		let closeTag = tagEnd;
		do {
			if (
				current(closeTag) === '\n' &&
				(current(closeTag + 1) === '\n' || current(closeTag + 1) === '')
			)
				return closeTag;
		} while (!eof(closeTag++));

		return 0;
	}
	function matchHtmlBlock(start: number) {
		const end = matchHtml(start, true);
		if (!end) return { end: 0, isRule6: false };
		// Determine if first tag is rule 6 (can interrupt paragraphs)
		const first = current(start);
		const tagStart = first === '/' ? start + 1 : start;
		const isRule6 =
			first === '!' || first === '?'
				? true
				: htmlRule6.test(matchTagName(tagStart).tagName);
		return { end, isRule6 };
	}
	return { matchHtml: matchHtmlBlock, matchInline };
}

function matchLink(
	{ matchEnclosed, current, matchWhile }: ReturnType<typeof ScannerApi>,
	escape: (i: number, source: string) => boolean,
	linkStart: number,
	closing?: boolean,
) {
	// Inline links allow whitespace (incl. one newline) between `(` and URL
	if (closing) {
		linkStart = matchWhileSpaceOrOneLineEnding(matchWhile, linkStart)
			.consumed;
	}
	let parenDepth = 0;
	let prevCh = '';
	const linkEnd =
		current(linkStart) === '<'
			? matchEnclosed(
					c => c !== '>' && c !== '\n',
					escape,
					linkStart + 1,
			  ) + 1
			: matchEnclosed(
					c => {
						const escaped = prevCh === '\\';
						prevCh = escaped ? '' : c;
						if (c === ' ' || c === '\t' || c === '\n') return false;
						if (!closing || escaped) return true;
						if (c === '(') parenDepth++;
						else if (c === ')') {
							if (parenDepth === 0) return false;
							parenDepth--;
						}
						return true;
					},
					escape,
					linkStart,
			  );
	if (!closing && linkEnd === linkStart) return;

	const { consumed, eol } = matchWhileSpaceOrOneLineEnding(
		matchWhile,
		(closing ? 1 : 0) + linkEnd,
	);
	// Title must be separated by spaces
	if (consumed === linkEnd && !isEol(current(consumed))) return;

	const afterLink = current(consumed);
	let titleEnd: number | undefined, titleStart: number | undefined;
	const titleClose =
		afterLink === '(' ? ')' : afterLink === '"' || afterLink === "'" ? afterLink : '';

	if (titleClose) {
		titleStart = consumed;
		let p: string;
		titleEnd = matchEnclosed(
			c => {
				const r = c !== titleClose && !(c === '\n' && p === '\n');
				p = c;
				return r;
			},
			escape,
			titleStart + 1,
		);
		if (current(titleEnd++) !== titleClose) return;
	}
	const end = titleEnd ?? linkEnd;

	if (closing) {
		const trimmed = matchWhile(isSpace, end);
		if (current(trimmed) !== ')') return;
		return { titleEnd, titleStart, linkEnd, linkStart, linkClose: trimmed };
	}

	const spaces = matchWhile(isSpace, end);
	if (current(spaces) !== '\n' && current(spaces) !== '')
		return eol ? { linkEnd, linkStart } : undefined;
	return { titleEnd, titleStart, linkEnd, linkStart };
}

export function scannerInline(src: string) {
	const api = ScannerApi({
		source: src,
	});
	const {
		current,
		tk,
		matchWhile,
		backtrack,
		eof,
		matchEnclosed,
		matchUntil,
		skip,
	} = api;
	const { matchInline } = htmlScanner(api);

	function next() {
		if (eof()) return tk('eof', 0);

		let ch = current();

		switch (ch) {
			case '\\':
				if (current(1) === '\n') return tk('br', 2);
				break;
			case '`': {
				const start = matchWhile(n => n === ch);
				const len = start;
				const { consumed, blockEnd, blockStart } = matchBlock(
					api,
					ch,
					len,
					start,
					true,
					() => true,
				);
				if (blockEnd)
					return { ...tk('code', consumed), blockEnd, blockStart };

				// treat as text
				return tk('text', start + len);
			}
			case '_':
			case '*': {
				const count = matchWhile(n => n === ch);
				return { ...tk('delim', count), ch, count };
			}
			case '<': {
				// Scan Autolink
				const scheme = matchWhile(alphaDashPlus, 1);
				const type = current(scheme);
				if ((scheme - 1 > 1 && type === ':') || type === '@') {
					const host = matchWhile(
						n => n !== '>' && n !== ' ' && n !== '<',
						scheme + 1,
					);
					if (current(host) === '>')
						return { ...tk('autolink', host + 1), type };
				}
				// can it be HTML ?
				const maybeHtml = matchInline(1);
				if (maybeHtml) return tk('html', maybeHtml);

				return tk('text', scheme);
			}
			case '!':
			case '[': {
				const isImg = ch === '!';
				if (isImg && current(1) !== '[') return tk('text', 1);
				const linkTextStart = isImg ? 2 : 1;
				let depth = 0;
				let prev = '';
				const linkTextEnd = matchEnclosed(
					c => {
						const esc = prev === '\\';
						prev = esc ? '' : c;
						if (esc) return true;
						if (c === '[') {
							depth++;
							return true;
						}
						if (c === ']') {
							if (depth === 0) return false;
							depth--;
						}
						return true;
					},
					escape,
					linkTextStart,
				);
				if (current(linkTextEnd) !== ']') return tk('text', 1);

				const kind = isImg ? 'img' : 'a';
				const afterText = linkTextEnd + 1;
				if (current(afterText) === '(') {
					const result = matchLink(api, escape, afterText + 1, true);
					if (result) {
						return {
							...tk(
								kind,
								(result.linkClose ?? result.titleEnd ?? result.linkEnd) + 1,
							),
							linkTextEnd,
							linkTextStart,
							...result,
						};
					}
				}
				// Reference link: [foo][bar] (full) or [foo][] (collapsed)
				let end = afterText;
				let refStart = 0;
				let refEnd = 0;
				if (current(afterText) === '[') {
					const fullEnd = matchEnclosed(
						c => c !== ']',
						escape,
						afterText + 1,
					);
					if (current(fullEnd) === ']') {
						refStart = afterText + 1;
						refEnd = fullEnd;
						end = fullEnd + 1;
					}
				}
				return {
					...tk(kind, end),
					linkTextEnd,
					linkTextStart,
					refStart,
					refEnd,
					linkStart: 0,
					titleEnd: 0,
					titleStart: 0,
					linkEnd: 0,
				};
			}
		}

		const { indent, textStart } = countSpaces(matchWhile);
		ch = current(textStart);

		if (textStart >= 2 && ch === '\n') return tk('br', textStart + 1);

		if (indent >= 4) {
			if (ch !== '\n' && ch !== '') {
				const block = tk('tabsBlock', matchUntil(isEol, textStart));
				return { ...block, textStart, indent };
			}
		}

		let end = matchEnclosed(
			notStartInline,
			escape,
			(ch === '\n' ? 1 : 0) + textStart,
		);

		const last = current(end);
		let actualEnd = end;

		if (last === '\n' && current(end - 1) === '\\') {
			end -= 1;
			actualEnd--;
		}
		if (last === '\n' || last === '') {
			while (end > textStart && isSpace(current(end - 1))) end--;
			const token = tk('text', end);

			// Skip white if no hard break, or EOF
			if (
				last === '' ||
				actualEnd - end === 1 ||
				current(actualEnd) === '\\'
			)
				skip(actualEnd - end);
			return token;
		}

		return tk('text', end);
	}

	return { next, backtrack };
}

function matchWhileSpaceOrOneLineEnding(
	matchWhile: (fn: (c: string) => boolean, start: number) => number,
	start: number,
) {
	let eol = 0,
		spaces = 0;
	const consumed = matchWhile(c => {
		if (isSpace(c)) return spaces++, true;
		return c === '\n' && eol++ < 1;
	}, start);
	return { spaces, consumed, eol };
}

export function scannerBlock(src: string) {
	const api = ScannerApi({
		source: src,
	});
	const {
		current,
		tk,
		matchWhile,
		backtrack,
		eof,
		matchUntil,
		matchEnclosed,
	} = api;
	const { matchHtml } = htmlScanner(api);

	function thematicBreak(ch: string, n = 1) {
		const startSpaces = matchWhile(isSpace, n);
		let count = 1;
		let i = startSpaces;
		while (true) {
			i = matchWhile(isSpace, i);
			if (current(i) !== ch) break;
			count++;
			i++;
		}
		// Standard Markdown requires at least 3 chars, no other non-space before EOL
		const rest = matchWhile(isSpace, i);
		if (count >= 3 && (isEol(current(rest)) || current(rest) === '')) {
			return rest;
		}
	}

	function next() {
		if (eof()) return tk('eof', 0);

		// Spaces are significant
		const { textStart, indent } = countSpaces(matchWhile);
		const afterSpace = current(textStart);

		if (afterSpace === '\n') {
			let count = 0;
			let end = matchWhile(
				n => (n === '\n' ? (count++, true) : isSpace(n)),
				textStart,
			);
			while (current(end) !== '\n') end--;
			return { ...tk('eol', end + 1), count };
		}

		if (indent < 4 && (afterSpace === '`' || afterSpace === '~')) {
			const start = matchWhile(n => n === afterSpace, textStart);
			const len = start - textStart;
			const infoEnd = matchUntil(isEol, start);
			const infoHasBacktick =
				afterSpace === '`' &&
				matchWhile(c => c !== '`', start) < infoEnd;
			if (len >= 3 && !infoHasBacktick) {
				let match,
					found = false,
					firstStart = 0,
					consumed = start;
				do {
					match = matchBlock(
						api,
						afterSpace,
						len,
						consumed,
						false,
						(n, indent) =>
							(current(n) === '\n' || current(n) === '') &&
							indent < 4,
					);
					consumed = match.consumed;
					if (!found) firstStart = match.blockStart;
					if (eof(consumed)) break;
					else found = true;
				} while (!match.lineCount);

				if (match.lineCount && !(eof(consumed) && found)) {
					const { consumed, lineStart, blockEnd } = match;
					return {
						...tk('block', consumed),
						// Include the EOL marker if EOF not reached
						blockEnd: blockEnd ? lineStart + 1 : consumed,
						blockStart: firstStart,
						indent,
					};
				}
			}
		}

		if (indent >= 4) {
			const block = tk('tabsBlock', matchUntil(isEol, textStart));
			return {
				...block,
				textStart,
				indent,
				textIndent: indent,
				blockIndent: indent - 4,
				blockStart: textStart,
			};
		}

		if (digit(afterSpace)) {
			const markerEnd = matchWhile(digit, textStart + 1);
			const dot = current(markerEnd);
			if (
				markerEnd - textStart < 10 &&
				(dot === '.' || dot === ')') &&
				isSpaceOrEol(current(markerEnd + 1))
			) {
				const { indent: newIndent, textStart: start } = countSpaces(
					matchWhile,
					markerEnd + 1,
				);
				const markerLen = markerEnd - textStart + 1;
				const end = matchUntil(isEol, start);
				let blockIndent = indent + markerLen + 1;
				let textIndent = indent + markerLen + newIndent;

				if (current(start) === '\n') {
					textIndent++;
					blockIndent++;
				}

				return {
					...tk('ol', end),
					indent,
					textStart: start,
					blockStart: textStart,
					markerStart: textStart,
					dot,
					markerEnd,
					blockIndent:
						textIndent - blockIndent >= 4
							? blockIndent
							: textIndent,
					textIndent,
				};
			}
		}
		if (afterSpace === '*' || afterSpace === '-' || afterSpace === '_') {
			const result = thematicBreak(afterSpace);
			if (result) return { ...tk('hr', result), indent, textStart };
		}

		if (
			(afterSpace === '-' || afterSpace === '*' || afterSpace === '+') &&
			isSpaceOrEol(current(textStart + 1))
		) {
			const bullet = afterSpace;
			const { indent: afterIndent, textStart: start } = countSpaces(
				matchWhile,
				textStart + 1,
			);
			const blockStart = textStart;
			let textIndent = indent + 1 + afterIndent;
			let blockIndent = indent + 2;

			if (current(start) === '\n') {
				textIndent = 2;
				blockIndent = 2;
			}

			const end = matchUntil(isEol, start);

			return {
				...tk('li', end),
				indent,
				blockStart,
				textStart: start,
				bullet,
				textIndent,
				blockIndent:
					textIndent - blockIndent >= 4 ? blockIndent : textIndent,
			};
		}

		if (afterSpace === '#') {
			const end = matchWhile(isHash, textStart + 1);
			const start = matchWhile(isSpace, end);
			if (start > end || current(end) === '\n') {
				const level = end - textStart;
				if (level <= 6) {
					// Remove optional closing
					const headingEnd = matchUntil(isEol, start);
					let textEnd = headingEnd;
					while (isSpace(current(textEnd - 1))) textEnd--;
					const trailingSpace = textEnd;
					while (current(textEnd - 1) === '#') textEnd--;
					if (!isSpace(current(textEnd - 1))) textEnd = trailingSpace;
					else while (isSpace(current(textEnd - 2))) textEnd--;

					return {
						...tk('heading', headingEnd),
						level,
						textStart: start,
						textEnd,
						textIndent: 0,
					};
				}
			}
		}

		if (afterSpace === '[') {
			let hasLabel = false;
			const linkTextEnd = matchEnclosed(
				c => {
					if (c === ']' || c === '[') return false;
					if (!isSpaceOrEol(c)) hasLabel = true;
					return true;
				},
				escape,
				textStart + 1,
			);

			if (
				hasLabel &&
				current(linkTextEnd) === ']' &&
				current(linkTextEnd + 1) === ':'
			) {
				// Optional spaces including up to one line break
				const { consumed: start } = matchWhileSpaceOrOneLineEnding(
					matchWhile,
					linkTextEnd + 2,
				);

				const result = matchLink(api, escape, start);
				if (result)
					return {
						...tk('linkdef', result.titleEnd ?? result.linkEnd),
						...result,
						linkTextStart: textStart + 1,
						linkTextEnd,
					};
			}
		}

		if (afterSpace === '>') {
			const { textStart: newStart, indent: newIndent } = countSpaces(
				matchWhile,
				textStart + 1,
			);
			const hasSpace = textStart + 1 === newStart ? 0 : 1;
			const textIndent = indent + 2 + newIndent - hasSpace;

			return {
				...tk('blockquote', matchUntil(isEol, textStart + 1)),
				indent,
				textStart: newStart,
				textIndent,
				blockIndent: indent + 1 + hasSpace,
			};
		}

		if (afterSpace === '<') {
			const scheme = matchWhile(alphaDashPlus, textStart + 1);
			const after = current(scheme);
			// Ignore Autolink (scheme: or @ for email)
			if (after !== ':' && after !== '@') {
				const { end, isRule6 } = matchHtml(textStart + 1);
				if (end) return { ...tk('html', end), isRule6 };
			}
		}

		const textEnd = matchUntil(isEol);

		// Can it be setext?
		if (current(textEnd) === '\n') {
			const setextStart = matchWhile(isSpace, textEnd + 1);
			const startChar = current(setextStart);
			if (
				setextStart - textEnd - 1 < 4 &&
				(startChar === '=' || startChar === '-')
			) {
				const lineLen = matchWhile(
					c => c === startChar,
					setextStart + 1,
				);
				const trailing = matchWhile(isSpace, lineLen);
				if (current(trailing) === '\n')
					return {
						...tk('setext', trailing),
						level: startChar === '=' ? 1 : 2,
						length: trailing - setextStart,
						textStart,
						textEnd,
					};
			}
		}

		return {
			...tk('text', textEnd),
			indent,
			textIndent: indent,
			textStart,
			blockStart: 0,
			blockIndent: 0,
		};
	}

	return { next, backtrack };
}

function unescapeText(value: string) {
	return value.replace(/\\([\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1');
}

function normalizeLabel(s: string) {
	return s.toLowerCase().toUpperCase().replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
	return value.replace(/&#[Xx]([0-9a-fA-F]+);|&#([0-9]+);/g, (m, hex, dec) => {
		const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
		if (code > 0x10ffff) return m;
		return code === 0 ? '�' : String.fromCodePoint(code);
	});
}

function getLinkParts(
	token: Token<string> & {
		linkTextEnd: number;
		linkTextStart: number;
		linkEnd: number;
		linkStart: number;
		titleStart?: number;
		titleEnd?: number;
		refStart?: number;
		refEnd?: number;
	},
	linkRefs?: Record<string, LinkDefinition | undefined>,
): { href: string; title?: string } | undefined {
	const src = text(token);

	if (!token.linkEnd && linkRefs) {
		const refRaw =
			token.refStart && token.refEnd && token.refEnd > token.refStart
				? src.slice(token.refStart, token.refEnd)
				: src.slice(token.linkTextStart, token.linkTextEnd);
		const key = normalizeLabel(refRaw);
		if (!key) return undefined;
		const ref = linkRefs[key];
		return ref ? { href: ref.href, title: ref.title } : undefined;
	}
	let href = unescapeText(src.slice(token.linkStart, token.linkEnd));
	if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
	const title =
		token.titleStart !== undefined && token.titleEnd !== undefined
			? unescapeText(src.slice(token.titleStart + 1, token.titleEnd - 1))
			: undefined;
	return { title, href };
}

export function parserInline(
	api: ParserApi<InlineToken>,
	linkRefs: Record<string, LinkDefinition | undefined>,
) {
	const { current, parseWhile, next, backtrack } = api;

	let i = 0;

	function emphasisFlanking(token: InlineToken) {
		const n = token.source.charAt(token.end);
		const p = token.source.charAt(token.start - 1);
		const afterIsWhitespace = isUnicodeWhiteSpace(n);
		const afterIsPunct = uPunctuation.test(n);
		const beforeIsWhitespace = isUnicodeWhiteSpace(p);
		const beforeIsPunct = uPunctuation.test(p);
		const leftFlanking =
			!afterIsWhitespace &&
			(!afterIsPunct || beforeIsWhitespace || beforeIsPunct);
		const rightFlanking =
			!beforeIsWhitespace &&
			(!beforeIsPunct || afterIsWhitespace || afterIsPunct);
		return { leftFlanking, rightFlanking, afterIsPunct, beforeIsPunct };
	}
	function delimToText(d: NodeMap['delim']): NodeMap['text'] {
		return { ...d, kind: 'text', value: text(d) };
	}

	function resolveDelims(nodes: Node[]): Node[] {
		let i = 0;
		while (i < nodes.length) {
			const closer = nodes[i];
			if (!closer || closer.kind !== 'delim' || !closer.canClose) {
				i++;
				continue;
			}
			let matched = false;
			for (let j = i - 1; j >= 0; j--) {
				const opener = nodes[j];
				if (
					!opener ||
					opener.kind !== 'delim' ||
					!opener.canOpen ||
					opener.ch !== closer.ch
				)
					continue;
				if (
					(opener.canClose || closer.canOpen) &&
					(opener.count + closer.count) % 3 === 0 &&
					!(opener.count % 3 === 0 && closer.count % 3 === 0)
				)
					continue;
				const n = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
				const inner = nodes
					.slice(j + 1, i)
					.map(x => (x.kind === 'delim' ? delimToText(x) : x));
				const wrapped = {
					kind: n === 2 ? 'strong' : 'em',
					children: inner,
					source: opener.source,
					line: opener.line,
					start: opener.end - n,
					end: closer.start + n,
				} as NodeMap['strong'] | NodeMap['em'];
				const repl: Node[] = [];
				if (opener.count - n > 0)
					repl.push({
						...opener,
						count: opener.count - n,
						end: opener.end - n,
					});
				repl.push(wrapped);
				if (closer.count - n > 0)
					repl.push({
						...closer,
						count: closer.count - n,
						start: closer.start + n,
					});
				nodes.splice(j, i - j + 1, ...repl);
				i = j + repl.length - 1;
				matched = true;
				break;
			}
			if (!matched) i++;
		}
		return nodes.map(x => (x.kind === 'delim' ? delimToText(x) : x));
	}

	function inline(): Node | undefined {
		const token = current();

		i++;

		switch (token.kind) {
			case 'eof':
				return;
			case 'code': {
				const tokenText = text(token)
					.slice(token.blockStart, token.blockEnd)
					.replace(/\n/g, ' ');
				const value =
					tokenText.length > 2 &&
					tokenText.startsWith(' ') &&
					tokenText.endsWith(' ')
						? tokenText.slice(1, -1)
						: tokenText;

				next();
				return { ...token, kind: 'code', value } as const;
			}
			case 'delim': {
				const { leftFlanking, rightFlanking, beforeIsPunct, afterIsPunct } =
					emphasisFlanking(token);
				const canOpen =
					token.ch === '_'
						? leftFlanking && (!rightFlanking || beforeIsPunct)
						: leftFlanking;
				const canClose =
					token.ch === '_'
						? rightFlanking && (!leftFlanking || afterIsPunct)
						: rightFlanking;
				next();
				return { ...token, canOpen, canClose };
			}
			case 'text': {
				const value = unescapeText(text(token));
				const result = {
					...token,
					value: i === 1 ? value.trimStart() : value,
				};
				let nextToken = next();
				while (nextToken.kind === 'text') {
					result.value += unescapeText(text(nextToken));
					result.end = nextToken.end;
					nextToken = next();
				}
				result.value = result.value.replace(/[ \t]+\n/g, '\n');
				return result;
			}
			case 'tabsBlock': {
				const blockIndent = token.indent;
				const spaces = blockIndent - 4;
				next();
				// We need to calculate the leading spaces, based on indentation.
				return {
					...token,
					kind: 'block',
					value:
						' '.repeat(spaces) +
						text(token).slice(token.textStart) +
						'\n',
				} as const;
			}
			case 'br':
				next();
				return token;
			case 'autolink': {
				const src = text(token).slice(1, -1);
				const href = (token.type === '@' ? 'mailto:' : '') + src;
				next();
				return {
					...token,
					kind: 'a',
					href,
					children: [{ ...token, kind: 'text', value: src }],
				};
			}
			case 'img':
			case 'a': {
				const kind = token.kind;
				const parts = getLinkParts(token, linkRefs);
				if (
					!parts &&
					kind === 'a' &&
					'refStart' in token &&
					'refEnd' in token &&
					token.refEnd > token.refStart
				) {
					const src = text(token);
					const afterX = token.linkTextEnd + 1;
					const xEnd = token.start + afterX;
					backtrack({ ...token, end: xEnd });
					next();
					return {
						...token,
						kind: 'text',
						value: unescapeText(src.slice(0, afterX)),
						end: xEnd,
					};
				}
				if (
					!parts &&
					kind === 'a' &&
					'refEnd' in token &&
					token.refEnd === 0 &&
					token.linkTextEnd > token.linkTextStart
				) {
					const xEnd = token.start + 1;
					backtrack({ ...token, end: xEnd });
					next();
					return {
						...token,
						kind: 'text',
						value: '[',
						end: xEnd,
					};
				}
				if (parts && kind === 'a' && precedenceOverridesLink(token)) {
					const xEnd = token.start + 1;
					backtrack({ ...token, end: xEnd });
					next();
					return {
						...token,
						kind: 'text',
						value: '[',
						end: xEnd,
					};
				}
				next();
				if (!parts) {
					return {
						...token,
						kind: 'text',
						value: unescapeText(text(token)),
					};
				}
				const linkApi = ParserApi(scannerInline);
				linkApi.start(
					text(token).slice(token.linkTextStart, token.linkTextEnd),
				);
				const children = parserInline(linkApi, linkRefs);
				if (kind === 'a' && hasLink(children)) {
					const src = text(token);
					const bracketEnd = token.linkTextEnd + 1;
					const xEnd = token.start + bracketEnd;
					backtrack({ ...token, end: xEnd });
					next();
					return {
						...token,
						kind: 'text',
						value: '',
						end: xEnd,
						children: [
							{
								...token,
								kind: 'text',
								value: unescapeText(
									src.slice(0, token.linkTextStart),
								),
							},
							...children,
							{
								...token,
								kind: 'text',
								value: unescapeText(
									src.slice(token.linkTextEnd, bracketEnd),
								),
							},
						],
					};
				}
				return { ...token, kind, ...parts, children };
			}
			case 'html':
				next();
				return { ...token, block: false };
		}
	}

	return resolveDelims(parseWhile(inline));
}

function parserBlock(
	api: ParserApi<BlockToken>,
	isRoot = false,
	defer: NodeMap['text'][] = [],
	linkDefinitions: Record<string, LinkDefinition | undefined> = {},
) {
	function parseInline() {
		const api = ParserApi(scannerInline);

		for (const node of defer) {
			api.start(node.value);
			node.children = parserInline(api, linkDefinitions);
		}
	}

	function storeLinkDef(tok: Extract<BlockToken, { kind: 'linkdef' }>) {
		const parts = getLinkParts(tok);
		if (!parts) return;
		const rawLabel = tok.source.slice(
			tok.start + tok.linkTextStart,
			tok.start + tok.linkTextEnd,
		);
		const key = normalizeLabel(rawLabel);
		if (key) linkDefinitions[key] ??= { ...parts, children: [] };
	}

	function textNode(
		token: BlockToken,
		offset = 0,
		prefix = '',
		offsetEnd?: number,
	) {
		const node: NodeMap['text'] = {
			...token,
			start: token.start + offset,
			kind: 'text',
			value: prefix + text(token).slice(offset, offsetEnd),
		};
		defer.push(node);
		return node;
	}

	function p(parentToken: BlockToken, child = textNode(parentToken)) {
		let newChild: Node | undefined;

		for (;;) {
			const token = next();
			if (token.kind === 'eol' && token.count === 1) {
				const nextToken = next();

				if (nextToken.kind === 'ol') {
					const bulletOrder = (+nextToken.source.slice(
						nextToken.start + nextToken.markerStart,
						nextToken.start + nextToken.markerEnd,
					)).toString();
					if (
						bulletOrder !== '1' ||
						// Empty lists cannot interrupt paragraphs
						nextToken.textStart +
							nextToken.start -
							nextToken.end ===
							0
					) {
						child.value += '\n' + text(nextToken);
						continue;
					}
				} else if (
					nextToken.kind === 'li' &&
					text(nextToken).length === 1
				) {
					// Empty lists cannot interrupt paragraphs
					child.value += '\n' + text(nextToken);
					continue;
				} else if (nextToken.kind === 'setext') {
					// setext not allowed inside blocks
					if (!isRoot) {
						next();
						child.value += '\n' + text(nextToken);
						continue;
					} else if (parentToken.kind === 'text') {
						next();
						child.value +=
							'\n' +
							nextToken.source.slice(
								nextToken.start + nextToken.textStart,
								nextToken.start + nextToken.textEnd,
							);

						if (child.value) {
							// Need to trim the start and end of each line
							child.value = child.value.replace(
								/^\s*([^\n]+?)\s*$/gm,
								'$1',
							);
							newChild = {
								...nextToken,
								start: child.start,
								kind: 'heading',
								children: [child],
							};
						} else {
							child.value += text(nextToken);
						}
					} else {
						//thematic break?
						if (nextToken.level === 1)
							child.value += '\n' + text(nextToken);
						else break;
					}
					continue;
				} else if (nextToken.kind === 'text') {
					nextToken.start = token.start;
					child.value += text(nextToken).replace(
						/^[\t ]*([^\n]+?)$/gm,
						'$1',
					);
					continue;
				} else if (nextToken.kind === 'tabsBlock') {
					child.value +=
						'\n' + text(nextToken).slice(nextToken.textStart);
					continue;
				} else if (nextToken.kind === 'linkdef') {
					child.value += '\n' + text(nextToken);
					continue;
				} else if (
					nextToken.kind === 'html' &&
					!nextToken.isRule6
				) {
					child.value += '\n' + text(nextToken);
					continue;
				}
			}
			backtrack(token);
			break;
		}

		if (newChild) return newChild;

		const node: NodeMap['p'] = {
			...parentToken,
			kind: 'p',
			children: [child],
		};
		return node;
	}

	function li(bullet: string): NodeMap['li'] | undefined {
		const liToken = current();
		if (liToken.kind !== 'li' || liToken.bullet !== bullet) return;

		return blockContainer(liToken, true);
	}

	function ul(token: Token<'li'> & { bullet: string }): NodeMap['ul'] {
		const bullet = token.bullet;
		const children = parseWhile(() => li(bullet));
		return {
			...token,
			kind: 'ul',
			children,
			loose: isLoose(children),
		};
	}

	function ol(token: Token<'ol'>): NodeMap['ol'] {
		let listBullet;
		let listStart: string | undefined;

		const children = parseWhile(() => {
			const liToken = current();
			if (liToken.kind !== 'ol') return;
			const bullet = liToken.dot;
			listBullet ??= bullet;
			if (bullet !== listBullet) return;

			const bulletOrder = (+liToken.source.slice(
				liToken.start + liToken.markerStart,
				liToken.start + liToken.markerEnd,
			)).toString();
			listStart ??= bulletOrder;

			return blockContainer(
				{
					...liToken,
					kind: 'li',
					bullet,
					bulletOrder,
				},
				true,
			);
		});

		return {
			...token,
			kind: 'ol',
			children,
			loose: isLoose(children),
			listStart,
		};
	}

	function normalizeBlock(block: NodeMap['block'], indent: number) {
		block.value = block.value
			.replace(/^\t+/gm, m => '    '.repeat(m.length))
			.replace(new RegExp(`^[ \t]{1,${indent}}`, 'gm'), '');
	}

	function tabsBlock(
		token: Extract<BlockToken, { textStart: number; indent: number }>,
		minIndent = 4,
	) {
		const node: NodeMap['block'] = {
			...token,
			kind: 'block',
			value: text(token),
		};
		let nextToken = current();

		while (nextToken.kind === 'eol') {
			const maybeBlock = next();
			if (maybeBlock.kind === 'li' && maybeBlock.indent >= 4) {
				const eolText = text(nextToken);
				if (maybeBlock.indent < minIndent)
					minIndent = maybeBlock.indent;
				node.value +=
					eolText + text(maybeBlock).slice(maybeBlock.blockStart);
				node.end = maybeBlock.end;
				nextToken = next();
			} else if (maybeBlock.kind === 'tabsBlock') {
				const eolText = text(nextToken);
				if (maybeBlock.indent < minIndent)
					minIndent = maybeBlock.indent;
				node.value += eolText + text(maybeBlock);
				node.end = maybeBlock.end;
				nextToken = next();
			} else {
				node.value += '\n';
				break;
			}
		}

		normalizeBlock(node, minIndent);

		return node;
	}

	function mergeBlock(
		indent: number,
		{
			source,
			start,
			textStart,
			end,
		}: Extract<BlockToken, { textStart: number }>,
		newStart?: number,
	) {
		return (
			' '.repeat(indent) +
			source.slice(start + (newStart ?? textStart), end)
		);
	}

	function isPartOfBlock(parent: InlineBlockToken, child: InlineBlockToken) {
		return child.kind === 'li' || child.kind === 'ol'
			? child.indent >= parent.blockIndent
			: child.textIndent >= parent.blockIndent;
	}

	function blockContainer<T extends InlineBlockToken>(
		token: T,
		allowP = false,
	) {
		const content: string[] = [
			' '.repeat(token.textIndent - token.blockIndent) +
				token.source.slice(token.start + token.textStart, token.end),
		];
		let pCount = 0;
		let prevEmptyBq = false;

		for (;;) {
			const nextToken = next();
			if (nextToken.kind !== 'eol') break;

			if (nextToken.count === 1) {
				const bq = next();
				content.push('\n');

				if (bq.kind === 'blockquote') {
					token.end = bq.end;
					content.push(
						allowP
							? bq.source.slice(bq.start + bq.indent, bq.end)
							: mergeBlock(
									bq.textIndent - bq.blockIndent,
									bq,
								),
					);
					prevEmptyBq = bq.textStart === bq.end - bq.start;
				} else if (
					bq.kind === 'tabsBlock' ||
					bq.kind === 'li' ||
					bq.kind === 'ol'
				) {
					const continues =
						bq.kind === 'tabsBlock'
							? allowP
							: isPartOfBlock(token, bq);
					if (continues) {
						token.end = bq.end;
						content.push(
							mergeBlock(
								Math.max(bq.indent - token.blockIndent, 0),
								bq,
								bq.blockStart,
							),
						);
						prevEmptyBq = false;
					} else {
						backtrack(bq);
						break;
					}
				} else if (bq.kind === 'hr') {
					if (bq.indent >= token.blockIndent) {
						token.end = bq.end;
						content.push(
							' '.repeat(bq.indent - token.blockIndent) +
								bq.source.slice(
									bq.start + bq.textStart,
									bq.end,
								),
						);
						prevEmptyBq = false;
					} else {
						backtrack(bq);
						break;
					}
				} else if (
					bq.kind === 'text' ||
					(bq.kind === 'setext' && bq.level === 1)
				) {
					if (prevEmptyBq) {
						backtrack(bq);
						break;
					}
					// Lazy continuation
					token.end = bq.end;
					const strip =
						bq.kind === 'text'
							? Math.min(token.blockIndent, bq.textStart)
							: 0;
					content.push(bq.source.slice(bq.start + strip, bq.end));
				} else if (bq.kind === 'block' && bq.indent >= token.blockIndent) {
					token.end = bq.end;
					content.push(
						text(bq).replace(
							new RegExp(
								`^[ \\t]{1,${token.blockIndent}}`,
								'gm',
							),
							'',
						),
					);
				} else {
					backtrack(bq);
					break;
				}
			} else if (allowP) {
				const bq = next();
				const backtrackOnFail =
					bq.kind === 'li' || bq.kind === 'ol' ? bq : nextToken;
				if (
					token.end - token.start > 1 &&
					(bq.kind === 'tabsBlock' ||
						bq.kind === 'li' ||
						bq.kind === 'ol' ||
						bq.kind === 'text') &&
					isPartOfBlock(token, bq)
				) {
					token.end = bq.end;
					const newStart =
						bq.kind === 'text'
							? Math.min(token.blockIndent, bq.textStart)
							: bq.blockStart;
					content.push(
						text(nextToken),
						mergeBlock(
							Math.max(bq.indent - token.blockIndent, 0),
							bq,
							newStart,
						),
					);
				} else if (bq.kind === 'linkdef') {
					storeLinkDef(bq);
					token.end = bq.end;
					pCount = 1;
				} else {
					pCount = 1;
					backtrack(backtrackOnFail);
					break;
				}
			} else {
				content.push('\n');
				break;
			}
		}
		const api = ParserApi(scannerBlock);
		api.start(content.join(''));
		const root = parserBlock(api, false, defer, linkDefinitions);
		return {
			...token,
			children: root.children,
			pCount: root.pCount === 2 ? 2 : pCount,
		};
	}

	function top() {
		const token = current();

		switch (token.kind) {
			case 'heading': {
				const node: NodeMap['heading'] = {
					...token,
					children: [
						textNode(token, token.textStart, '', token.textEnd),
					],
				};
				next();
				return node;
			}
			case 'block': {
				const tokenText = text(token).slice(
					token.blockStart,
					token.blockEnd,
				);
				const langMatch = /^(.+)/.exec(tokenText);
				const info = langMatch?.[1];
				// + 1 to remove EOL
				let value = tokenText.slice((langMatch?.[0].length ?? 0) + 1);

				if (value && !value.endsWith('\n')) value += '\n';

				if (token.indent) {
					// Remove intentation if present in opening block
					value = value.replace(
						new RegExp(`^\\s{1,${token.indent}}`, 'gm'),
						'',
					);
				}
				next();
				return { ...token, kind: 'block', info, value } as const;
			}
			case 'blockquote':
				return blockContainer(token);
			case 'tabsBlock':
				next();
				return tabsBlock(token);
			case 'html':
				next();
				return { ...token, block: true };
			case 'li':
				return ul(token);
			case 'ol':
				return ol(token);
			case 'hr':
				next();
				return token;
			case 'linkdef': {
				storeLinkDef(token);
				next();
				return top();
			}
			case 'eol': {
				if (token.count > 1) pCount = 2;
				next();
				return { ...token, kind: 'text', value: '' } as const;
			}
			case 'setext': {
				next();
				return {
					...token,
					kind: 'heading',
					children: [
						textNode(token, token.textStart, '', token.textEnd),
					],
				} as NodeMap['heading'];
			}
			case 'eof':
				return;
			case 'text':
				break;
		}

		return p(token);
	}

	const { current, node: createNode, parseWhile, next, backtrack } = api;
	let pCount = 0;

	const root: NodeMap['root'] = {
		...createNode('root'),
		children: parseWhile(top),
		linkDefinitions,
		pCount,
	};

	if (isRoot) parseInline();

	return root;
}

function renderChildren(children: Node[], tag?: string) {
	const text = children.map(compiler).join('');
	return tag ? `<${tag}>${text}</${tag}>` : text;
}

function escapeHtml(str: string) {
	return str.replace(/[&<>"]/g, c => {
		switch (c) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
		}
		return '&quot;';
	});
}

function precedenceOverridesLink(token: {
	source: string;
	start: number;
	linkTextStart: number;
	linkTextEnd: number;
}): boolean {
	const ltStart = token.start + token.linkTextStart;
	const ltEnd = token.start + token.linkTextEnd;
	const linkText = token.source.slice(ltStart, ltEnd);
	const after = token.source.slice(ltEnd);
	const backticksInText = (linkText.match(/`/g) || []).length;
	if (backticksInText % 2 === 1 && after.includes('`')) return true;
	const lt = (linkText.match(/</g) || []).length;
	const gt = (linkText.match(/>/g) || []).length;
	if (lt > gt && after.includes('>')) return true;
	return false;
}

function isLoose(children: { pCount: number }[]) {
	return children.some(
		(child, i) =>
			child.pCount === 2 ||
			(child.pCount === 1 && i !== children.length - 1),
	);
}

function hasLink(nodes: Node[]): boolean {
	return nodes.some(
		n =>
			n.kind === 'a' ||
			('children' in n && n.children && hasLink(n.children)),
	);
}

function plainText(nodes: Node[]): string {
	return nodes
		.map(n => {
			if ('children' in n && n.children) return plainText(n.children);
			if (n.kind === 'text') return n.value;
			return '';
		})
		.join('');
}

function renderList(node: NodeMap['ul'] | NodeMap['ol']) {
	const result = [];
	for (const li of node.children) {
		if (li.kind !== 'li') break;
		if (node.loose) result.push(renderChildren(li.children, li.kind));
		else {
			const children: string = li.children
				.map(n =>
					n.kind === 'p' ? renderChildren(n.children) : compiler(n),
				)
				.join('');
			result.push(`<${li.kind}>${children}</${li.kind}>`);
		}
	}

	return result.join('');
}

export function compiler(node: Node): string {
	switch (node.kind) {
		case 'root': {
			const str = renderChildren(node.children);
			return str ? (str.endsWith('\n') ? str : str + '\n') : '';
		}
		case 'hr':
			return `<${node.kind} />`;
		case 'br':
			return `<${node.kind} />\n`;
		case 'code': {
			return `<code>${escapeHtml(node.value)}</code>`;
		}
		case 'img': {
			const title = node.title
				? ` title="${escapeHtml(node.title)}"`
				: '';
			const alt = plainText(node.children);
			return `<img src="${escapeHtml(
				encodeURI(node.href),
			)}" alt="${escapeHtml(alt)}"${title} />`;
		}
		case 'a': {
			const title = node.title
				? ` title="${escapeHtml(node.title)}"`
				: '';
			return `<a href="${escapeHtml(
				encodeURI(node.href),
			)}"${title}>${renderChildren(node.children)}</a>`;
		}
		case 'ol': {
			const start = node.listStart;
			const startStr = start && start !== '1' ? ` start="${start}"` : '';
			return `<ol${startStr}>${renderList(node)}</ol>`;
		}
		case 'blockquote': {
			const value = renderChildren(node.children);
			return `<blockquote>${value || '\n'}</blockquote>`;
		}
		case 'em':
		case 'strong':
		case 'p':
			return renderChildren(node.children, node.kind);
		case 'ul':
			return `<ul>${renderList(node)}</ul>`;
		case 'heading':
			return renderChildren(node.children, `h${node.level}`);
		case 'block': {
			const lang = node.info && /\s*([^\s]+)/.exec(node.info);
			const cls = lang?.[1]
				? ` class="language-${unescapeText(lang[1])}"`
				: '';
			return `<pre><code${cls}>${escapeHtml(node.value)}</code></pre>`;
		}
		case 'text':
			return node.children
				? renderChildren(node.children)
				: escapeHtml(decodeEntities(node.value));
		case 'html':
			return (
				text(node) +
				(node.block && node.end < node.source.length - 1 ? '\n' : '')
			);
		default:
			return '';
	}
}

export function program() {
	const api = ParserApi(scannerBlock);

	function parse(src: string) {
		api.start(src);
		const root = parserBlock(api, true);
		return { root, errors: api.errors };
	}

	function compile(src: string) {
		const parsed = parse(src);
		return {
			output: compiler(parsed.root),
			ast: parsed.root,
			errors: parsed.errors,
		};
	}

	return {
		compile,
		parse,
	};
}

export function render(src: string) {
	const md = program();
	return md.compile(src).output;
}
