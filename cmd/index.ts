import {
	MakeNodeMap,
	ParserApi,
	ScannerApi,
	text,
} from '../sdk/index.js';

export type Dialect = 'posix' | 'ide';
export interface ProgramOptions {
	dialect?: Dialect;
}

export type ScannerToken = ReturnType<ReturnType<typeof createScanner>['next']>;
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
	type: {
		name: string;
	};
	parameter: {
		name: WordNode;
		type: TypeNode;
		optional: boolean;
		rest: boolean;
		children: [WordNode, TypeNode];
	};
	typealias: {
		name: WordNode;
		target: TypeNode;
		children: [WordNode, TypeNode];
	};
	function: {
		name: WordNode;
		parameters: ParameterNode[];
		returnType?: TypeNode;
		body?: GroupNode;
		redirects: RedirectNode[];
		children: (WordNode | ParameterNode | TypeNode | GroupNode | RedirectNode)[];
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
type TypeNode = NodeMap['type'];
type ParameterNode = NodeMap['parameter'];
type TypeAliasNode = NodeMap['typealias'];
type FunctionNode = NodeMap['function'];
type GroupNode = NodeMap['group'];
type ListNode = NodeMap['list'];
type RootNode = NodeMap['root'];
type TermNode = WordNode | GroupNode;
export type Node = NodeMap[keyof NodeMap];

export enum IrKind {
	Word,
	Redirect,
	Command,
	Type,
	Parameter,
	TypeAlias,
	Function,
	Group,
	Pipe,
	And,
	Or,
	List,
}

export enum IrWordFlags {
	ParameterExpansion = 1,
	CommandSubstitution = 2,
	Backticks = 4,
	Other = 8,
}

export enum IrParameterFlags {
	Optional = 1,
	Rest = 2,
}

export enum IrGroupOpener {
	Parenthesis,
	Brace,
}

export enum IrRedirectOperator {
	Write,
	Append,
	Read,
	ReadWrite,
	Clobber,
	HereDocument,
	HereDocumentStrip,
	DuplicateInput,
	DuplicateOutput,
}

export enum IrSeparator {
	Semicolon,
	Background,
	Newline,
}

export type IrWordNode = [kind: IrKind.Word, value: string, flags?: number];
export type IrRedirectNode = [
	kind: IrKind.Redirect,
	operator: IrRedirectOperator,
	target: IrWordNode,
	io?: IrWordNode,
];
export type IrCommandNode = [
	kind: IrKind.Command,
	...children: (IrWordNode | IrGroupNode | IrRedirectNode)[],
];
export type IrTypeNode = [kind: IrKind.Type, name: string];
export type IrParameterNode = [
	kind: IrKind.Parameter,
	name: string,
	type: string,
	flags?: number,
];
export type IrTypeAliasNode = [
	kind: IrKind.TypeAlias,
	name: string,
	target: string,
];
export type IrFunctionNode = [
	kind: IrKind.Function,
	name: string,
	...children: (
		| IrParameterNode
		| IrTypeNode
		| IrGroupNode
		| IrRedirectNode
	)[],
];
export type IrGroupNode = [
	kind: IrKind.Group,
	opener: IrGroupOpener,
	child: IrListNode,
];
export type IrBinaryNode = [
	kind: IrKind.Pipe | IrKind.And | IrKind.Or,
	left: IrNode,
	right: IrNode,
];
export type IrListNode = [
	kind: IrKind.List,
	separators: IrSeparator[],
	...children: IrNode[],
];
export type IrNode =
	| IrWordNode
	| IrRedirectNode
	| IrCommandNode
	| IrTypeNode
	| IrParameterNode
	| IrTypeAliasNode
	| IrFunctionNode
	| IrGroupNode
	| IrBinaryNode
	| IrListNode;
export type Ir = [version: 1, root?: IrListNode];

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
const portableName = /^[A-Za-z_]\w*$/;
const ideCommandName = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*!?$/;
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

function createScanner(source: string) {
	const { current, eof, tk, matchString, matchUntil, error, skip, backtrack } = ScannerApi({
		source,
	});
	let signature = false;

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
		while (
			!isControl(current(consumed)) &&
			(!signature || !':,=?'.includes(current(consumed)))
		) {
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
		if (signature) {
			const rest = matchString('...');
			if (rest) return tk('...', rest);
			if (current() === ':') return tk(':', 1);
			if (current() === ',') return tk(',', 1);
			if (current() === '=') return tk('=', 1);
			if (current() === '?') return tk('?', 1);
		}
		for (const operator of operators) {
			const consumed = matchString(operator);
			if (consumed) return tk(operator, consumed);
		}
		return scanWord();
	}

	return {
		next,
		backtrack,
		setSignature(value: boolean) {
			signature = value;
		},
	};
}

export function scan(source: string) {
	const { next, backtrack } = createScanner(source);
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

function createParser(source: string, options: ProgramOptions = {}) {
	let scanner!: ReturnType<typeof createScanner>;
	const api = ParserApi(src => (scanner = createScanner(src)));
	api.start(source);
	const dialect = options.dialect ?? 'posix';
	const aliases = new Set<string>();
	const {
		current,
		next,
		consume,
		error,
		errors,
		catchAndRecover,
		pushError,
		backtrack,
	} = api;

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

	function isPortableName(node: WordNode) {
		return portableName.test(text(node));
	}

	function parseType(): TypeNode {
		const token = current();
		if (token.kind !== 'word') throw error('Expected type name', token);
		const name = text(token);
		if (!portableName.test(name))
			throw error('Expected type name', token);
		next();
		return { ...token, kind: 'type', name };
	}

	function isFunctionDefinition() {
		const name = current();
		if (name.kind !== 'word') return false;
		let start = name.end;
		while (isSpace(source.charAt(start))) start++;
		if (source.charAt(start) !== '(') return false;
		const end = source.indexOf(')', start + 1);
		if (end < 0) return false;
		const signature = source.slice(start + 1, end).trim();
		return signature === '' || (dialect === 'ide' && signature.includes(':'));
	}

	function isTypeAlias() {
		return (
			dialect === 'ide' &&
			current().kind === 'word' &&
			text(current()) === 'type' &&
			/^[ \t]+\S+[ \t]*=/.test(source.slice(current().end))
		);
	}

	function parseTypeAlias(): TypeAliasNode {
		let keyword!: WordNode;
		let name!: WordNode;
		let target!: TypeNode;
		scanner.setSignature(true);
		try {
			keyword = parseWord();
			name = parseWord();
			if (!isPortableName(name)) throw error('Expected type alias name', name);
			consume('=');
			target = parseType();
		} finally {
			scanner.setSignature(false);
		}
		const aliasName = text(name);
		if (aliases.has(aliasName))
			pushError(error(`Duplicate type alias "${aliasName}"`, name));
		else aliases.add(aliasName);
		return {
			...keyword,
			kind: 'typealias',
			name,
			target,
			children: [name, target],
			end: target.end,
		};
	}

	function parseFunctionName() {
		const name = parseWord();
		const functionName = text(name);
		if (
			!(dialect === 'ide'
				? ideCommandName.test(functionName)
				: portableName.test(functionName))
		)
			throw error(
				dialect === 'ide'
					? 'Expected IDE command name'
					: 'Expected portable function name',
				name,
			);
		return name;
	}

	function parseParameter(parameterNames: Set<string>, optionalSeen: boolean) {
		const parameterStart = current();
		const rest = current().kind === '...';
		if (rest) next();
		const name = parseWord();
		if (!isPortableName(name)) throw error('Expected parameter name', name);
		const optional = current().kind === '?';
		if (optional) next();
		if (rest && optional)
			pushError(error('Rest parameter cannot be optional', name));
		if (!optional && !rest && optionalSeen)
			pushError(error('Required parameter cannot follow optional parameter', name));
		consume(':');
		const type = parseType();
		const value = text(name);
		if (parameterNames.has(value))
			pushError(error(`Duplicate parameter "${value}"`, name));
		else parameterNames.add(value);
		return {
			parameter: {
				...name,
				kind: 'parameter',
				start: parameterStart.start,
				name,
				type,
				optional,
				rest,
				children: [name, type],
				end: type.end,
			} satisfies ParameterNode,
			optionalSeen: optionalSeen || optional,
		};
	}

	function parseFunctionSignature() {
		const parameters: ParameterNode[] = [];
		let returnType: TypeNode | undefined;
		scanner.setSignature(true);
		try {
			consume('(');
			const parameterNames = new Set<string>();
			let optionalSeen = false;
			while (current().kind !== ')') {
				const parsed = parseParameter(parameterNames, optionalSeen);
				parameters.push(parsed.parameter);
				optionalSeen = parsed.optionalSeen;
				if (current().kind !== ',') break;
				if (parsed.parameter.rest)
					pushError(error('Rest parameter must be last', parsed.parameter.name));
				next();
			}
			const close = consume(')');
			if (current().kind === ':') {
				next();
				returnType = parseType();
			}
			return { parameters, returnType, end: returnType?.end ?? close.end };
		} finally {
			scanner.setSignature(false);
		}
	}

	function parseFunctionBody() {
		if (current().kind === '(' || current().kind === '{') return parseGroup();
		if (current().kind === 'newline' || current().kind === 'comment') {
			const boundary = current();
			while (current().kind === 'newline' || current().kind === 'comment') next();
			if (current().kind === '(' || current().kind === '{') return parseGroup();
			if (dialect === 'ide') {
				backtrack(boundary);
				return;
			}
		}
		if (
			dialect === 'ide' &&
			['eof', ';', '&', ')', '}'].includes(current().kind)
		)
			return;
		throw error('Expected function body', current());
	}

	function parseFunction(): FunctionNode {
		const name = parseFunctionName();
		const { parameters, returnType, end } = parseFunctionSignature();
		const body = parseFunctionBody();
		const redirects: RedirectNode[] = [];
		while (body) {
			if (isRedirectKind(current().kind)) {
				redirects.push(parseRedirect());
				continue;
			}
			if (current().kind !== 'word' || !/^\d+$/.test(text(current()))) break;
			const token = current();
			const io = parseWord();
			if (!isRedirectKind(current().kind) || io.end !== current().start) {
				backtrack(token);
				break;
			}
			redirects.push(parseRedirect(io));
		}
		return {
			...name,
			kind: 'function',
			name,
			parameters,
			returnType,
			body,
			redirects,
			children: [
				name,
				...parameters,
				...(returnType ? [returnType] : []),
				...(body ? [body] : []),
				...redirects,
			],
			end: redirects.at(-1)?.end ?? body?.end ?? end,
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
		const parsePipelineCommand = () =>
			isTypeAlias()
				? parseTypeAlias()
				: isFunctionDefinition()
					? parseFunction()
					: parseCommand();
		let left: Node = parsePipelineCommand();
		while (current().kind === '|') {
			const operator = current();
			next();
			const right = catchAndRecover(
				() => parsePipelineCommand(),
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
		case 'group': {
			const body = compileNode(node.children[0]);
			return node.opener === '('
				? `(${body})`
				: `{ ${body}${body.endsWith(';') ? '' : ' ;'} }`;
		}
		case 'command':
			return [...node.parts.map(compileNode), ...node.redirects.map(compileNode)].join(' ');
		case 'function':
			if (node.parameters.length || node.returnType)
				throw new Error('Cannot emit typed function as POSIX shell');
			if (!node.body)
				throw new Error('Cannot emit IDE declaration as POSIX shell');
			return `${compileNode(node.name)}() ${compileNode(node.body)}${
				node.redirects.length
					? ` ${node.redirects.map(compileNode).join(' ')}`
					: ''
			}`;
		case 'redirect':
			return `${node.io ? compileNode(node.io) : ''}${node.operator} ${compileNode(node.target)}`;
		case 'type':
		case 'parameter':
		case 'typealias':
			throw new Error('Cannot emit IDE declaration as POSIX shell');
		case '|':
		case '&&':
		case '||':
			return `${compileNode(node.children[0])} ${node.kind} ${compileNode(node.children[1])}`;
	}
}

const irRedirectOperators: Record<RedirectOperator, IrRedirectOperator> = {
	'>': IrRedirectOperator.Write,
	'>>': IrRedirectOperator.Append,
	'<': IrRedirectOperator.Read,
	'<>': IrRedirectOperator.ReadWrite,
	'>|': IrRedirectOperator.Clobber,
	'<<': IrRedirectOperator.HereDocument,
	'<<-': IrRedirectOperator.HereDocumentStrip,
	'<&': IrRedirectOperator.DuplicateInput,
	'>&': IrRedirectOperator.DuplicateOutput,
};

const irSeparators: Record<ListNode['separators'][number], IrSeparator> = {
	';': IrSeparator.Semicolon,
	'&': IrSeparator.Background,
	newline: IrSeparator.Newline,
};

function wordValue(node: WordNode) {
	return node.value ?? text(node);
}

function lowerWord(node: WordNode): IrWordNode {
	let flags = 0;
	if (node.hasParameterExpansion) flags |= IrWordFlags.ParameterExpansion;
	if (node.hasCommandSubstitution) flags |= IrWordFlags.CommandSubstitution;
	if (node.hasBackticks) flags |= IrWordFlags.Backticks;
	if (node.hasNonliteralConstruct && !flags) flags = IrWordFlags.Other;
	const value = node.literal ? wordValue(node) : text(node);
	return flags ? [IrKind.Word, value, flags] : [IrKind.Word, value];
}

function lowerRedirect(node: RedirectNode): IrRedirectNode {
	const operator = irRedirectOperators[node.operator];
	const target = lowerWord(node.target);
	return node.io
		? [IrKind.Redirect, operator, target, lowerWord(node.io)]
		: [IrKind.Redirect, operator, target];
}

function lowerList(node: ListNode): IrListNode {
	return [
		IrKind.List,
		node.separators.map(separator => irSeparators[separator]),
		...node.children.map(lowerNode),
	];
}

function lowerGroup(node: GroupNode): IrGroupNode {
	const child = node.children[0];
	if (child.kind !== 'list') throw new Error('Expected command list');
	return [
		IrKind.Group,
		node.opener === '(' ? IrGroupOpener.Parenthesis : IrGroupOpener.Brace,
		lowerList(child),
	];
}

function lowerParameter(node: ParameterNode): IrParameterNode {
	const flags =
		(node.optional ? IrParameterFlags.Optional : 0) |
		(node.rest ? IrParameterFlags.Rest : 0);
	const value = wordValue(node.name);
	return flags
		? [IrKind.Parameter, value, node.type.name, flags]
		: [IrKind.Parameter, value, node.type.name];
}

function lowerNode(node: Node): IrNode {
	switch (node.kind) {
		case 'word':
			return lowerWord(node);
		case 'redirect':
			return lowerRedirect(node);
		case 'command':
			return [
				IrKind.Command,
				...node.children.map(child =>
					child.kind === 'word'
						? lowerWord(child)
						: child.kind === 'group'
							? lowerGroup(child)
							: lowerRedirect(child),
				),
			];
		case 'type':
			return [IrKind.Type, node.name];
		case 'parameter':
			return lowerParameter(node);
		case 'typealias':
			return [
				IrKind.TypeAlias,
				wordValue(node.name),
				node.target.name,
			];
		case 'function':
			return [
				IrKind.Function,
				wordValue(node.name),
				...node.children.slice(1).map(child => {
					switch (child.kind) {
						case 'parameter':
							return lowerParameter(child);
						case 'type':
							return [IrKind.Type, child.name] satisfies IrTypeNode;
						case 'group':
							return lowerGroup(child);
						case 'redirect':
							return lowerRedirect(child);
						case 'word':
							throw new Error('Unexpected function name child');
					}
				}),
			];
		case 'group':
			return lowerGroup(node);
		case '|':
			return [IrKind.Pipe, lowerNode(node.children[0]), lowerNode(node.children[1])];
		case '&&':
			return [IrKind.And, lowerNode(node.children[0]), lowerNode(node.children[1])];
		case '||':
			return [IrKind.Or, lowerNode(node.children[0]), lowerNode(node.children[1])];
		case 'list':
			return lowerList(node);
		case 'root':
			throw new Error('Cannot lower a nested root');
	}
}

function lowerRoot(root: RootNode): Ir {
	const child = root.children[0];
	if (!child) return [1];
	if (child.kind !== 'list') throw new Error('Expected root command list');
	return [1, lowerList(child)];
}

export function compiler(node: Node) {
	return compileNode(node);
}

export function program(options: ProgramOptions = {}) {
	function parse(src: string) {
		const parser = createParser(src, options);
		const root = parser.parse();
		return { root, errors: parser.errors };
	}

	function compile(src: string) {
		const parsed = parse(src);
		return { output: compiler(parsed.root), ast: parsed.root, errors: parsed.errors };
	}

	function ir(root: RootNode) {
		return lowerRoot(root);
	}

	return { parse, compile, ir };
}
