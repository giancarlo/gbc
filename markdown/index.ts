import {
	Token,
	MakeNodeMap,
	ScannerApi,
	ParserApi,
	text,
	MatchFn,
} from 'gbc/sdk/index.js';

type Children = Node[];
/* eslint @typescript-eslint/no-empty-object-type: off */
type NodeMapBase = {
	code: { value: string };
	em: { children: Children };
	p: { children: Children };
	b: { children: Children };
	root: { children: Children };
	heading: { level: number; children: Children };
	ul: { children: Children };
	ol: { children: Children };
	li: { children: Children; indent: number; pCount: number };
	eol: { count: number };
	text: { value: string; children?: Node[] };
	hr: {};
	br: {};
	block: { info?: string; value: string };
	blockquote: { children: Children; pCount: number };
	link: { href: string; text: string; title?: string };
	html: { block: boolean };
};
type NodeMap = MakeNodeMap<NodeMapBase>;

export type Node = NodeMap[keyof NodeMap];

type BlockToken = ReturnType<ReturnType<typeof scannerBlock>['next']>;
type InlineToken = ReturnType<ReturnType<typeof scannerInline>['next']>;
type InlineBlockToken = Extract<
	BlockToken,
	{ indent: number; textStart: number; textIndent: number }
>;

const isEol = (c: string) => c === '\n';
const isSpace = (c: string) => c === ' ' || c === '\t';
const alpha = (ch: string) =>
	(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const alphaDash = (ch: string) => alpha(ch) || ch === '-';
const alphaDashPlus = (c: string) => alpha(c) || c === '-' || c === '+';
//const isSpaceOrEol = (c: string) => c === ' ' || c === '\t' || c === '\n';
const isHash = (c: string) => c === '#';
const notStartInline = (ch: string) =>
	ch !== '`' &&
	ch !== '\n' &&
	ch !== '_' &&
	ch !== '*' &&
	ch !== '<' &&
	ch !== '[';
const digit = (ch: string) => ch >= '0' && ch <= '9';
//const isLineStart = (c: string) => c === '\n' || c === '';

function countSpaces(
	matchWhile: (match: MatchFn, consumed?: number) => number,
	offset = 0,
) {
	let indent = offset;
	const textStart = matchWhile(ch => {
		const count = ch === '\t' ? 4 - (indent % 4) : ch === ' ' ? 1 : 0;
		indent += count;
		return !!count;
	}, offset);
	indent -= offset;
	return { indent, textStart };
}

function matchEndBlock(
	{ matchWhile }: ReturnType<typeof ScannerApi>,
	ch: string,
	len: number,
	consumed: number,
	//endFn: (consumed: number) => boolean,
) {
	const end = matchWhile(c => c === ch, consumed);
	if (end - consumed >= len) {
		/*const spaces = matchWhile(isSpace, end);
		if (endFn(spaces)) return spaces;*/
		return matchWhile(isSpace, end);
	}
	return false;
}

// turn to matchDelimitedBlock api
// Optimize this..
function matchBlock(
	api: ReturnType<typeof ScannerApi>,
	ch: string,
	len: number,
	consumed: number,
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

		const found = matchEndBlock(api, ch, len, consumed);
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

	function matchTag(start: number) {
		let ch = current(start);
		const isClosingTag = ch === '/';
		if (isClosingTag) ch = current(start++);

		const { tagNameEnd, tagName } = matchTagName(start);
		if (!tagName) return;

		const afterTag = current(tagNameEnd);
		if (afterTag === '>')
			return { tagName, tagEnd: tagNameEnd + 1, isClosingTag };
		//if (afterTag !== ' ') return 0;
		let p = '';
		let tagEnd = matchWhile(c => {
			const r = c !== '>' && !(c === '\n' && p === '\n');
			p = c;
			return r;
		}, tagNameEnd + 1);

		if (eof(tagEnd)) return { tagName, tagEnd: tagEnd - 1, isClosingTag };

		return current(tagEnd++) === '>'
			? { tagName, tagEnd, isClosingTag }
			: 0;
	}

	function matchComment(start: number, closing: string) {
		while (!eof(start++)) {
			//if (current(start) === '\n') break;
			if (matchString(closing, undefined, start))
				return matchUntil(isEol, start);
		}
		return 0;
	}

	function matchInline(start: number) {
		const openTag = matchTag(start);
		if (!openTag) return 0;

		return openTag.tagEnd;
	}

	function isLineEnd(start: number) {
		const spaces = matchWhile(isSpace, start);
		return current(spaces) === '\n' || current(spaces) === '';
	}

	function matchHtml(start: number) {
		const openTag = matchTag(start);

		if (!openTag) {
			if (current(start) === '!') {
				if (current(start + 1) === '-' && current(start + 2) === '-')
					return matchComment(start + 3, '-->');
				else return matchComment(start + 1, '>');
			} else if (current(start) === '?')
				return matchComment(start + 1, '?>');
			return 0;
		}

		const { tagName, tagEnd, isClosingTag } = openTag;
		if (eof(tagEnd)) return tagEnd;

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
		}
		const isRule6 = htmlRule6.test(tagName);
		if (!isRule6 && !isLineEnd(tagEnd)) return 0;

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

/*const htmlInline = [
	'a',
	'abbr',
	'acronym',
	'b',
	'bdo',
	'big',
	'br',
	'button',
	'cite',
	'code',
	'dfn',
	'em',
	'i',
	'img',
	'input',
	'kbd',
	'label',
	'map',
	'mark',
	'meter',
	'noscript',
	'object',
	'output',
	'progress',
	'q',
	'ruby',
	's',
	'samp',
	'script',
	'select',
	'small',
	'span',
	'strong',
	'sub',
	'sup',
	'textarea',
	'time',
	'tt',
	'u',
	'var',
	'wbr',
];*/

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
		//createTrieMatcher,
	} = api;
	const { matchInline } = htmlScanner(api);

	/*const htmlAutoClose = createTrieMatcher(
		[
			'area',
			'base',
			'br',
			'col',
			'embed',
			'hr',
			'img',
			'input',
			'link',
			'meta',
			'param',
			'source',
			'track',
			'wbr',
		],
		c => c === ' ' || c === '\n' || c === '\t',
	);*/

	const escape = (i: number) =>
		current(i) !== '\n' &&
		current(i - 1) === '\\' &&
		current(i - 2) !== '\\';

	function next() {
		if (eof()) return tk('eof', 0);

		// Spaces are significant
		const { indent, textStart } = countSpaces(matchWhile);
		const ch = current(textStart);

		if (textStart >= 2 && ch === '\n') return tk('br', textStart + 1);

		if (indent >= 4) {
			if (ch !== '\n' && ch !== '') {
				const block = tk('tabsBlock', matchUntil(isEol, textStart));
				return { ...block, textStart, indent };
			}
		}

		switch (ch) {
			case '\\':
				if (current(textStart + 1) === '\n')
					return tk('br', textStart + 2);
				break;
			case '`': {
				const start = matchWhile(n => n === ch, textStart);
				const len = start - textStart;
				const { consumed, blockEnd, blockStart } = matchBlock(
					api,
					ch,
					len,
					start,
					() => true,
				);
				if (blockEnd)
					return { ...tk('code', consumed), blockEnd, blockStart };

				// treat as text
				return tk('text', start + len);
			}
			case '*':
				if (current(textStart + 1) === '*')
					return tk('b', textStart + 2);
				else return tk('em', textStart + 1);
			case '_':
				return tk('em', 1);
			case '<': {
				// Scan Autolink
				const scheme = matchWhile(alphaDashPlus, textStart + 1);
				const type = current(scheme);
				if (
					(scheme - textStart - 1 > 1 && type === ':') ||
					type === '@'
				) {
					const host = matchWhile(
						n => n !== '>' && n !== ' ' && n !== '<',
						scheme + 1,
					);
					// Check for invalid URL
					if (current(host) === '>')
						return { ...tk('autolink', host + 1), type };
				}
				// can it be HTML ?
				const maybeHtml = matchInline(textStart + 1);
				if (maybeHtml) return tk('html', maybeHtml);

				return tk('text', scheme);
			}
			case '[': {
				const linkTextEnd = matchEnclosed(c => c !== ']', escape);
				if (
					current(linkTextEnd) === ']' &&
					current(linkTextEnd + 1) === '('
				) {
					const linkEnd =
						current(linkTextEnd + 2) === '<'
							? matchEnclosed(
									c => c !== '>' && c !== '\n',
									escape,
									linkTextEnd + 2,
							  ) + 1
							: matchEnclosed(
									c =>
										c !== ')' &&
										c !== ' ' &&
										c !== '\t' &&
										c !== '\n',
									escape,
									linkTextEnd + 2,
							  );

					const afterLink = current(linkEnd + 1);
					let titleEnd: number | undefined,
						titleStart: number | undefined;

					if (afterLink === '"' || afterLink === "'") {
						// possible title
						titleStart = linkEnd + 1;
						titleEnd = matchEnclosed(
							c => c !== ')',
							escape,
							linkEnd + 2,
						);
					}
					if (current(titleEnd ?? linkEnd) === ')') {
						return {
							...tk('link', (titleEnd ?? linkEnd) + 1),
							linkTextEnd,
							titleEnd,
							titleStart,
							linkEnd,
						};
					}
				}
				return tk('text', textStart + 1);
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

export function scannerBlock(src: string) {
	const api = ScannerApi({
		source: src,
	});
	const { current, tk, matchWhile, backtrack, eof, matchUntil, skip } = api;
	const { matchHtml } = htmlScanner(api);

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
						(n, indent) => current(n) === '\n' && indent < 4,
					);
					consumed = match.consumed;
					if (!found) firstStart = match.blockStart;
					if (eof(consumed)) break;
					else found = true;
				} while (!match.lineCount);

				if (match.lineCount && !(eof(consumed) && found)) {
					const { consumed, lineStart } = match;
					return {
						...tk('block', consumed),
						blockEnd: lineStart + 1 || consumed,
						blockStart: firstStart,
						indent,
					};
				}
			}
		}

		// setext
		if (indent < 4 && current(-1)) {
			const startChar = current(textStart);
			if (startChar === '=' || startChar === '-') {
				const lineLen = matchWhile(c => c === startChar, textStart + 1);
				const trailing = matchWhile(isSpace, lineLen);
				if (current(trailing) === '\n')
					return {
						...tk('setext', trailing),
						level: startChar === '=' ? 1 : 2,
						length: trailing - textStart,
						/*textStart,
						textEnd: trailing,
						textIndent: indent,*/
					};
			}
		}

		if (
			indent < 4 &&
			(afterSpace === '*' || afterSpace === '-' || afterSpace === '_')
		) {
			const result = thematicBreak(afterSpace);
			if (result) return tk('hr', result);
		}

		if (digit(afterSpace)) {
			const markerEnd = matchWhile(digit, textStart + 1);
			const dot = current(markerEnd);
			if (dot === '.' || dot === ')') {
				const { indent: textIndent, textStart: start } = countSpaces(
					matchWhile,
					markerEnd + 1,
				);
				const markerLen = markerEnd - textStart + 1;
				const end = matchUntil(isEol, start);
				return {
					...tk('ol', end),
					indent: indent + markerLen,
					textStart: start,
					blockStart: textStart,
					markerStart: textStart,
					markerEnd,
					// Substract the space occupied by '- '
					textIndent: textIndent - markerLen,
				};
			}
		}

		if (
			(afterSpace === '-' || afterSpace === '*' || afterSpace === '+') &&
			isSpace(current(textStart + 1))
		) {
			const bullet = afterSpace;
			const { indent: textIndent, textStart: start } = countSpaces(
				matchWhile,
				textStart + 1,
			);

			// Handle thematic break inside list...
			const startCh = current(start);
			let hasThematicBreak: number | undefined;
			if (
				indent < 4 &&
				(startCh === '-' || startCh === '_' || startCh === '*')
			) {
				hasThematicBreak = thematicBreak(startCh, start);
			}

			const end = matchUntil(isEol, start);
			return {
				...tk('li', end),
				indent: indent + 2,
				blockStart: textStart,
				textStart: start,
				bullet,
				hasThematicBreak,
				// Substract the space occupied by '- '
				textIndent: textIndent - 1,
			};
		}

		if (indent >= 4) {
			const block = tk('tabsBlock', matchUntil(isEol, textStart));
			return { ...block, textStart, indent };
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

		if (afterSpace === '>') {
			// handle multiple > levels
			let i = textStart;
			let level = 0;
			let start = 0;
			let textIndent = 0;
			while (current(i) === '>') {
				i++;
				level++;
				const { textStart: newStart, indent: newIndent } = countSpaces(
					matchWhile,
					i,
				);
				start = newStart;
				// Substract the space occupied by '> '
				textIndent = newIndent - 1;
				i += start;
			}

			return {
				...tk('blockquote', matchUntil(isEol, i)),
				indent,
				level,
				textStart: start,
				textIndent,
			};
		}

		// heading takes precedence
		if (afterSpace === '<') {
			const scheme = matchWhile(alpha, textStart + 1);
			// Ignore Autolink
			if (current(scheme) !== ':') {
				const maybeHtml = matchHtml(textStart + 1);
				if (maybeHtml) return tk('html', maybeHtml);
			}
		}

		const textEnd = matchUntil(isEol);
		// Remove whitespace
		skip(textStart);

		return tk('text', textEnd - textStart);
	}

	return { next, backtrack };
}

