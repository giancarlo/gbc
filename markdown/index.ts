import {
	type Token,
	type MakeNodeMap,
	ScannerApi,
	ParserApi,
	text,
	type MatchFn,
} from '../sdk/index.js';

type Children = Node[];
type TableAlignment = 'center' | 'left' | 'right';
type TableCell<Kind extends 'td' | 'th'> = Token<Kind> & {
	alignment?: TableAlignment;
	children: Children;
};
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
	table: { header: TableCell<'th'>[]; rows: TableCell<'td'>[][] };
	td: { alignment?: TableAlignment; children: Children };
	th: { alignment?: TableAlignment; children: Children };
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

const htmlRule6 = new Set(
	'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(
		' ',
	),
);
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

	function matchAttributeWhitespace(start: number, oneLine: boolean) {
		let n = start;
		let prevNl = false;
		for (;;) {
			const c = current(n);
			if (c === ' ' || c === '\t') {
				n++;
				prevNl = false;
			} else if (c === '\n' && !oneLine && !prevNl) {
				n++;
				prevNl = true;
			} else return n;
		}
	}

	function matchAttributeName(start: number) {
		const first = current(start);
		if (!alpha(first) && first !== '_' && first !== ':') return -1;
		return matchWhile(
			c =>
				alpha(c) ||
				digit(c) ||
				c === '_' ||
				c === '.' ||
				c === ':' ||
				c === '-',
			start + 1,
		);
	}

	function matchAttributeValue(start: number, oneLine: boolean) {
		const quote = current(start);
		if (quote === '"' || quote === "'") {
			let n = start + 1;
			while (
				current(n) &&
				current(n) !== quote &&
				(!oneLine || current(n) !== '\n')
			)
				n++;
			return current(n) === quote ? n + 1 : -1;
		}
		const end = matchWhile(
			c =>
				!!c &&
				c !== ' ' &&
				c !== '\t' &&
				c !== '\n' &&
				c !== '"' &&
				c !== "'" &&
				c !== '=' &&
				c !== '<' &&
				c !== '>' &&
				c !== '`',
			start,
		);
		return end === start ? -1 : end;
	}

	function matchAttributes(start: number, oneLine: boolean) {
		let n = start;
		for (;;) {
			const wsStart = n;
			n = matchAttributeWhitespace(n, oneLine);
			const c = current(n);
			if (c === '>' || c === '/' || c === '') return n;
			if (n === wsStart) return -1;
			n = matchAttributeName(n);
			if (n < 0) return -1;
			let valueStart = matchWhile(isSpace, n);
			if (current(valueStart) !== '=') continue;
			valueStart = matchWhile(isSpace, valueStart + 1);
			n = matchAttributeValue(valueStart, oneLine);
			if (n < 0) return -1;
		}
	}

	function matchTag(start: number, oneLine = false) {
		const isClosingTag = current(start) === '/';
		if (isClosingTag) start++;

		const { tagNameEnd, tagName } = matchTagName(start);
		if (!tagName) return;

		const isRule6 = htmlRule6.has(tagName.toLowerCase());

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
				: htmlRule6.has(matchTagName(tagStart).tagName.toLowerCase());
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

	function scanCode(ch: string) {
		const start = matchWhile(n => n === ch);
		const { consumed, blockEnd, blockStart } = matchBlock(
			api,
			ch,
			start,
			start,
			true,
			() => true,
		);
		return blockEnd
			? { ...tk('code', consumed), blockEnd, blockStart }
			: tk('text', start * 2);
	}

	function scanAngle() {
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
		const maybeHtml = matchInline(1);
		return maybeHtml ? tk('html', maybeHtml) : tk('text', scheme);
	}

	function scanLinkToken(ch: string) {
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
			if (result)
				return {
					...tk(
						kind,
						(result.linkClose ?? result.titleEnd ?? result.linkEnd) + 1,
					),
					linkTextEnd,
					linkTextStart,
					refStart: 0,
					refEnd: 0,
					...result,
				};
		}
		let end = afterText;
		let refStart = 0;
		let refEnd = 0;
		if (current(afterText) === '[') {
			const fullEnd = matchEnclosed(c => c !== ']', escape, afterText + 1);
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

	function scanInlineText() {
		const { indent, textStart } = countSpaces(matchWhile);
		const ch = current(textStart);
		if (textStart >= 2 && ch === '\n') return tk('br', textStart + 1);
		if (indent >= 4 && ch !== '\n' && ch !== '') {
			const block = tk('tabsBlock', matchUntil(isEol, textStart));
			return { ...block, textStart, indent };
		}
		let end = matchEnclosed(
			notStartInline,
			escape,
			(ch === '\n' ? 1 : 0) + textStart,
		);
		const last = current(end);
		let actualEnd = end;
		if (last === '\n' && current(end - 1) === '\\') {
			end--;
			actualEnd--;
		}
		if (last !== '\n' && last !== '') return tk('text', end);
		while (end > textStart && isSpace(current(end - 1))) end--;
		const token = tk('text', end);
		if (last === '' || actualEnd - end === 1 || current(actualEnd) === '\\')
			skip(actualEnd - end);
		return token;
	}

	function next() {
		if (eof()) return tk('eof', 0);
		const ch = current();
		switch (ch) {
			case '\\':
				if (current(1) === '\n') return tk('br', 2);
				break;
			case '`':
				return scanCode(ch);
			case '_':
			case '*': {
				const count = matchWhile(n => n === ch);
				return { ...tk('delim', count), ch, count };
			}
			case '<':
				return scanAngle();
			case '!':
			case '[':
				return scanLinkToken(ch);
		}
		return scanInlineText();
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

	function scanEol(textStart: number) {
		let count = 0;
		let end = matchWhile(
			n => (n === '\n' ? (count++, true) : isSpace(n)),
			textStart,
		);
		while (current(end) !== '\n') end--;
		return { ...tk('eol', end + 1), count };
	}

	function scanFence(indent: number, textStart: number, marker: string) {
		if (indent >= 4 || (marker !== '`' && marker !== '~')) return;
		const start = matchWhile(n => n === marker, textStart);
		const len = start - textStart;
		const infoEnd = matchUntil(isEol, start);
		if (
			len < 3 ||
			(marker === '`' && matchWhile(c => c !== '`', start) < infoEnd)
		)
			return;
		let match;
		let found = false;
		let firstStart = 0;
		let consumed = start;
		do {
			match = matchBlock(
				api,
				marker,
				len,
				consumed,
				false,
				(n, lineIndent) =>
					(current(n) === '\n' || current(n) === '') && lineIndent < 4,
			);
			consumed = match.consumed;
			if (!found) firstStart = match.blockStart;
			if (eof(consumed)) break;
			found = true;
		} while (!match.lineCount);
		if (!match.lineCount || (eof(consumed) && found)) return;
		return {
			...tk('block', consumed),
			blockEnd: match.blockEnd ? match.lineStart + 1 : consumed,
			blockStart: firstStart,
			indent,
		};
	}

	function scanTabs(indent: number, textStart: number) {
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

	function scanOrdered(indent: number, textStart: number) {
		const markerEnd = matchWhile(digit, textStart + 1);
		const dot = current(markerEnd);
		if (
			markerEnd - textStart >= 10 ||
			(dot !== '.' && dot !== ')') ||
			!isSpaceOrEol(current(markerEnd + 1))
		)
			return;
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
				textIndent - blockIndent >= 4 ? blockIndent : textIndent,
			textIndent,
		};
	}

	function scanBullet(indent: number, textStart: number, bullet: string) {
		if (
			(bullet !== '-' && bullet !== '*' && bullet !== '+') ||
			!isSpaceOrEol(current(textStart + 1))
		)
			return;
		const { indent: afterIndent, textStart: start } = countSpaces(
			matchWhile,
			textStart + 1,
		);
		let textIndent = indent + 1 + afterIndent;
		let blockIndent = indent + 2;
		if (current(start) === '\n') {
			textIndent = 2;
			blockIndent = 2;
		}
		return {
			...tk('li', matchUntil(isEol, start)),
			indent,
			blockStart: textStart,
			textStart: start,
			bullet,
			textIndent,
			blockIndent:
				textIndent - blockIndent >= 4 ? blockIndent : textIndent,
		};
	}

	function scanHeading(textStart: number) {
		const end = matchWhile(isHash, textStart + 1);
		const start = matchWhile(isSpace, end);
		const level = end - textStart;
		if ((start <= end && current(end) !== '\n') || level > 6) return;
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

	function scanLinkDefinition(textStart: number) {
		const linkTextEnd = matchEnclosed(
			c => c !== ']' && c !== '[',
			escape,
			textStart + 1,
		);
		const hasLabel = [...src.slice(textStart + 1, linkTextEnd)].some(
			c => !isSpaceOrEol(c),
		);
		if (
			!hasLabel ||
			current(linkTextEnd) !== ']' ||
			current(linkTextEnd + 1) !== ':'
		)
			return;
		const { consumed: start } = matchWhileSpaceOrOneLineEnding(
			matchWhile,
			linkTextEnd + 2,
		);
		const result = matchLink(api, escape, start);
		return result
			? {
					...tk('linkdef', result.titleEnd ?? result.linkEnd),
					...result,
					linkTextStart: textStart + 1,
					linkTextEnd,
				}
			: undefined;
	}

	function scanQuote(indent: number, textStart: number) {
		const { textStart: newStart, indent: newIndent } = countSpaces(
			matchWhile,
			textStart + 1,
		);
		const hasSpace = textStart + 1 === newStart ? 0 : 1;
		return {
			...tk('blockquote', matchUntil(isEol, textStart + 1)),
			indent,
			textStart: newStart,
			textIndent: indent + 2 + newIndent - hasSpace,
			blockIndent: indent + 1 + hasSpace,
		};
	}

	function scanHtml(textStart: number) {
		const scheme = matchWhile(alphaDashPlus, textStart + 1);
		const after = current(scheme);
		if (after === ':' || after === '@') return;
		const { end, isRule6 } = matchHtml(textStart + 1);
		return end ? { ...tk('html', end), isRule6 } : undefined;
	}

	function scanBlockText(indent: number, textStart: number) {
		const textEnd = matchUntil(isEol);
		if (current(textEnd) === '\n') {
			const setextStart = matchWhile(isSpace, textEnd + 1);
			const startChar = current(setextStart);
			if (
				setextStart - textEnd - 1 < 4 &&
				(startChar === '=' || startChar === '-')
			) {
				const lineLen = matchWhile(c => c === startChar, setextStart + 1);
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

	function next() {
		if (eof()) return tk('eof', 0);

		// Spaces are significant
		const { textStart, indent } = countSpaces(matchWhile);
		const afterSpace = current(textStart);

		if (afterSpace === '\n') return scanEol(textStart);

		const fence = scanFence(indent, textStart, afterSpace);
		if (fence) return fence;

		if (indent >= 4) return scanTabs(indent, textStart);

		if (digit(afterSpace)) {
			const ordered = scanOrdered(indent, textStart);
			if (ordered) return ordered;
		}
		if (afterSpace === '*' || afterSpace === '-' || afterSpace === '_') {
			const result = thematicBreak(afterSpace);
			if (result) return { ...tk('hr', result), indent, textStart };
		}

		const bullet = scanBullet(indent, textStart, afterSpace);
		if (bullet) return bullet;

		if (afterSpace === '#') {
			const heading = scanHeading(textStart);
			if (heading) return heading;
		}

		if (afterSpace === '[') {
			const definition = scanLinkDefinition(textStart);
			if (definition) return definition;
		}

		if (afterSpace === '>') return scanQuote(indent, textStart);

		if (afterSpace === '<') {
			const html = scanHtml(textStart);
			if (html) return html;
		}
		return scanBlockText(indent, textStart);
	}

	return { next, backtrack };
}

function unescapeText(value: string) {
	return value.replace(/\\([\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1');
}

function trimLineEndings(value: string) {
	const lines = value.split('\n');
	return lines
		.map((line, index) =>
			index < lines.length - 1 ? line.trimEnd() : line,
		)
		.join('\n');
}

function splitTableRow(value: string, requirePipe = true) {
	const cells: string[] = [];
	let cellStart = 0;
	let pipes = 0;

	for (let i = 0; i < value.length; i++) {
		if (value.charAt(i) !== '|') continue;
		let backslashes = 0;
		for (let j = i - 1; j >= 0 && value.charAt(j) === '\\'; j--)
			backslashes++;
		if (backslashes % 2) continue;
		cells.push(value.slice(cellStart, i));
		cellStart = i + 1;
		pipes++;
	}

	if (!pipes) return requirePipe ? undefined : [value.trim()];
	cells.push(value.slice(cellStart));
	if (!cells[0]?.trim()) cells.shift();
	if (!cells.at(-1)?.trim()) cells.pop();
	return cells.map(cell => unescapeTablePipes(cell.trim()));
}

function unescapeTablePipes(value: string) {
	let result = '';
	let i = 0;
	while (i < value.length) {
		if (value.charAt(i) !== '\\') {
			result += value.charAt(i);
			i++;
			continue;
		}
		let end = i;
		while (value.charAt(end) === '\\') end++;
		const count = end - i;
		result += '\\'.repeat(
			value.charAt(end) === '|' && count % 2 ? count - 1 : count,
		);
		i = end;
	}
	return result;
}

function tableAlignments(value: string) {
	const cells = splitTableRow(value);
	if (!cells?.length) return;
	const alignments: (TableAlignment | undefined)[] = [];

	for (const cell of cells) {
		if (!/^:?-+:?$/.test(cell)) return;
		alignments.push(
			cell.startsWith(':')
				? cell.endsWith(':')
					? 'center'
					: 'left'
				: cell.endsWith(':')
					? 'right'
					: undefined,
		);
	}

	return alignments;
}

function normalizeLabel(s: string) {
	return s.toLowerCase().toUpperCase().replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
	return value.replace(/&#[Xx]([\da-fA-F]+);|&#(\d+);/g, (m, hex, dec) => {
		const code = parseInt(String(hex || dec), hex ? 16 : 10);
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
			if (closer?.kind !== 'delim' || !closer.canClose) {
				i++;
				continue;
			}
			let matched = false;
			for (let j = i - 1; j >= 0; j--) {
				const opener = nodes[j];
				if (
					opener?.kind !== 'delim' ||
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
				const wrapped: NodeMap['strong'] | NodeMap['em'] = {
					kind: n === 2 ? 'strong' : 'em',
					children: inner,
					source: opener.source,
					line: opener.line,
					start: opener.end - n,
					end: closer.start + n,
				};
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

	function linkNode(token: Extract<InlineToken, { kind: 'a' | 'img' }>): Node {
		const kind = token.kind;
		const parts = getLinkParts(token, linkRefs);
		if (
			!parts &&
			token.kind === 'a' &&
			token.refEnd > token.refStart
		) {
			const afterX = token.linkTextEnd + 1;
			const xEnd = token.start + afterX;
			backtrack({ ...token, end: xEnd });
			next();
			return {
				...token,
				kind: 'text',
				value: unescapeText(text(token).slice(0, afterX)),
				end: xEnd,
			};
		}
		if (
			!parts &&
			token.kind === 'a' &&
			token.refEnd === 0 &&
			token.linkTextEnd > token.linkTextStart
		) {
			const xEnd = token.start + 1;
			backtrack({ ...token, end: xEnd });
			next();
			return { ...token, kind: 'text', value: '[', end: xEnd };
		}
		if (parts && kind === 'a' && precedenceOverridesLink(token)) {
			const xEnd = token.start + 1;
			backtrack({ ...token, end: xEnd });
			next();
			return { ...token, kind: 'text', value: '[', end: xEnd };
		}
		next();
		if (!parts)
			return {
				...token,
				kind: 'text',
				value: unescapeText(text(token)),
			};

		const linkApi = ParserApi(scannerInline);
		linkApi.start(text(token).slice(token.linkTextStart, token.linkTextEnd));
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
						value: unescapeText(src.slice(0, token.linkTextStart)),
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
				result.value = trimLineEndings(result.value);
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
			case 'a':
				return linkNode(token);
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
			value:
				prefix +
				(offsetEnd === undefined
					? text(token).slice(offset)
					: text(token).slice(offset, offsetEnd)),
		};
		defer.push(node);
		return node;
	}

	function tableCell<Kind extends 'td' | 'th'>(
		token: BlockToken,
		kind: Kind,
		value: string,
		alignment?: TableAlignment,
	): TableCell<Kind> {
		const child = textNode(token, 0, value, 0);
		return { ...token, kind, alignment, children: [child] };
	}

	function table(token: Extract<BlockToken, { kind: 'text' }>) {
		const header = splitTableRow(text(token));
		if (!header) return;
		const eol = next();
		if (eol.kind !== 'eol' || eol.count !== 1) {
			backtrack(token);
			return;
		}
		const delimiter = next();
		const alignments = tableAlignments(text(delimiter));
		if (header.length !== alignments?.length) {
			backtrack(token);
			return;
		}

		const headerCells = header.map((value, index) =>
			tableCell(token, 'th', value, alignments[index]),
		);
		const rows: TableCell<'td'>[][] = [];
		let end = delimiter.end;
		let currentToken = next();

		while (currentToken.kind === 'eol' && currentToken.count === 1) {
			const row = next();
			if (row.kind !== 'text') break;
			const values = splitTableRow(text(row), false) ?? [];
			rows.push(
				alignments.map((alignment, index) =>
					tableCell(row, 'td', values[index] ?? '', alignment),
				),
			);
			end = row.end;
			currentToken = next();
		}

		const node: NodeMap['table'] = {
			...token,
			kind: 'table',
			header: headerCells,
			rows,
			end,
		};
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
					(nextToken.kind === 'li' && text(nextToken).length === 1) ||
					nextToken.kind === 'linkdef' ||
					(nextToken.kind === 'html' && !nextToken.isRule6)
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
							child.value = child.value
								.split('\n')
								.map(line => line.trim())
								.join('\n');
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
					child.value += text(nextToken)
						.split('\n')
						.map(line => line.trimStart())
						.join('\n');
					continue;
				} else if (nextToken.kind === 'tabsBlock') {
					child.value +=
						'\n' + text(nextToken).slice(nextToken.textStart);
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

	function canLazyContinue(content: string[]) {
		const lazyApi = ParserApi(scannerBlock);
		lazyApi.start(content.join(''));
		let children = parserBlock(lazyApi).children;
		for (;;) {
			const child = children.findLast(
				node => node.kind !== 'text' || node.value,
			);
			if (!child || child.kind === 'p') return child?.kind === 'p';
			const nested = nodeChildren(child);
			if (!nested) return false;
			children = nested;
		}
	}

	function hasOpenFence(content: string[]) {
		let marker = '';
		for (const line of content.join('').split('\n')) {
			let start = 0;
			while (start < 4 && line.charAt(start) === ' ') start++;
			const char = line.charAt(start);
			if (start === 4 || (char !== '`' && char !== '~')) continue;
			let end = start + 1;
			while (line.charAt(end) === char) end++;
			if (end - start < 3) continue;
			const fence = line.slice(start, end);
			const rest = line.slice(end);
			if (!marker) {
				if (fence.charAt(0) === '`' && rest.includes('`')) continue;
				marker = fence;
			} else if (
				fence.charAt(0) === marker.charAt(0) &&
				fence.length >= marker.length &&
				!rest.trim()
			) {
				marker = '';
			}
		}
		return !!marker;
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
		const recovery = { fence: false };
		let lazyContinuation: boolean | undefined;
		const canContinue = () =>
			(lazyContinuation ??= canLazyContinue(content));

		function consumeQuote(bq: Extract<BlockToken, { kind: 'blockquote' }>) {
			token.end = bq.end;
			content.push(
				allowP
					? bq.source.slice(bq.start + bq.indent, bq.end)
					: mergeBlock(bq.textIndent - bq.blockIndent, bq),
			);
			prevEmptyBq = bq.textStart === bq.end - bq.start;
			lazyContinuation = undefined;
		}

		function isSetextBoundary(bq: BlockToken) {
			return (
				bq.kind === 'setext' &&
				bq.level === 2 &&
				bq.length === 1 &&
				allowP &&
				bq.textStart >= token.blockIndent &&
				bq.end -
					bq.length -
					(bq.source.lastIndexOf('\n', bq.end - bq.length - 1) + 1) <
					token.blockIndent
			);
		}

		function consumeSetextBoundary(bq: BlockToken) {
			if (bq.kind !== 'setext') return;
			const end = bq.start + bq.textEnd;
			token.end = end;
			content.push(
				bq.source.slice(
					bq.start + Math.min(token.blockIndent, bq.textStart),
					end,
				),
			);
			backtrack({ ...bq, end });
			lazyContinuation = undefined;
		}

		function consumeIndented(
			bq: Extract<BlockToken, { kind: 'tabsBlock' | 'li' | 'ol' }>,
		) {
			const partOfBlock = isPartOfBlock(token, bq);
			const lazy =
				bq.kind === 'tabsBlock' &&
				(!allowP || !partOfBlock) &&
				canContinue();
			const continues =
				bq.kind === 'tabsBlock'
					? lazy || (allowP && partOfBlock)
					: partOfBlock;
			if (!continues) {
				backtrack(bq);
				return false;
			}
			token.end = bq.end;
			content.push(
				lazy
					? text(bq)
					: mergeBlock(
							Math.max(bq.indent - token.blockIndent, 0),
							bq,
							bq.blockStart,
						),
			);
			if (!lazy) lazyContinuation = undefined;
			prevEmptyBq = false;
			return true;
		}

		function consumeHr(bq: Extract<BlockToken, { kind: 'hr' }>) {
			if (bq.indent < token.blockIndent) {
				backtrack(bq);
				return false;
			}
			token.end = bq.end;
			content.push(
				' '.repeat(bq.indent - token.blockIndent) +
					bq.source.slice(bq.start + bq.textStart, bq.end),
			);
			lazyContinuation = undefined;
			prevEmptyBq = false;
			return true;
		}

		function consumeText(
			bq: Extract<BlockToken, { kind: 'text' | 'setext' }>,
		) {
			if (prevEmptyBq) {
				backtrack(bq);
				return false;
			}
			const structural =
				allowP && bq.kind === 'text' && isPartOfBlock(token, bq);
			if (!structural && !canContinue()) {
				backtrack(bq);
				return false;
			}
			token.end = bq.end;
			const strip =
				bq.kind === 'text'
					? Math.min(token.blockIndent, bq.textStart)
					: 0;
			content.push(bq.source.slice(bq.start + strip, bq.end));
			if (structural) lazyContinuation = undefined;
			return true;
		}

		function consumeBlock(bq: Extract<BlockToken, { kind: 'block' }>) {
			if (bq.indent < token.blockIndent) {
				backtrack(bq);
				return false;
			}
			token.end = bq.end;
			content.push(
				text(bq).replace(
					new RegExp(`^[ \\t]{1,${token.blockIndent}}`, 'gm'),
					'',
				),
			);
			lazyContinuation = undefined;
			return true;
		}

		function consumeSingleLine(bq: BlockToken) {
			if (bq.kind === 'blockquote') {
				consumeQuote(bq);
				return true;
			}
			if (isSetextBoundary(bq)) {
				consumeSetextBoundary(bq);
				return true;
			}
			if (bq.kind === 'tabsBlock' || bq.kind === 'li' || bq.kind === 'ol')
				return consumeIndented(bq);
			if (bq.kind === 'hr') return consumeHr(bq);
			if (bq.kind === 'text' || (bq.kind === 'setext' && bq.level === 1))
				return consumeText(bq);
			if (bq.kind === 'block') return consumeBlock(bq);
			backtrack(bq);
			return false;
		}

		function consumeBlankLines(
			eol: Extract<BlockToken, { kind: 'eol' }>,
			bq: BlockToken,
		) {
			const backtrackOnFail =
				bq.kind === 'li' || bq.kind === 'ol' ? bq : eol;
			if (
				bq.kind === 'block' &&
				bq.indent >= token.blockIndent &&
				hasOpenFence(content)
			) {
				const lineEnd = bq.source.indexOf('\n', bq.start);
				const end = lineEnd === -1 ? bq.end : lineEnd;
				token.end = end;
				recovery.fence = true;
				content.push(
					text(eol),
					bq.source.slice(bq.start + token.blockIndent, end),
				);
				backtrack({ ...bq, end });
				lazyContinuation = undefined;
				return true;
			}
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
					text(eol),
					mergeBlock(
						Math.max(bq.indent - token.blockIndent, 0),
						bq,
						newStart,
					),
				);
				lazyContinuation = undefined;
				return true;
			}
			if (bq.kind === 'linkdef') {
				storeLinkDef(bq);
				token.end = bq.end;
				pCount = 1;
				return true;
			}
			pCount = 1;
			backtrack(backtrackOnFail);
			return false;
		}

		for (;;) {
			const nextToken = next();
			if (nextToken.kind !== 'eol') break;
			if (nextToken.count === 1) {
				content.push('\n');
				if (!consumeSingleLine(next())) break;
			} else if (allowP) {
				if (!consumeBlankLines(nextToken, next())) break;
			} else {
				content.push('\n');
				break;
			}
		}
		const api = ParserApi(scannerBlock);
		api.start(content.join(''));
		const root = parserBlock(api, false, defer, linkDefinitions);
		if (recovery.fence)
			root.children.unshift({
				...token,
				kind: 'text',
				value: '\n',
				end: token.start,
			});
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
				const node: NodeMap['text'] = {
					...token,
					kind: 'text',
					value: '',
				};
				return node;
			}
			case 'setext': {
				next();
				const node: NodeMap['heading'] = {
					...token,
					kind: 'heading',
					children: [
						textNode(token, token.textStart, '', token.textEnd),
					],
				};
				return node;
			}
			case 'eof':
				return;
			case 'text':
				break;
		}

		const tableNode = table(token);
		if (tableNode) return tableNode;
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
		n => n.kind === 'a' || !!nodeChildren(n)?.some(child => hasLink([child])),
	);
}

function plainText(nodes: Node[]): string {
	return nodes
		.map(n => {
			const children = nodeChildren(n);
			if (children) return plainText(children);
			if (n.kind === 'text') return n.value;
			return '';
		})
		.join('');
}

function nodeChildren(node: Node) {
	switch (node.kind) {
		case 'a':
		case 'blockquote':
		case 'em':
		case 'heading':
		case 'img':
		case 'li':
		case 'ol':
		case 'p':
		case 'strong':
		case 'td':
		case 'th':
		case 'ul':
			return node.children;
		case 'text':
			return node.children;
		default:
			return;
	}
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

function renderTableCell<Kind extends 'td' | 'th'>(node: TableCell<Kind>) {
	const alignment = node.alignment ? ` align="${node.alignment}"` : '';
	return `<${node.kind}${alignment}>${renderChildren(node.children)}</${node.kind}>`;
}

function renderTable(node: NodeMap['table']) {
	const header = node.header.map(renderTableCell).join('');
	const body = node.rows.length
		? `<tbody>${node.rows
				.map(row => `<tr>${row.map(renderTableCell).join('')}</tr>`)
				.join('')}</tbody>`
		: '';
	return `<table><thead><tr>${header}</tr></thead>${body}</table>`;
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
		case 'table':
			return renderTable(node);
		case 'heading':
			return renderChildren(node.children, `h${node.level}`);
		case 'block': {
			const lang = node.info?.trimStart().split(/\s/, 1)[0];
			const cls = lang
				? ` class="language-${unescapeText(lang)}"`
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
