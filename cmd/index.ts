import {
	MakeNodeMap,
	ParserApi,
	ScannerApi,
	text,
} from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords: readonly string[] = [];

type BaseNodeMap = {
	word: {
		value: string | undefined;
		literal: boolean;
		hasExpansion: boolean;
		hasParameterExpansion: boolean;
		hasCommandSubstitution: boolean;
		hasBackticks: boolean;
		hasNonliteralConstruct: boolean;
	};
	redirect: {
		operator: RedirectOperator;
		io?: WordNode;
		target: WordNode;
		children: WordNode[];
	};
	command: {
		parts: TermNode[];
		redirects: RedirectNode[];
		children: (TermNode | RedirectNode)[];
	};
	group: {
		opener: '(' | '{';
		closer: ')' | '}';
		children: [Node];
	};
	'|': { children: [Node, Node] };
	'&&': { children: [Node, Node] };
	'||': { children: [Node, Node] };
	list: {
		children: Node[];
		separators: (';' | '&' | 'newline')[];
	};
	root: { children: Node[] };
};
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type WordNode = NodeMap['word'];
type RedirectOperator =
	| '>'
	| '>>'
	| '<'
	| '<>'
	| '>|'
	| '<<'
	| '<<-'
	| '<&'
	| '>&';
type RedirectNode = NodeMap['redirect'];
type CommandNode = NodeMap['command'];
type GroupNode = NodeMap['group'];
type ListNode = NodeMap['list'];
type RootNode = NodeMap['root'];
type TermNode = WordNode | GroupNode;
export type Node = NodeMap[keyof NodeMap];

const operators = [
	'<<-',
	'&&',
	'||',
	'>>',
	'<<',
	'<>',
	'>|',
	'<&',
	'>&',
	'|',
	';',
	'&',
	'>',
	'<',
	'(',
	')',
	'{',
	'}',
] as const;

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r';
const isControl = (ch: string) =>
	ch === '' || ch === '\n' || isSpace(ch) || '|&;(){}<>'.includes(ch);
const isNameStart = (ch: string) => /[A-Za-z_]/.test(ch);
const isSpecialParameter = (ch: string) => '@*#?$!-0123456789'.includes(ch);

type WordState = Omit<WordNode, 'start' | 'end' | 'line' | 'source' | 'kind'>;

function decodeAnsiEscape(source: string, index: number) {
	const ch = source[index];
	if (!ch) return { value: '\\', end: index };
	const simple: Record<string, string> = {
		a: '\u0007',
		b: '\b',
		e: '\u001b',
		E: '\u001b',
		f: '\f',
		n: '\n',
		r: '\r',
		t: '\t',
		v: '\v',
		'\\': '\\',
		"'": "'",
		'"': '"',
		'?': '?',
	};
	if (ch in simple) return { value: simple[ch], end: index + 1 };
	if (/[0-7]/.test(ch)) {
		let end = index + 1;
		while (end < index + 3 && /[0-7]/.test(source.charAt(end))) end++;
		return { value: String.fromCharCode(parseInt(source.slice(index, end), 8)), end };
	}
	if (ch === 'x' || ch === 'u' || ch === 'U') {
		const limit = ch === 'x' ? 2 : ch === 'u' ? 4 : 8;
		let end = index + 1;
		while (end < index + 1 + limit && /[0-9A-Fa-f]/.test(source.charAt(end))) end++;
		if (end > index + 1) {
			const value = parseInt(source.slice(index + 1, end), 16);
			return { value: String.fromCodePoint(value), end };
		}
	}
	if (ch === 'c' && source[index + 1])
		return { value: String.fromCharCode(source.charCodeAt(index + 1) % 32), end: index + 2 };
	return { value: `\\${ch}`, end: index + 1 };
}

