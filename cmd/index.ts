import { ParserApi, ScannerApi, text } from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords: readonly string[] = [];

type BaseNode = {
	start: number;
	end: number;
	line: number;
	source: string;
};
type WordNode = BaseNode & { kind: 'word' };
type RedirectOperator = '>' | '>>' | '<' | '<>' | '>|' | '<<' | '<<-' | '<&' | '>&';
type RedirectNode = BaseNode & {
	kind: 'redirect';
	operator: RedirectOperator;
	io?: WordNode;
	target: WordNode;
};
type CommandNode = BaseNode & {
	kind: 'command';
	parts: TermNode[];
	redirects: RedirectNode[];
};
type GroupNode = BaseNode & {
	kind: 'group';
	opener: '(' | '{';
	closer: ')' | '}';
	children: [Node];
};
type BinaryNode = BaseNode & {
	kind: '|' | '&&' | '||';
	children: [Node, Node];
};
type ListNode = BaseNode & {
	kind: 'list';
	children: Node[];
	separators: (';' | '&' | 'newline')[];
};
type RootNode = BaseNode & { kind: 'root'; children: Node[] };
type TermNode = WordNode | GroupNode;
export type Node =
	| RootNode
	| ListNode
	| CommandNode
	| RedirectNode
	| GroupNode
	| BinaryNode
	| WordNode;

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
	const { current, next, consume, error } = api;

	function parseWord(): WordNode {
		const token = current();
		if (token.kind !== 'word') throw error('Expected shell word', token);
		next();
		return { ...token, kind: 'word' };
	}

	function parseGroup(): GroupNode {
		const opener = current();
		const openerKind = opener.kind;
		const closer = openerKind === '(' ? ')' : '}';
		next();
		const child = parseList();
		const close = consume(closer);
		return {
			...opener,
			kind: 'group',
			opener: openerKind === '(' ? '(' : '{',
			closer,
			children: [child],
			end: close.end,
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
			end: target.end,
		};
	}

	function parseCommand(): CommandNode {
		const first = current();
		const parts: TermNode[] = [];
		const redirects: RedirectNode[] = [];
		let end = first.end;
		while (!commandEndKinds.has(current().kind)) {
			if (isRedirectKind(current().kind)) {
				const previous = parts.at(-1);
				const io =
					previous?.kind === 'word' &&
					previous.end === current().start &&
					/^\d+$/.test(text(previous))
						? (parts.pop(), previous)
						: undefined;
				const redirect = parseRedirect(io);
				redirects.push(redirect);
				end = redirect.end;
				continue;
			}
			const part = current().kind === '(' || current().kind === '{'
				? parseGroup()
				: parseWord();
			parts.push(part);
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
		};
	}

	function parsePipe(): Node {
		let left: Node = parseCommand();
		while (current().kind === '|') {
			const operator = current();
			next();
			const right = parseCommand();
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
			const right = parsePipe();
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
			children.push(parseLogical());
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
		const eof = current();
		return { ...eof, kind: 'root', children: list.children.length ? [list] : [] };
	}

	return { parse: parseRoot };
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
		const root = createParser(src).parse();
		return { root, errors: [] };
	}

	function compile(src: string) {
		const parsed = parse(src);
		return { output: compiler(parsed.root), ast: parsed.root, errors: parsed.errors };
	}

	return { parse, compile };
}
