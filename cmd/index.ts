import { ParserApi, ScannerApi, matchers, stringEscape, text } from '../sdk/index.js';

export type ScannerToken = ReturnType<ReturnType<typeof scan>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords = ['fn', 'var', 'main'] as const;

type BaseNode = {
	start: number;
	end: number;
	line: number;
	source: string;
};
type WordNode = BaseNode & { kind: 'word' };
type CommandNode = BaseNode & {
	kind: 'command';
	parts: TermNode[];
	redirects: RedirectNode[];
};
type RedirectNode = BaseNode & {
	kind: 'redirect';
	operator: '>' | '>>' | '<';
	target: WordNode;
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
type RootNode = BaseNode & {
	kind: 'root';
	children: Node[];
};
type TermNode = WordNode | GroupNode;
export type Node =
	| RootNode
	| CommandNode
	| RedirectNode
	| GroupNode
	| BinaryNode
	| WordNode;

const {
	alpha,
	digitUnderscore: digit,
	hexDigitUnderscore: hexDigit,
	binaryDigitUnderscore: binaryDigit,
	ident,
} = matchers;

const identFirst = (ch: string) => ch === '_' || alpha(ch);
const notIdent = (ch: string) => ch === undefined || !ident(ch);
const notEol = (ch: string) => ch !== '\n';
const stringCh = (ch: string) => ch !== "'";

export function scan(source: string) {
	const {
		current,
		eof,
		tk,
		matchWhile,
		createTrieMatcher,
		error,
		skipWhitespace,
		backtrack,
		matchEnclosed,
	} = ScannerApi({ source });

	const keywordMatcher = createTrieMatcher(keywords, notIdent);

	function next() {
		skipWhitespace();

		if (eof()) return tk('eof', 0);

		const ch = current();
		const la = current(1);

		/* eslint no-fallthrough: off */
		switch (ch) {
			// 2-char operators
			case '=':
				return la === '='
					? tk('==', 2)
					: la === '>'
					? tk('=>', 2)
					: tk('=', 1);
			case '|':
				return la === '|' ? tk('||', 2) : tk('|', 1);
			case '&':
				return la === '&' ? tk('&&', 2) : tk('&', 1);
			case '>':
				return la === '='
					? tk('>=', 2)
					: la === '>'
					? tk('>>', 2)
					: tk('>', 1);
			case '<':
				return la === '='
					? tk('<=', 2)
					: la === '<'
					? tk('<<', 2)
					: la === ':'
					? tk('<:', 2)
					: tk('<', 1);
			case '!':
				return la === '=' ? tk('!=', 2) : tk('!', 1);
			case '+':
				return la === '+' ? tk('++', 2) : tk('+', 1);
			case '-':
				return la === '-' ? tk('--', 2) : tk('-', 1);
			case ':':
				return la === '>' ? tk(':>', 2) : tk(':', 1);
			// 1-char operators
			case '{':
			case '}':
			case '.':
			case ',':
			case '?':
			case '*':
			case '/':
			case '~':
			case '(':
			case ')':
			case '^':
			case '$':
			case '@':
			case '[':
			case ']':
				return tk(ch, 1);
			case "'": {
				const n = matchEnclosed(stringCh, stringEscape);
				if (current(n) !== "'") throw error('Unterminated string', n);
				return tk('string', n + 1);
			}
			case '#': {
				const n = matchWhile(notEol, 1);
				return tk('comment', n);
			}

			// Number
			case '0':
				if (la === 'x') {
					const consumed = matchWhile(hexDigit, 2);
					if (consumed === 2 || ident(current(consumed)))
						throw error('Expected hexadecimal digit', consumed + 1);
					return tk('number', consumed);
				}
				if (la === 'b') {
					const consumed = matchWhile(binaryDigit, 2);
					if (consumed === 2 || ident(current(consumed)))
						throw error('Expected binary digit', consumed + 1);
					return tk('number', consumed);
				}
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9': {
				let consumed = matchWhile(digit, 1);
				if (consumed && current(consumed) === '.') {
					const decimals = matchWhile(digit, ++consumed);
					if (decimals === consumed)
						throw error('Expected digit', consumed);
					consumed = decimals;
				}
				if (ident(current(consumed)))
					throw error('Expected digit', consumed + 1);

				return tk('number', consumed);
			}
			default: {
				// Keywords
				const keywordToken = keywordMatcher();
				if (keywordToken) return keywordToken;

				// Identifiers
				if (identFirst(ch)) return tk('ident', matchWhile(ident, 1));

				throw error(`Invalid character "${ch}"`, 1);
			}
		}
	}

	return { next, backtrack };
}