function inspectWord({ source, start, end }: ScannerToken): WordState {
	let value = '';
	let index = start;
	const state = {
		hasParameterExpansion: false,
		hasCommandSubstitution: false,
		hasBackticks: false,
		hasNonliteralConstruct: false,
	};

	const markParameter = () => {
		state.hasParameterExpansion = true;
		state.hasNonliteralConstruct = true;
	};
	const markCommand = () => {
		state.hasCommandSubstitution = true;
		state.hasNonliteralConstruct = true;
	};
	const markOther = () => {
		state.hasNonliteralConstruct = true;
	};

	function readQuoted(quote: "'" | '"', ansi = false) {
		index++;
		while (index < end && source[index] !== quote) {
			const ch = source.charAt(index);
			if (ch === '\\') {
				if (ansi) {
					const escape = decodeAnsiEscape(source, index + 1);
					value += escape.value;
					index = escape.end;
					continue;
				}
				const next = source[index + 1];
				if (quote === '"' && next && '$`"\\\n'.includes(next)) {
					if (next !== '\n') value += next;
					index += 2;
					continue;
				}
				if (quote === "'" || next === undefined) {
					value += '\\';
					index++;
					continue;
				}
				value += `\\${next}`;
				index += 2;
				continue;
			}
			if (quote === '"' && ch === '$') {
				readDollar();
				continue;
			}
			if (quote === '"' && ch === '`') {
				state.hasBackticks = true;
				markCommand();
				index++;
				continue;
			}
			value += ch;
			index++;
		}
		if (source[index] === quote) index++;
	}

	function readDollar() {
		const next = source[index + 1];
		if (next === "'") {
			index++;
			readQuoted("'", true);
			return;
		}
		if (next === '(') {
			if (source[index + 2] === '(') markOther();
			else markCommand();
			index += 2;
			return;
		}
		if (next === '"') markOther();
		if (next === '{' || (next !== undefined && (isNameStart(next) || isSpecialParameter(next)))) {
			markParameter();
			index += 2;
			return;
		}
		value += '$';
		index++;
	}

	while (index < end) {
		const ch = source.charAt(index);
		if (ch === "'") {
			readQuoted("'");
			continue;
		}
		if (ch === '"') {
			readQuoted('"');
			continue;
		}
		if (ch === '$') {
			readDollar();
			continue;
		}
		if (ch === '`') {
			state.hasBackticks = true;
			markCommand();
			index++;
			continue;
		}
		if (ch === '\\') {
			const next = source[index + 1];
			if (next === '\n') index += 2;
			else {
				value += next ?? '\\';
				index += next === undefined ? 1 : 2;
			}
			continue;
		}
		if (
			(index === start && ch === '~') ||
			ch === '*' ||
			ch === '?' ||
			ch === '[' ||
			ch === ']' ||
			ch === '{' ||
			ch === '}'
		)
			markOther();
		value += ch;
		index++;
	}

	const hasExpansion = state.hasNonliteralConstruct;
	return {
		value: state.hasNonliteralConstruct ? undefined : value,
		literal: !state.hasNonliteralConstruct,
		hasExpansion,
		hasParameterExpansion: state.hasParameterExpansion,
		hasCommandSubstitution: state.hasCommandSubstitution,
		hasBackticks: state.hasBackticks,
		hasNonliteralConstruct: state.hasNonliteralConstruct,
	};
}