/**
 * - Replace all escaped characters with their appropriate text values
 */
function unescapeText(value: string) {
	return value.replace(/\\([\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1');
}

export function parserInline(api: ParserApi<InlineToken>) {
	const { current, parseWhile, next, backtrack } = api;

	function inline(): Node | undefined {
		const token = current();

		switch (token.kind) {
			case 'code': {
				const tokenText = text(token)
					.slice(token.blockStart, token.blockEnd)
					.replace(/\n/g, ' ');
				const value =
					tokenText.length > 1 &&
					tokenText.startsWith(' ') &&
					tokenText.endsWith(' ')
						? tokenText.slice(1, -1)
						: tokenText;

				next();
				return { ...token, kind: 'code', value } as const;
			}
			case 'em':
			case 'b': {
				let found = false;
				next();
				const children: Node[] = parseWhile(() => {
					const newToken = current();
					if (newToken.kind === token.kind) {
						found = true;
						return;
					}
					return inline();
				});
				if (found && children.length) {
					next();
					return { ...token, children } as const;
				} else {
					backtrack(token);
					next();
					return { ...token, kind: 'text', value: text(token) };
				}
			}
			case 'text': {
				const result = { ...token, value: unescapeText(text(token)) };
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
				return { ...token, kind: 'link', href, text: src };
			}
			case 'link': {
				const src = text(token);
				const content = src.slice(1, token.linkTextEnd);
				let href = unescapeText(
					src.slice(token.linkTextEnd + 2, token.linkEnd),
				);
				if (href.startsWith('<') && href.endsWith('>'))
					href = href.slice(1, -1);
				const title =
					token.titleStart !== undefined &&
					token.titleEnd !== undefined
						? unescapeText(
								src.slice(
									token.titleStart + 1,
									token.titleEnd - 1,
								),
						  )
						: undefined;
				next();
				return { ...token, kind: 'link', href, text: content, title };
			}
			case 'html':
				next();
				return { ...token, block: false };
		}
	}

	return parseWhile(inline);
}

export function parserBlock(api: ParserApi<BlockToken>) {
	const { current, node: createNode, parseWhile, next, backtrack } = api;

	const deferInline: NodeMap['text'][] = [];

	function parseInline() {
		const api = ParserApi(scannerInline);

		for (const node of deferInline) {
			api.start(node.value);
			node.children = parserInline(api);
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
		deferInline.push(node);
		return node;
	}

	function handleNewLine(indent: number) {
		const token = next();
		if (token.kind === 'tabsBlock') {
			const blockIndent = token.indent;
			if (blockIndent > indent) {
				const spaces = blockIndent - indent - 4;
				token.start += token.textStart;
				const nextToken = next();
				// We need to calculate the leading spaces, based on indentation.
				return {
					...token,
					kind: 'block',
					value:
						' '.repeat(spaces) +
						text(token) +
						(nextToken.kind === 'eol' ? '\n' : ''),
				} as const;
			} else if (blockIndent === indent) {
				return p(token, textNode(token, token.textStart));
			}
		} else return;
	}

	function p(parentToken: BlockToken, child = textNode(parentToken)) {
		let newChild: Node | undefined;

		while (child) {
			const token = next();
			if (token.kind === 'eol' && token.count === 1) {
				const nextToken = next();

				if (nextToken.kind === 'setext') {
					next();
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
				} else if (nextToken.kind === 'text') {
					nextToken.start = token.start;
					child.value += text(nextToken).replace(
						/^[\t ]*([^\n]+?)\s*$/gm,
						'$1',
					);
					continue;
				} else if (nextToken.kind === 'tabsBlock') {
					child.value +=
						'\n' + text(nextToken).slice(nextToken.textStart);
					continue;
				} else {
					backtrack(token);
				}
			}
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

	function inlineBlock<T extends InlineBlockToken>(
		parentToken: T,
		child: Node = textNode(
			parentToken,
			parentToken.textStart,
			' '.repeat(parentToken.textIndent),
		),
	) {
		const { indent } = parentToken;
		let pCount = 0;
		next();
		const children: Node[] = parseWhile(() => {
			const token = current();

			if (token.kind === 'eol') {
				if (token.count > 1) {
					pCount++;
					const result = handleNewLine(indent);
					if (result) return result;
					backtrack(token);
				}

				const nextToken = next();

				if (nextToken.kind === 'li') {
					const liIndent = nextToken.indent;
					if (liIndent > indent) return ul(nextToken);
					return;
				}

				backtrack(nextToken);

				/*if (nextToken.kind !== 'eof')
					return { ...token, kind: 'text', value: '\n' } as const;*/
			}
		});

		children.unshift({
			...parentToken,
			kind: 'p',
			children: [child],
		});

		const node = {
			...parentToken,
			children,
			pCount,
		};

		return node;
	}

	function li(bullet: string): NodeMap['li'] | undefined {
		const liToken = current();
		if (liToken.kind !== 'li' || liToken.bullet !== bullet) return;

		return inlineBlock(
			liToken,
			liToken.hasThematicBreak ? createNode('hr') : undefined,
		);
	}

	function ul(token: Token<'li'> & { bullet: string }): NodeMap['ul'] {
		const bullet = token.bullet;
		const children = parseWhile(() => li(bullet));
		return { ...token, kind: 'ul', children };
	}

	function ol(token: Token<'ol'>): NodeMap['ol'] {
		const children = parseWhile(() => {
			const liToken = current();
			if (liToken.kind !== 'ol') return;

			const bullet = liToken.source.slice(
				liToken.markerStart,
				liToken.markerEnd,
			);
			const li = inlineBlock(
				{ ...liToken, kind: 'li', bullet, hasThematicBreak: 0 },
				//liToken.hasThematicBreak ? createNode('hr') : undefined,
			);
			return li;
		});
		return { ...token, kind: 'ol', children };
	}

	function normalizeBlock(block: NodeMap['block'], indent: number) {
		block.value = block.value.replace(
			new RegExp(`^[ \t]{1,${indent}}`, 'gm'),
			'',
		);
	}

	function tabsBlock(
		token: Extract<BlockToken, { textStart: number; indent: number }>,
	) {
		const node: NodeMap['block'] = {
			...token,
			kind: 'block',
			value: text(token), //.slice(token.textStart),
		};
		let nextToken = next();
		let minIndent = token.indent;

		while (nextToken.kind === 'eol') {
			const maybeBlock = next();
			if (maybeBlock.kind === 'li' && maybeBlock.indent >= 4) {
				const eolText = text(nextToken);
				/*.replace(
					new RegExp(`^[ \t]{1,${token.indent}}`, 'gm'),
					'',
				);*/
				if (maybeBlock.indent < minIndent)
					minIndent = maybeBlock.indent;
				node.value +=
					eolText + text(maybeBlock).slice(maybeBlock.blockStart);
				node.end = maybeBlock.end;
				nextToken = next();
			} else if (maybeBlock.kind === 'tabsBlock') {
				const eolText = text(nextToken); /*.replace(
					new RegExp(`^[ \t]{1,${token.indent}}`, 'gm'),
					'',
				);*/
				if (maybeBlock.indent < minIndent)
					minIndent = maybeBlock.indent;
				node.value +=
					eolText +
					//text(nextToken) +
					//' '.repeat(Math.max(0, maybeBlock.indent - token.indent)) +
					text(maybeBlock); //.slice(maybeBlock.textStart);
				node.end = maybeBlock.end;
				nextToken = next();
			} else {
				backtrack(maybeBlock);
				node.value += '\n';
				break;
			}
		}

		normalizeBlock(node, minIndent);

		return node;
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
			case 'blockquote': {
				return inlineBlock(token);
			}
			case 'tabsBlock': {
				return tabsBlock(token);
			}
			case 'html': {
				next();
				return { ...token, block: true };
			}
			case 'li': {
				// This might be a tabsBlock
				if (token.indent > 4) return tabsBlock(token);

				return ul(token);
			}
			case 'ol': {
				return ol(token);
			}
			case 'hr': {
				next();
				return token;
			}
			case 'eol': {
				const after = next();
				if (after.kind === 'eof') return;
				//if (token.end - token.start === 1)
				//	return { ...token, kind: 'text', value: '' } as const;
				return top();
			}
			case 'setext': {
				// Node is most likely an hr
				if (token.level === 2 && token.length >= 3) {
					next();
					return {
						...token,
						kind: 'hr',
					} as const;
				}
				break;
			}
			case 'eof':
				return;
		}

		return p(token);
	}

	const root: NodeMap['root'] = {
		...createNode('root'),
		children: parseWhile(top),
	};

	parseInline();

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

/*const escapeStr = ['&lt;','&gt','&amp;']
function escapeHtml(src: string) {
	return src.replace(/[<>&]/g, ch => (ch === '<' ? '&lt;' : '&amp;'));
}*/

export function compiler(node: Node): string {
	switch (node.kind) {
		case 'root':
			return renderChildren(node.children) + '\n';
		case 'hr':
			return `<${node.kind} />`;
		case 'br':
			return `<${node.kind} />\n`;
		case 'code': {
			return `<code>${escapeHtml(node.value)}</code>`;
		}
		case 'link': {
			const title = node.title
				? ` title="${escapeHtml(node.title)}"`
				: '';
			return `<a href="${encodeURI(
				escapeHtml(node.href),
			)}"${title}>${escapeHtml(node.text)}</a>`;
		}
		case 'em':
		case 'b':
		case 'p':
		case 'blockquote':
		case 'ul':
		case 'ol':
			return renderChildren(node.children, node.kind);
		case 'li':
			if (node.pCount === 0) {
				const children: string = node.children
					.map(n =>
						n.kind === 'p'
							? renderChildren(n.children)
							: compiler(n),
					)
					.join('');
				return `<${node.kind}>${children}</${node.kind}>`;
			}
			return renderChildren(node.children, node.kind);
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
		const root = parserBlock(api);
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
