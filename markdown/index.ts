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
	li: { children: Children; indent: number; pCount: number };
	eol: { count: number };
	text: { value: string; children?: Node[] };
	hr: {};
	br: {};
	block: { info?: string; value: string };
	blockquote: { children: Children; pCount: number };
	link: { href: string; text: string; title?: string };
	html: {};
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
const htmlChar = (ch: string) => alpha(ch) || ch === '-';
//const isSpaceOrEol = (c: string) => c === ' ' || c === '\t' || c === '\n';
const isHash = (c: string) => c === '#';
const notStartInline = (ch: string) =>
	ch !== '`' &&
	ch !== '\n' &&
	ch !== '_' &&
	ch !== '*' &&
	ch !== '<' &&
	ch !== '[';
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

export function matchHtml(
	{ matchWhile, matchUntil }: ReturnType<typeof ScannerApi>,
	start: number,
) {
	const tagNameEnd = matchWhile(htmlChar, start);
	const closing = matchUntil(c => c === '>', tagNameEnd + 1);
	if (closing > tagNameEnd + 1) {
		return closing + 1;
	}
	return 0;
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
		//createTrieMatcher,
	} = api;

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
			const block = tk('tabsBlock', matchUntil(isEol, textStart));
			return { ...block, textStart, indent };
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
				const scheme = matchWhile(alpha, textStart + 1);
				if (scheme - textStart > 1 && current(scheme) === ':') {
					const host = matchWhile(
						n => n !== '>' && n !== ' ' && n !== '<',
						scheme + 1,
					);
					// Check for invalid URL
					if (current(host) === '>') return tk('autolink', host + 1);
				}
				// can it be HTML ?
				const maybeHtml = matchHtml(api, scheme + 1);
				if (maybeHtml > scheme + 1) return tk('html', maybeHtml);

				return tk('text', scheme);
			}
			case '[': {
				const linkTextEnd = matchEnclosed(c => c !== ']', escape);
				if (
					current(linkTextEnd) === ']' &&
					current(linkTextEnd + 1) === '('
				) {
					const linkEnd = matchEnclosed(
						c => c !== ')' && c !== ' ' && c !== '\t' && c !== '\n',
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
	const { current, tk, matchWhile, backtrack, eof, matchUntil } = api;

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

		if (afterSpace === '\n') return tk('eol', matchWhile(isEol, textStart));

		if (indent < 4 && (afterSpace === '`' || afterSpace === '~')) {
			const start = matchWhile(n => n === afterSpace, textStart);
			const len = start - textStart;
			if (len >= 3) {
				const { consumed, blockStart, lineStart, lineCount } =
					matchBlock(
						api,
						afterSpace,
						len,
						start,
						(n, indent) => current(n) === '\n' && indent < 4,
					);

				if (lineCount)
					return {
						...tk('block', consumed),
						blockEnd: lineStart + 1 || consumed,
						blockStart,
						indent,
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

		if (indent === 0 && afterSpace === '<') {
			const scheme = matchWhile(alpha, textStart + 1);
			// Ignore Autolink
			if (current(scheme) !== ':') {
				const maybeHtml = matchHtml(api, textStart);
				if (maybeHtml > textStart) return tk('html', maybeHtml);
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

		const textEnd = matchUntil(isEol);
		// handle setext headings
		if (current(textEnd) === '\n') {
			const { indent, textStart: lineStart } = countSpaces(
				matchWhile,
				textEnd + 1,
			);
			if (indent < 4) {
				const startChar = current(lineStart + 1);
				if (startChar === '=' || startChar === '-') {
					const lineLen = matchWhile(
						c => c === startChar,
						lineStart + 2,
					);
					const trailing = matchWhile(isSpace, lineLen);
					if (current(trailing) === '\n' || trailing !== lineLen)
						return {
							...tk('heading', trailing),
							level: startChar === '=' ? 1 : 2,
							textStart,
							textEnd,
							textIndent: indent,
						};
				}
			}
		}

		return tk('text', matchUntil(isEol));
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
				const href = text(token).slice(1, -1);
				next();
				return { ...token, kind: 'link', href, text: href };
			}
			case 'link': {
				const src = text(token);
				const content = src.slice(1, token.linkTextEnd);
				const href = unescapeText(
					src.slice(token.linkTextEnd + 2, token.linkEnd),
				);
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
				return token;
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
		while (child) {
			const token = next();
			if (token.kind === 'eol' && token.end - token.start === 1) {
				const nextToken = next();

				if (nextToken.kind === 'text') {
					nextToken.start = token.start;
					child.value += text(nextToken); //)'\n' + text(nextToken);
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
				if (token.end - token.start > 1) {
					pCount++;
					return handleNewLine(indent);
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
				const node: NodeMap['block'] = {
					...token,
					kind: 'block',
					value: text(token).slice(token.textStart),
				};
				let nextToken = next();

				while (nextToken.kind === 'eol') {
					const maybeBlock = next();
					if (maybeBlock.kind === 'tabsBlock') {
						node.value +=
							text(nextToken) +
							text(maybeBlock).slice(maybeBlock.textStart);
						node.end = maybeBlock.end;
						nextToken = next();
					} else {
						backtrack(maybeBlock);
						node.value += '\n';
						break;
					}
				}

				return node;
			}
			case 'html': {
				next();
				return token;
			}
			case 'li': {
				return ul(token);
			}
			case 'hr': {
				next();
				return token;
			}
			case 'eol': {
				const after = next();
				if (after.kind === 'eof') return;
				if (token.end - token.start === 1)
					return { ...token, kind: 'text', value: '\n' } as const;
				return top();
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
			return `<a href="${encodeURI(node.href)}"${title}>${escapeHtml(
				node.text,
			)}</a>`;
		}
		case 'em':
		case 'b':
		case 'p':
		case 'ul':
			return renderChildren(node.children, node.kind);
		case 'blockquote':
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
			return text(node);
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