export function scan(source: string) {
	const { current, eof, tk, matchString, matchUntil, error, skip, backtrack } = ScannerApi({
		source,
	});

	function scanQuoted(quote: string, consumed: number) {
		for (;;) {
			const ch = current(consumed);
			if (!ch) throw error('Unterminated string', consumed);
			if (ch === quote) return consumed + 1;
			if (ch === '\\' && current(consumed + 1)) {
				consumed += 2;
				continue;
			}
			consumed++;
		}
	}

	function scanEnclosed(open: string, close: string, consumed: number) {
		const matches = (value: string, offset: number) =>
			[...value].every((ch, index) => current(offset + index) === ch);
		let depth = 1;
		while (depth) {
			const ch = current(consumed);
			if (!ch) throw error(`Unterminated ${open}${close} expansion`, consumed);
			if (ch === "'" || ch === '"') {
				consumed = scanQuoted(ch, consumed + 1);
				continue;
			}
			if (ch === '\\' && current(consumed + 1)) {
				consumed += 2;
				continue;
			}
			if (matches(open, consumed)) {
				depth++;
				consumed += open.length;
			} else if (matches(close, consumed)) {
				depth--;
				consumed += close.length;
			} else consumed++;
		}
		return consumed;
	}

	function scanWord() {
		let consumed = 0;
		while (!isControl(current(consumed))) {
			const ch = current(consumed);
			if (ch === "'" || ch === '"') {
				consumed = scanQuoted(ch, consumed + 1);
				continue;
			}
			if (ch === '\\' && current(consumed + 1)) {
				consumed += 2;
				continue;
			}
			if (ch === '$' && current(consumed + 1) === '(')
				consumed = scanEnclosed('(', ')', consumed + 2);
			else if (ch === '$' && current(consumed + 1) === '{')
				consumed = scanEnclosed('{', '}', consumed + 2);
			else if (ch === '`') consumed = scanQuoted('`', consumed + 1);
			else consumed++;
		}
		return tk('word', consumed);
	}

	function next() {
		while (isSpace(current())) skip();
		if (eof()) return tk('eof', 0);
		if (current() === '\n') return tk('newline', 1);
		if (current() === '#') return tk('comment', matchUntil(ch => ch === '\n'));
		for (const operator of operators) {
			const consumed = matchString(operator);
			if (consumed) return tk(operator, consumed);
		}
		return scanWord();
	}

	return { next, backtrack };
}

function isRedirectKind(kind: Kind): kind is RedirectOperator {
	return (
		kind === '>' ||
		kind === '>>' ||
		kind === '<' ||
		kind === '<>' ||
		kind === '>|' ||
		kind === '<<' ||
		kind === '<<-' ||
		kind === '<&' ||
		kind === '>&'
	);
}
const commandEndKinds = new Set<Kind>([
	'eof',
	'comment',
	'newline',
	';',
	'&',
	'|',
	'&&',
	'||',
	')',
	'}',
]);