const controlKinds = new Set<Kind>([
	'eof',
	'comment',
	'|',
	'&&',
	'||',
	'>',
	'>>',
	'<',
	'(',
	')',
	'{',
	'}',
]);
const groupKinds: Record<string, true> = {
	'(': true,
	'{': true,
};

function isControl(kind: Kind) {
	return controlKinds.has(kind);
}

function createParser(source: string) {
	const api = ParserApi(scan);
	api.start(source);
	const { current, next, expect, error } = api;

	function parseWord(): WordNode {
		const first = current();
		if (isControl(first.kind))
			throw error(`Unexpected "${first.kind}"`, first);

		let end = first.end;
		next();
		while (current().kind !== 'eof') {
			const token = current();
			if (isControl(token.kind) || token.start !== end) break;
			end = token.end;
			next();
		}

		return {
			...first,
			kind: 'word',
			end,
		};
	}

	function parseGroup(): GroupNode {
		const opener = current();
		const openerKind = String(opener.kind);
		const closer = openerKind === '(' ? ')' : '}';
		next();
		const child = parseExpression();
		const close = expect(closer);
		return {
			...opener,
			kind: 'group',
			opener: openerKind === '(' ? '(' : '{',
			closer,
			children: [child],
			end: close.end,
		};
	}

	function parseAtom(): TermNode {
		const token = current();
		if (groupKinds[String(token.kind)]) return parseGroup();
		return parseWord();
	}

	function parseCommand(): CommandNode {
		const first = current();
		const parts: TermNode[] = [];
		const redirects: RedirectNode[] = [];
		let start = first.start;
		let end = first.end;

		while (String(current().kind) !== 'eof') {
			const token = current();
			const kind = String(token.kind);
			if (kind === 'comment' || kind === ')' || kind === '}') break;
			if (kind === '|' || kind === '&&' || kind === '||') break;
			if (kind === '>' || kind === '>>' || kind === '<') {
				next();
				const target = parseWord();
				redirects.push({
					...token,
					kind: 'redirect',
					operator: kind === '>' ? '>' : kind === '>>' ? '>>' : '<',
					target,
					end: target.end,
				});
				end = target.end;
				continue;
			}

			const atom = parseAtom();
			parts.push(atom);
			start = parts[0]?.start ?? start;
			end = atom.end;
		}

		if (!parts.length && !redirects.length)
			throw error('Expected command', first);

		return {
			...first,
			kind: 'command',
			start,
			end,
			parts,
			redirects,
		};
	}

	function parsePipe(): Node {
		let left: Node = parseCommand();
		while (String(current().kind) === '|') {
			const op = current();
			next();
			const right = parseCommand();
			left = {
				...op,
				kind: '|',
				start: left.start,
				children: [left, right],
				end: right.end,
			} as BinaryNode;
		}
		return left;
	}

	function parseLogical(): Node {
		let left: Node = parsePipe();
		while (String(current().kind) === '&&' || String(current().kind) === '||') {
			const op = current();
			next();
			const right = parsePipe();
			left = {
				...op,
				start: left.start,
				children: [left, right],
				end: right.end,
			} as BinaryNode;
		}
		return left;
	}

	function parseExpression(): Node {
		return parseLogical();
	}

	function parseRoot(): RootNode {
		const children: Node[] = [];
		while (String(current().kind) !== 'eof') {
			if (String(current().kind) === 'comment') {
				next();
				continue;
			}
			children.push(parseExpression());
		}
		const eof = current();
		return {
			...eof,
			kind: 'root',
			children,
		};
	}

	return {
		parse: parseRoot,
	};
}

function compileWord(node: WordNode) {
	return text(node);
}

function compileNode(node: Node): string {
	switch (node.kind) {
		case 'root':
			return node.children.map(compileNode).join('\n');
		case 'word':
			return compileWord(node);
		case 'group':
			return (node.opener as string) === '('
				? `(${compileNode(node.children[0])})`
				: `{ ${compileNode(node.children[0])} ; }`;
		case 'command':
			return [
				...node.parts.map(compileNode),
				...node.redirects.map(
					r => `${r.operator} ${compileWord(r.target)}`,
				),
			].join(' ');
		case 'redirect':
			return `${node.operator} ${compileWord(node.target)}`;
		case '|':
		case '&&':
		case '||':
			return `${compileNode(node.children[0])} ${node.kind} ${compileNode(
				node.children[1],
			)}`;
		default:
			return '';
	}
}

export function compiler(node: Node) {
	return compileNode(node);
}

export function program() {
	function parse(src: string) {
		const parser = createParser(src);
		const root = parser.parse();
		return { root, errors: [] as never[] };
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
		parse,
		compile,
	};
}
