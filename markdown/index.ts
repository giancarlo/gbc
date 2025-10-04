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
export type LinkDefinition = { href: string; text: string; title?: string };

const isEol = (c: string) => c === '\n';
const isSpace = (c: string) => c === ' ' || c === '\t';
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
	ch !== '[';
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

// turn to matchDelimitedBlock api
// Optimize this..
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

		while ((ch = current(tagNameEnd)) && alphaDash(ch)) {
			tagName += ch;
			tagNameEnd++;
		}

		return { tagNameEnd, tagName };
	}

	function matchTag(start: number, oneLine = false) {
		let ch = current(start);
		const isClosingTag = ch === '/';
		if (isClosingTag) ch = current(start++);

		const { tagNameEnd, tagName } = matchTagName(start);
		if (!tagName) return;

		const isRule6 = htmlRule6.test(tagName);
		const skipSpaces = matchWhile(isSpace, tagNameEnd);
		const afterTag = current(skipSpaces);

		if (afterTag === '>')
			return { tagName, tagEnd: skipSpaces + 1, isClosingTag, isRule6 };
		else if (isClosingTag) {
			return;
		}

		let p = '';
		let tagEnd = matchWhile(c => {
			const r =
				c !== '>' &&
				(oneLine && !isRule6
					? c !== '\n'
					: !(c === '\n' && p === '\n'));
			p = c;
			return r;
		}, tagNameEnd + 1);

		if (oneLine && eof(tagEnd))
			return { tagName, tagEnd: tagEnd - 1, isClosingTag, isRule6 };

		return current(tagEnd++) === '>'
			? { tagName, tagEnd, isClosingTag, isRule6 }
			: 0;
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

		const { tagName, tagEnd, isClosingTag } = openTag;
		if (eof(tagEnd)) return tagEnd;

		if (!openTag.isRule6) {
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
	return { matchHtml, matchInline };
}

function matchLink(
	{ matchEnclosed, current, matchWhile }: ReturnType<typeof ScannerApi>,
	escape: (n: number) => boolean,
	linkStart: number,
	closing?: boolean,
) {
	const linkEnd =
		current(linkStart) === '<'
			? matchEnclosed(
					c => c !== '>' && c !== '\n',
					escape,
					linkStart + 1,
			  ) + 1
			: matchEnclosed(
					c =>
						(!closing || c !== ')') &&
						c !== ' ' &&
						c !== '\t' &&
						c !== '\n',
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

	if (afterLink === '"' || afterLink === "'") {
		// possible title
		titleStart = consumed;
		let p: string;
		titleEnd = matchEnclosed(
			c => {
				const r = c !== afterLink && !(c === '\n' && p === '\n');
				p = c;
				return r;
			},
			escape,
			titleStart + 1,
		);
		if (current(titleEnd++) !== afterLink) return;
	}
	const end = titleEnd === undefined ? linkEnd : titleEnd;

	if (!closing) {
		const spaces = matchWhile(isSpace, end);
		// If the title is in a different line, the link can still be valid.
		if (current(spaces) !== '\n' && current(spaces) !== '')
			return eol ? { linkEnd, linkStart } : undefined;
	}

	if (!closing || current(end) === ')')
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

	const escape = (i: number) =>
		current(i) !== '\n' &&
		current(i - 1) === '\\' &&
		current(i - 2) !== '\\';

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
				const la = current(1);
				const len = la === ch ? 2 : 1;

				return len === 1 ? tk('em', 1) : tk('strong', 2);
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
					// Check for invalid URL
					if (current(host) === '>')
						return { ...tk('autolink', host + 1), type };
				}
				// can it be HTML ?
				const maybeHtml = matchInline(1);
				if (maybeHtml) return tk('html', maybeHtml);

				return tk('text', scheme);
			}
			case '!': {
				if (current(1) === '[') {
					const linkTextEnd = matchEnclosed(
						c => c !== ']',
						escape,
						1,
					);
					if (current(linkTextEnd) === ']') {
						const result =
							current(linkTextEnd + 1) === '('
								? matchLink(api, escape, linkTextEnd + 2, true)
								: undefined;

						if (result) {
							return {
								...tk(
									'img',
									(result.titleEnd ?? result.linkEnd) + 1,
								),
								linkTextEnd,
								linkTextStart: 2,
								...result,
							};
						} else {
							// Possible link reference
							return {
								...tk('img', linkTextEnd + 1),
								linkTextEnd,
								linkTextStart: 2,
								linkStart: 0,
								titleEnd: 0,
								titleStart: 0,
								linkEnd: 0,
							};
						}
					}
				}

				return tk('text', 1);
			}
			case '[': {
				const linkTextEnd = matchEnclosed(c => c !== ']', escape, 1);
				if (current(linkTextEnd) === ']') {
					if (current(linkTextEnd + 1) === '(') {
						const result = matchLink(
							api,
							escape,
							linkTextEnd + 2,
							true,
						);

						if (result) {
							return {
								...tk(
									'a',
									(result.titleEnd ?? result.linkEnd) + 1,
								),
								linkTextEnd,
								linkTextStart: 1,
								...result,
							};
						}
					} else {
						// Possible link reference
						return {
							...tk('a', linkTextEnd + 1),
							linkTextEnd,
							linkTextStart: 1,
							linkStart: 0,
							titleEnd: 0,
							titleStart: 0,
							linkEnd: 0,
						};
					}
				}

				return tk('text', 1);
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

	const escape = (i: number) =>
		current(i) !== '\n' &&
		current(i - 1) === '\\' &&
		current(i - 2) !== '\\';

	function thematicBreak(ch: string, n = 1) {
		const startSpaces = matchWhile(isSpace, n);
		let count = 1;
		let i = startSpaces;
		while (true) {
			// Accept spaces/tabs
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
			if (len >= 3) {
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
		// setext
		/*if (current(-1)) {
			const startChar = current(textStart);
			if (startChar === '=' || startChar === '-') {
				const lineLen = matchWhile(c => c === startChar, textStart + 1);
				const trailing = matchWhile(isSpace, lineLen);
				if (current(trailing) === '\n')
					return {
						...tk('setext', trailing),
						level: startChar === '=' ? 1 : 2,
						length: trailing - textStart,
					};
			}
		}*/

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
			const linkTextEnd = matchEnclosed(
				c => c !== ']',
				escape,
				textStart + 1,
			);

			if (
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
				/*level,*/
				textStart: newStart,
				textIndent,
				blockIndent: indent + 1 + hasSpace,
			};
		}

		// heading takes precedence
		if (afterSpace === '<') {
			const scheme = matchWhile(alpha, textStart + 1);
			// Ignore Autolink
			if (current(scheme) !== ':') {
				const maybeHtml = matchHtml(textStart + 1, true);
				if (maybeHtml) return tk('html', maybeHtml);
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

/**
 * - Replace all escaped characters with their appropriate text values
 */
function unescapeText(value: string) {
	return value.replace(/\\([\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1');
}

function getLinkParts(
	token: Token<string> & {
		linkTextEnd: number;
		linkTextStart: number;
		linkEnd: number;
		linkStart: number;
		titleStart?: number;
		titleEnd?: number;
	},
	linkRefs?: Record<string, LinkDefinition | undefined>,
) {
	const src = text(token);
	const content = unescapeText(
		src.slice(token.linkTextStart, token.linkTextEnd),
	);

	if (!token.linkEnd && linkRefs) {
		const ref = linkRefs[content.toLowerCase()];
		return ref ? { ...ref, text: content } : undefined;
	}
	let href = unescapeText(src.slice(token.linkStart, token.linkEnd));
	if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
	const title =
		token.titleStart !== undefined && token.titleEnd !== undefined
			? unescapeText(src.slice(token.titleStart + 1, token.titleEnd - 1))
			: undefined;
	return { title, href, text: content };
}

export function parserInline(
	api: ParserApi<InlineToken>,
	linkRefs: Record<string, LinkDefinition | undefined>,
) {
	const { current, parseWhile, next, backtrack } = api;

	let i = 0;

	function isEmphasisStart(token: InlineToken, ch: string) {
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

		return ch === '_'
			? leftFlanking && (!rightFlanking || beforeIsPunct)
			: leftFlanking;
	}
	function isEmphasisEnd(token: InlineToken, ch: string) {
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

		return ch === '_'
			? rightFlanking && (!leftFlanking || afterIsPunct)
			: rightFlanking;
	}

	function inline(): Node | undefined {
		const token = current();

		i++;

		switch (token.kind) {
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
			case 'em':
			case 'strong': {
				const ch = token.source.charAt(token.start);

				if (isEmphasisStart(token, ch)) {
					let found = false;
					next();
					const children: Node[] = parseWhile(() => {
						const newToken = current();

						if (
							newToken.kind === token.kind &&
							newToken.source.charAt(newToken.start) === ch &&
							isEmphasisEnd(newToken, ch)
						) {
							found = true;
							return;
						}
						return inline();
					});
					if (found && children.length) {
						next();
						return { ...token, children } as const;
					}
				}

				backtrack(token);
				next();
				return { ...token, kind: 'text', value: text(token) };
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
				return { ...token, kind: 'a', href, text: src };
			}
			case 'img': {
				const parts = getLinkParts(token, linkRefs);
				next();
				return parts
					? { ...token, kind: 'img', ...parts }
					: { ...token, kind: 'text', value: text(token) };
			}
			case 'a': {
				const parts = getLinkParts(token, linkRefs);
				next();
				return parts
					? { ...token, kind: 'a', ...parts }
					: { ...token, kind: 'text', value: text(token) };
			}
			case 'html':
				next();
				return { ...token, block: false };
		}
	}

	return parseWhile(inline);
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

		while (child) {
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
		const loose = !!children.find((child, i) => {
			if (child.pCount === 2) return true;
			else if (child.pCount === 1 && children.length - 1 !== i)
				return true;
		});

		return {
			...token,
			kind: 'ul',
			children,
			loose, //: pCount === 1 ? children.length > 1 : pCount === 2,
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

		const loose = !!children.find((child, i) => {
			if (child.pCount === 2) return true;
			else if (child.pCount === 1 && children.length - 1 !== i)
				return true;
		});

		return {
			...token,
			kind: 'ol',
			children,
			loose, //: pCount === 1 ? children.length > 1 : pCount === 2,
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
		// collect all
		const content: string[] = [
			' '.repeat(token.textIndent - token.blockIndent) +
				token.source.slice(token.start + token.textStart, token.end),
		];
		let pCount = 0;

		while (token) {
			const nextToken = next();
			if (nextToken.kind !== 'eol') break;

			if (nextToken.count === 1) {
				const bq = next();
				content.push('\n');

				if (bq.kind === 'blockquote') {
					token.end = bq.end;
					content.push(
						mergeBlock(bq.textIndent - bq.blockIndent, bq),
					);
				} else if (
					bq.kind === 'tabsBlock' ||
					bq.kind === 'li' ||
					bq.kind === 'ol'
				) {
					if (bq.kind === 'tabsBlock' || isPartOfBlock(token, bq)) {
						token.end = bq.end;
						content.push(
							mergeBlock(
								Math.max(bq.indent - token.blockIndent, 0),
								bq,
								bq.blockStart,
							),
						);
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
					} else {
						backtrack(bq);
						break;
					}
				} else if (
					bq.kind === 'text' ||
					(bq.kind === 'setext' && bq.level === 1)
				) {
					// Lazy continuation
					token.end = bq.end;
					content.push(text(bq));
				} else {
					backtrack(bq);
					break;
				}
			} else if (allowP) {
				const bq = next();
				pCount = 1;
				if (
					token.end - token.start > 1 &&
					(bq.kind === 'tabsBlock' ||
						bq.kind === 'li' ||
						bq.kind === 'ol' ||
						bq.kind === 'text')
				) {
					if (isPartOfBlock(token, bq)) {
						token.end = bq.end;
						content.push(
							text(nextToken),
							mergeBlock(
								Math.max(bq.indent - token.blockIndent, 0),
								bq,
								bq.blockStart,
							),
						);
					} else {
						backtrack(bq);
						break;
					}
				} else {
					backtrack(bq);
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
				const parts = getLinkParts(token);
				if (parts) linkDefinitions[parts.text.toLowerCase()] ??= parts;
				next();
				return top();
			}
			case 'eol': {
				if (token.count > 1) pCount = 2;
				next();
				return { ...token, kind: 'text', value: '' } as const;
				/*const after = next();
				if (after.kind === 'eof') return;
				return top();*/
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
			return str ? str + '\n' : '';
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
			return `<img src="${encodeURI(
				escapeHtml(node.href),
			)}" alt="${escapeHtml(node.text)}"${title} />`;
		}
		case 'a': {
			const title = node.title
				? ` title="${escapeHtml(node.title)}"`
				: '';
			return `<a href="${encodeURI(
				escapeHtml(node.href),
			)}"${title}>${escapeHtml(node.text)}</a>`;
		}
		case 'ol': {
			//const firstLi = node.children[0];
			/*if (firstLi.kind === 'li') {
				const start = firstLi?.bulletOrder;
				const startStr =
					start && start !== '1' ? ` start="${start}"` : '';
				return `<ol${startStr}>${renderChildren(node.children)}</ol>`;
			}*/
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
		/*case 'li':
			/*if (node.pCount === 0) {
				const children: string = node.children
					.map(n =>
						n.kind === 'p'
							? renderChildren(n.children)
							: compiler(n),
					)
					.join('');
				return `<${node.kind}>${children}</${node.kind}>`;
			}
			return `<li>${renderList(node)}</li>`;*/
		case 'heading':
			return renderChildren(node.children, `h${node.level}`);
		case 'block': {
			const lang = node.info && /\s*([^\s]+)/.exec(node.info);
			const cls = lang
				? ` class="language-${unescapeText(lang[1])}"`
				: '';
			return `<pre><code${cls}>${escapeHtml(node.value)}</code></pre>`;
		}
		case 'text':
			return node.children
				? renderChildren(node.children)
				: escapeHtml(node.value);
		case 'html':
			return (
				text(node) +
				(node.block && node.end < node.source.length - 1 ? '\n' : '')
			);
	}

	return '';
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