function createParser(source: string) {
	const api = ParserApi(scan);
	api.start(source);
	const { current, next, consume, error, errors, catchAndRecover, pushError } = api;

	function parseWord(): WordNode {
		const token = current();
		if (token.kind !== 'word') throw error('Expected shell word', token);
		next();
		return { ...token, kind: 'word', ...inspectWord(token) };
	}

	function parseGroup(): GroupNode {
		const opener = current();
		const openerKind = opener.kind;
		const closer = openerKind === '(' ? ')' : '}';
		next();
		const child = parseList();
		const close = catchAndRecover(
			() => consume(closer),
			() => undefined,
		);
		return {
			...opener,
			kind: 'group',
			opener: openerKind === '(' ? '(' : '{',
			closer,
			children: [child],
			end: close?.end ?? child.end,
		};
	}

	function parseRedirect(io?: WordNode): RedirectNode {
		const operator = current();
		if (!isRedirectKind(operator.kind)) throw error('Expected redirect', operator);
		next();
		const target = parseWord();
		return {
			...operator,
			kind: 'redirect',
			operator: operator.kind,
			io,
			target,
			children: io ? [io, target] : [target],
			start: io?.start ?? operator.start,
			end: target.end,
		};
	}

	function parseCommand(): CommandNode {
		const first = current();
		const parts: TermNode[] = [];
		const redirects: RedirectNode[] = [];
		const children: (TermNode | RedirectNode)[] = [];
		let end = first.end;
		while (!commandEndKinds.has(current().kind)) {
			if (isRedirectKind(current().kind)) {
				const previous = parts.at(-1);
				const io =
					previous?.kind === 'word' &&
					previous.end === current().start &&
					/^\d+$/.test(text(previous))
						? previous
						: undefined;
				if (io) {
					parts.pop();
					children.pop();
				}
				const redirect = catchAndRecover(
					() => parseRedirect(io),
					() => undefined,
				);
				if (!redirect) {
					if (io) {
						parts.push(io);
						children.push(io);
						end = io.end;
					}
					break;
				}
				redirects.push(redirect);
				children.push(redirect);
				end = redirect.end;
				continue;
			}
			const part = current().kind === '(' || current().kind === '{'
				? parseGroup()
				: parseWord();
			parts.push(part);
			children.push(part);
			end = part.end;
		}
		if (!parts.length && !redirects.length) throw error('Expected command', first);
		return {
			...first,
			kind: 'command',
			start: first.start,
			end,
			parts,
			redirects,
			children,
		};
	}

	function parsePipe(): Node {
		let left: Node = parseCommand();
		while (current().kind === '|') {
			const operator = current();
			next();
			const right = catchAndRecover(
				() => parseCommand(),
				() => undefined,
			);
			if (!right) break;
			left = {
				...operator,
				kind: '|',
				start: left.start,
				end: right.end,
				children: [left, right],
			};
		}
		return left;
	}

	function parseLogical(): Node {
		let left = parsePipe();
		while (current().kind === '&&' || current().kind === '||') {
			const operator = current();
			const kind = operator.kind === '&&' ? '&&' : '||';
			next();
			const right = catchAndRecover(
				() => parsePipe(),
				() => undefined,
			);
			if (!right) break;
			left = {
				...operator,
				kind,
				start: left.start,
				end: right.end,
				children: [left, right],
			};
		}
		return left;
	}

	function parseList(): ListNode {
		const first = current();
		const children: Node[] = [];
		const separators: ListNode['separators'] = [];
		while (current().kind !== 'eof' && current().kind !== ')' && current().kind !== '}') {
			if (current().kind === 'comment') {
				next();
				continue;
			}
			if (current().kind === 'newline') {
				next();
				continue;
			}
			const child = catchAndRecover(
				() => parseLogical(),
				() => {
					while (
						current().kind !== 'eof' &&
						current().kind !== ')' &&
						current().kind !== '}' &&
						current().kind !== ';' &&
						current().kind !== '&' &&
						current().kind !== 'newline'
					)
						next();
					return undefined;
				},
			);
			if (child) children.push(child);
			if (current().kind === ';' || current().kind === '&' || current().kind === 'newline') {
				separators.push(
					current().kind === ';'
						? ';'
						: current().kind === '&'
							? '&'
							: 'newline',
				);
				next();
			}
		}
		const last = children.at(-1) ?? first;
		return {
			...first,
			kind: 'list',
			children,
			separators,
			start: children[0]?.start ?? first.start,
			end: last.end,
		};
	}

	function parseRoot(): RootNode {
		const list = parseList();
		while (current().kind !== 'eof') {
			const unexpected = current();
			pushError(error(`Unexpected "${unexpected.kind}"`, unexpected));
			next();
			const recovered = parseList();
			if (recovered.children.length) {
				if (list.children.length) list.separators.push('newline');
				list.children.push(...recovered.children);
				list.separators.push(...recovered.separators);
				list.end = recovered.end;
			}
		}
		const eof = current();
		return {
			...eof,
			kind: 'root',
			children: list.children.length ? [list] : [],
			start: 0,
			end: source.length,
		};
	}

	return { parse: parseRoot, errors };
}
function compileNode(node: Node): string {
	switch (node.kind) {
		case 'root':
			return node.children.map(compileNode).join('\n');
		case 'list':
			return node.children
				.map((child, index) => {
					const separator = node.separators[index];
					return `${compileNode(child)}${
						separator === 'newline' ? '\n' : separator ? ` ${separator} ` : ''
					}`;
				})
				.join('')
				.trimEnd();
		case 'word':
			return text(node);
		case 'group':
			return node.opener === '('
				? `(${compileNode(node.children[0])})`
				: `{ ${compileNode(node.children[0])} ; }`;
		case 'command':
			return [...node.parts.map(compileNode), ...node.redirects.map(compileNode)].join(' ');
		case 'redirect':
			return `${node.io ? compileNode(node.io) : ''}${node.operator} ${compileNode(node.target)}`;
		case '|':
		case '&&':
		case '||':
			return `${compileNode(node.children[0])} ${node.kind} ${compileNode(node.children[1])}`;
	}
}

export function compiler(node: Node) {
	return compileNode(node);
}

export function program() {
	function parse(src: string) {
		const parser = createParser(src);
		const root = parser.parse();
		return { root, errors: parser.errors };
	}

	function compile(src: string) {
		const parsed = parse(src);
		return { output: compiler(parsed.root), ast: parsed.root, errors: parsed.errors };
	}

	return { parse, compile };
}
