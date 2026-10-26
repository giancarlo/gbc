import {
	each,
	CompilerError,
	findNodeAtIndex,
	type MakeNodeMap,
	ParserApi,
	ScannerApi,
	type ScannerContext,
	type TokenizerError,
	text,
	type Token,
	tokenize,
} from '@cxl/gbc.sdk';
export { each, findNodeAtIndex, tokenize, type Token };

export type Dialect = 'posix' | 'ide';
export interface ProgramOptions {
	dialect?: Dialect;
}

export type ScannerToken = ReturnType<ReturnType<typeof createScanner>['next']>;
export type Kind = ScannerToken['kind'];

export const keywords: readonly string[] = ['for', 'in', 'do', 'done', 'if', 'then', 'elif', 'else', 'fi'];

type BaseNodeMap = {
	word: {
		value: string | undefined;
		literal: boolean;
		hasExpansion: boolean;
		hasParameterExpansion: boolean;
		hasCommandSubstitution: boolean;
		children: WordPartNode[];
		hasBackticks: boolean;
		hasNonliteralConstruct: boolean;
	};
	literal: { value: string };
	escape: { value: string };
	pattern: { value: string };
	quoted: {
		quote: "'" | '"' | "$'" | '$"';
		children: WordPartNode[];
	};
	parameterExpansion: {
		name: NodeMap['literal'];
		braced: boolean;
		operator: ParameterOperator;
		operand?: WordNode;
		children: (NodeMap['literal'] | WordNode)[];
	};
	commandSubstitution: {
		backticks: boolean;
		body: RootNode;
		children: [RootNode];
	};
	arithmeticExpansion: { body: WordNode; children: [WordNode] };
	processSubstitution: {
		operator: '<' | '>';
		body: RootNode;
		children: [RootNode];
	};
	redirect: {
		operator: RedirectOperator;
		io?: WordNode;
		target: WordNode;
		body?: HereDocumentNode;
		children: (WordNode | HereDocumentNode)[];
	};
	heredoc: {
		value: string;
		terminator: string;
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
	for: {
		variable: WordNode;
		words?: WordNode[];
		body: ListNode;
		children: (WordNode | ListNode)[];
	};
	if: {
		condition: ListNode;
		body: ListNode;
		alternate?: ListNode | IfNode;
		redirects: RedirectNode[];
		children: (ListNode | IfNode | RedirectNode)[];
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
		hereDocuments?: HereDocumentNode[][];
	};
	root: { children: Node[] };
};
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type ParameterOperator = '' | '#' | ':-' | ':=' | ':?' | ':+' | '-' | '=' | '?' | '+' | '%' | '%%' | '##';
export type WordPartNode = NodeMap['literal' | 'escape' | 'pattern' | 'quoted' | 'parameterExpansion' | 'commandSubstitution' | 'arithmeticExpansion' | 'processSubstitution'];
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
type HereDocumentNode = NodeMap['heredoc'];
type CommandNode = NodeMap['command'];
type TypeNode = NodeMap['type'];
type ParameterNode = NodeMap['parameter'];
type TypeAliasNode = NodeMap['typealias'];
type FunctionNode = NodeMap['function'];
type ForNode = NodeMap['for'];
type IfNode = NodeMap['if'];
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
	For,
	If,
	Literal,
	Escape,
	Pattern,
	Quoted,
	ParameterExpansion,
	CommandSubstitution,
	ArithmeticExpansion,
	ProcessSubstitution,
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

export type IrWordPart =
	| [kind: IrKind.Literal | IrKind.Escape | IrKind.Pattern, value: string]
	| [kind: IrKind.Quoted, quote: NodeMap['quoted']['quote'], children: IrWordPart[]]
	| [kind: IrKind.ParameterExpansion, name: string, operator: ParameterOperator, operand: IrWordNode | null]
	| [kind: IrKind.CommandSubstitution, backticks: boolean, body: IrListNode | null]
	| [kind: IrKind.ArithmeticExpansion, body: IrWordNode]
	| [kind: IrKind.ProcessSubstitution, operator: '<' | '>', body: IrListNode | null];
export type IrWordNode = [kind: IrKind.Word, value: string, flags?: number, parts?: IrWordPart[]];
export type IrRedirectNode = [
	kind: IrKind.Redirect,
	operator: IrRedirectOperator,
	target: IrWordNode,
	io?: IrWordNode,
	body?: string,
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
export type IrForNode = [
	kind: IrKind.For,
	variable: IrWordNode,
	words: IrWordNode[] | null,
	body: IrListNode,
];
export type IrIfNode = [
	kind: IrKind.If,
	condition: IrListNode,
	body: IrListNode,
	alternate: IrListNode | IrIfNode | null,
	...redirects: IrRedirectNode[],
];
export type IrNode =
	| IrWordPart
	| IrWordNode
	| IrRedirectNode
	| IrCommandNode
	| IrTypeNode
	| IrParameterNode
	| IrTypeAliasNode
	| IrFunctionNode
	| IrGroupNode
	| IrBinaryNode
	| IrForNode
	| IrIfNode
	| IrListNode;
export type Ir = [version: 2, root?: IrListNode];

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
	ch === '' || ch === '\n' || isSpace(ch) || '|&;()<>'.includes(ch);
const isNameStart = (ch: string) => /[A-Za-z_]/.test(ch);
const portableName = /^[A-Za-z_]\w*$/;
const ideCommandName = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*!?$/;
const isSpecialParameter = (ch: string) => '@*#?$!-0123456789'.includes(ch);

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

function wordMetadata(children: WordPartNode[]) {
	let value = '';
	const state = {
		hasParameterExpansion: false,
		hasCommandSubstitution: false,
		hasBackticks: false,
		hasNonliteralConstruct: false,
	};
	function visit(parts: WordPartNode[]) {
		for (const part of parts) {
			switch (part.kind) {
				case 'literal':
				case 'escape':
					value += part.value;
					break;
				case 'quoted':
					if (part.quote === '$"') state.hasNonliteralConstruct = true;
					visit(part.children);
					break;
				case 'parameterExpansion':
					state.hasParameterExpansion = state.hasNonliteralConstruct = true;
					state.hasCommandSubstitution ||= part.operand?.hasCommandSubstitution ?? false;
					state.hasBackticks ||= part.operand?.hasBackticks ?? false;
					break;
				case 'commandSubstitution':
					state.hasCommandSubstitution = state.hasNonliteralConstruct = true;
					state.hasBackticks ||= part.backticks;
					break;
				case 'arithmeticExpansion':
					state.hasNonliteralConstruct = true;
					state.hasParameterExpansion ||= part.body.hasParameterExpansion;
					state.hasCommandSubstitution ||= part.body.hasCommandSubstitution;
					state.hasBackticks ||= part.body.hasBackticks;
					break;
				case 'pattern':
				case 'processSubstitution':
					state.hasNonliteralConstruct = true;
			}
		}
	}
	visit(children);
	return {
		value: state.hasNonliteralConstruct ? undefined : value,
		literal: !state.hasNonliteralConstruct,
		hasExpansion: state.hasNonliteralConstruct,
		...state,
	};
}

function readShellWord(token: Token<string>, signature = false, expansions = true): WordNode {
	const { source } = token;
	const bounded = !expansions && token.end > token.start;
	const limit = bounded ? token.end : source.length;
	let index = token.start;
	const position = (start: number, end = index) => ({
		start, end, source,
		line: token.line + source.slice(token.start, start).split('\n').length - 1,
	});
	function fail(message: string): never {
		throw new CompilerError(message, position(token.start));
	}
	const literal = (start: number, value: string): NodeMap['literal'] => ({
		kind: 'literal', ...position(start), value,
	});
	function enclosed() {
		const scanner = createScanner(source);
		scanner.backtrack(position(index));
		const state: HereDocumentState = { pending: undefined };
		let depth = 1;
		for (;;) {
			const token = scanner.next();
			index = token.end;
			if (token.kind === 'eof') fail('Unterminated () expansion');
			if (token.kind === '(') depth++;
			if (token.kind === ')' && !--depth) return;
			const document = takeHereDocument(token, state);
			if (document) scanner.queueHereDocument(document);
			if (token.kind === 'newline') {
				scanner.consumeHereDocuments(token.end, token.line);
			}
		}
	}
	function substitution(): WordPartNode {
		const start = index;
		const operator = source.charAt(index);
		const backticks = operator === '`';
		index += backticks ? 1 : 2;
		if (!backticks && operator === '$' && source[index] === '(') {
			index++;
			const body = word('))', false, true);
			if (!source.startsWith('))', index)) fail('Unterminated () expansion');
			index += 2;
			return { kind: 'arithmeticExpansion', ...position(start), body, children: [body] };
		}
		const bodyStart = index;
		if (backticks) {
			while (index < source.length && source[index] !== '`')
				index += source[index] === '\\' && source[index + 1] ? 2 : 1;
			if (source[index] !== '`') fail('Unterminated string');
			index++;
		} else enclosed();
		const body: RootNode = { kind: 'root', ...position(bodyStart, index - 1), children: [] };
		if (operator === '<' || operator === '>')
			return { kind: 'processSubstitution', ...position(start), operator, body, children: [body] };
		return { kind: 'commandSubstitution', ...position(start), backticks, body, children: [body] };
	}
	function lengthParameter() {
		const next = source.charAt(index + 1);
		return source[index] === '#' && (isNameStart(next) || /\d/.test(next) ||
			(isSpecialParameter(next) && source[index + 2] === '}'));
	}
	function parameterName(braced: boolean) {
		const start = index;
		if (isNameStart(source.charAt(index))) {
			while (/\w/.test(source.charAt(index))) index++;
			if (braced && source[index] === '[') {
				const subscript = /^(?:\d+|[A-Za-z_]\w*|[@*])\]/.exec(source.slice(index + 1));
				if (!subscript) fail('Expected static array subscript followed by "]"');
				index += subscript[0].length + 1;
			}
		} else if (/\d/.test(source.charAt(index))) {
			index++;
			if (braced) while (/\d/.test(source.charAt(index))) index++;
		} else if (source[index] && isSpecialParameter(source.charAt(index))) index++;
		else fail('Expected parameter name');
		return literal(start, source.slice(start, index));
	}
	function parameter(doubleQuoted = false): NodeMap['parameterExpansion'] {
		const start = index++;
		const braced = source[index] === '{';
		if (braced) index++;
		let operator: ParameterOperator = '';
		if (braced && lengthParameter()) {
			operator = '#';
			index++;
		}
		const name = parameterName(braced);
		let operand: WordNode | undefined;
		if (braced) {
			if (source[index] !== '}') {
				if (operator) fail('Unexpected operator after parameter length');
				const matched = ([':-', ':=', ':?', ':+', '%%', '##', '-', '=', '?', '+', '%', '#'] as const)
					.find(op => source.startsWith(op, index));
				if (!matched) fail('Expected parameter expansion operator');
				operator = matched;
				index += operator.length;
				operand = word('}', doubleQuoted && !['#', '##', '%', '%%'].includes(operator), false, true);
			}
			if (source[index] !== '}') fail('Unterminated {} expansion');
			index++;
		}
		return {
			kind: 'parameterExpansion', ...position(start), name, braced, operator,
			...(operand ? { operand } : {}), children: operand ? [name, operand] : [name],
		};
	}
	function quoted(): WordPartNode {
		if (source[index] === '`') return substitution();
		const start = index;
		const prefix = source[index] === '$';
		if (prefix) index++;
		const quote = source[index++] === "'" ? "'" : '"';
		const style = prefix ? quote === "'" ? "$'" : '$"' : quote;
		const children: WordPartNode[] = [];
		if (quote === '"') children.push(...word('"', true).children);
		else {
			while (index < source.length && source[index] !== quote) {
				const partStart = index;
				if (prefix && source[index] === '\\') {
					const escape = decodeAnsiEscape(source, index + 1);
					index = escape.end;
					children.push({ kind: 'escape', ...position(partStart), value: escape.value ?? '' });
				} else {
					while (index < source.length && source[index] !== quote && !(prefix && source[index] === '\\')) index++;
					children.push(literal(partStart, source.slice(partStart, index)));
				}
			}
		}
		if (source[index] !== quote) fail('Unterminated string');
		index++;
		return { kind: 'quoted', ...position(start), quote: style, children };
	}
	function escaped(doubleQuoted: boolean): NodeMap['escape'] {
		const start = index++;
		const next = source.charAt(index);
		if (next && (!doubleQuoted || '$`"\\\n'.includes(next))) index++;
		const value = next === '\n' ? '' : index > start + 1 ? next : '\\';
		return { kind: 'escape', ...position(start), value };
	}
	function processStart(doubleQuoted: boolean) {
		return !doubleQuoted && '<>'.includes(source.charAt(index)) && source[index + 1] === '(';
	}
	function quoteStart(doubleQuoted: boolean, operand: boolean) {
		const ch = source.charAt(index);
		const next = source.charAt(index + 1);
		return (!doubleQuoted && (ch === "'" || ch === '"' || (ch === '$' && (next === "'" || next === '"')))) ||
			(operand && ch === '"');
	}
	function special(doubleQuoted: boolean, operand: boolean): WordPartNode | undefined {
		const start = index;
		const ch = source.charAt(index);
		const next = source.charAt(index + 1);
		if (ch === '\\') return escaped(doubleQuoted);
		if (quoteStart(doubleQuoted, operand)) return quoted();
		if (processStart(doubleQuoted) || ch === '`' || (ch === '$' && next === '(')) {
			const part = substitution();
			return expansions ? part : literal(start, source.slice(start, index));
		}
		if (ch !== '$') return;
		if (next === '{' && !expansions) {
			index += 2;
			word('}');
			if (source[index] !== '}') fail('Unterminated {} expansion');
			index++;
			return literal(start, source.slice(start, index));
		}
		if (expansions && (next === '{' || (next && (isNameStart(next) || isSpecialParameter(next)))))
			return parameter(doubleQuoted);
		return undefined;
	}
	function boundary(stop: string | undefined, doubleQuoted: boolean) {
		if (bounded || stop) return false;
		const ch = source.charAt(index);
		return (!processStart(doubleQuoted) && isControl(ch)) || (signature && ':,=?'.includes(ch));
	}
	function pattern(ch: string, start: number, doubleQuoted: boolean, arithmetic: boolean) {
		return expansions && !doubleQuoted && !arithmetic &&
			('*?[]{}'.includes(ch) || (ch === '~' && index === start + 1));
	}
	function word(stop?: string, doubleQuoted = false, arithmetic = false, operand = false): WordNode {
		const start = index;
		const children: WordPartNode[] = [];
		let parentheses = 0;
		while (index < limit) {
			if (stop && !parentheses && source.startsWith(stop, index)) break;
			if (boundary(stop, doubleQuoted)) break;
			const partStart = index;
			const part = special(doubleQuoted, operand);
			if (part) children.push(part);
			else {
				const ch = source.charAt(index++);
				if (arithmetic && ch === '(') parentheses++;
				if (arithmetic && ch === ')' && parentheses) parentheses--;
				const isPattern = pattern(ch, start, doubleQuoted, arithmetic);
				const previous = children.at(-1);
				if (previous?.kind === 'literal' && !isPattern && previous.end === partStart) {
					previous.value += ch;
					previous.end = index;
				} else children.push(isPattern ? { kind: 'pattern', ...position(partStart), value: ch } : literal(partStart, ch));
			}
		}
		return { kind: 'word', ...position(start), children, ...wordMetadata(children) };
	}
	return word();
}

function createScanner(source: string, context?: ScannerContext) {
	const { current, eof, tk, matchString, matchUntil, error, skip, backtrack } = ScannerApi({
		source, context,
	});
	const hereDocuments: { redirect?: RedirectNode; delimiter: string; stripTabs: boolean }[] = [];
	const words = new WeakMap<object, WordNode>();
	let signature = false;
	let delimiter = false;

	function scanWord() {
		const start = tk('word', 0);
		let word: WordNode;
		try { word = readShellWord(start, signature, !delimiter); }
		catch (value) {
			if (!(value instanceof CompilerError)) throw value;
			throw error(value.message, value.position.end - start.start);
		}
		delimiter = false;
		const token = tk('word', word.end - word.start);
		backtrack({ ...token, line: token.line + text(token).split('\n').length - 1 });
		words.set(token, word);
		return token;
	}

	function isProcessSubstitution(offset = 0) {
		return (
			(current(offset) === '<' || current(offset) === '>') &&
			current(offset + 1) === '('
		);
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
		if (isProcessSubstitution()) return scanWord();
		for (const operator of operators) {
			const consumed = matchString(operator);
			if (consumed) {
				delimiter = operator === '<<' || operator === '<<-';
				return tk(operator, consumed);
			}
		}
		return scanWord();
	}

	return {
		next,
		backtrack,
		queueHereDocument(document: { delimiter: string; stripTabs: boolean; redirect?: RedirectNode }) {
			hereDocuments.push(document);
		},
		consumeHereDocuments(start: number, line: number) {
			let cursor = start;
			const missing: string[] = [];
			const bodies: HereDocumentNode[] = [];
			for (const document of hereDocuments.splice(0)) {
				const bodyStart = cursor;
				let terminator = '';
				while (cursor < source.length) {
					const end = source.indexOf('\n', cursor);
					const lineEnd = end < 0 ? source.length : end;
					const value = source.slice(cursor, lineEnd).replace(/\r$/, '');
					if ((document.stripTabs ? value.replace(/^\t+/, '') : value) === document.delimiter) {
						terminator = source.slice(cursor, end < 0 ? lineEnd : end + 1);
						cursor = end < 0 ? lineEnd : end + 1;
						break;
					}
					cursor = end < 0 ? lineEnd : end + 1;
				}
				if (!terminator)
					missing.push(document.delimiter);
				const body: HereDocumentNode = {
					kind: 'heredoc',
					value: source.slice(bodyStart, cursor - terminator.length),
					terminator,
					start: bodyStart,
					end: cursor,
					line: line + source.slice(start, bodyStart).split('\n').length,
					source,
				};
				if (document.redirect) {
					document.redirect.body = body;
					document.redirect.children.push(body);
				}
				bodies.push(body);
			}
			backtrack({
				start: cursor,
				end: cursor,
				line: line + source.slice(start, cursor).split('\n').length,
				source,
			});
			return { missing, bodies };
		},
		word(token: Token<string>) {
			return words.get(token) ?? readShellWord(token);
		},
		setSignature(value: boolean) {
			signature = value;
		},
	};
}

export function scan(source: string) {
	const { next, backtrack } = createScanner(source);
	return { next, backtrack };
}

interface HereDocumentState {
	pending: boolean | undefined;
}

function takeHereDocument(token: ScannerToken | TokenizerError, state: HereDocumentState) {
	if (token.kind === 'word' && state.pending !== undefined) {
		const document = { delimiter: readShellWord(token, false, false).value ?? text(token), stripTabs: state.pending };
		state.pending = undefined;
		return document;
	}
	if (token.kind === '<<' || token.kind === '<<-') state.pending = token.kind === '<<-';
	else if (token.kind !== 'comment') state.pending = undefined;
	return undefined;
}

export function highlightHereDocuments(source: string) {
	const documents: { delimiter: string; stripTabs: boolean }[] = [];
	const state: HereDocumentState = { pending: undefined };
	for (const token of tokenize(scan, source)) {
		const document = takeHereDocument(token, state);
		if (document) documents.push(document);
	}
	return documents;
}

export function scanHighlight(source: string, context?: ScannerContext) {
	const scanner = createScanner(source, context);
	const state: HereDocumentState = { pending: undefined };
	let queued = false;
	let bodies: HereDocumentNode[] = [];
	let bodyIndex = 0;
	function next() {
		const body = bodies[bodyIndex];
		if (body) {
			bodyIndex++;
			return body;
		}
		const token = scanner.next();
		const document = takeHereDocument(token, state);
		if (document) {
			scanner.queueHereDocument(document);
			queued = true;
		}
		if (queued && token.kind === 'newline') {
			bodies = scanner.consumeHereDocuments(token.end, token.line).bodies;
			bodyIndex = 0;
			queued = false;
		}
		return token;
	}
	return { next, backtrack: scanner.backtrack };
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
	let hasHereDocuments = false;
	const {
		current,
		next: readNext,
		consume,
		error,
		errors,
		catchAndRecover,
		pushError,
		backtrack,
	} = api;
	function next() {
		const bodies = current().kind === 'newline'
			? reportMissingHereDocuments(current().end, current().line)
			: [];
		readNext();
		return bodies;
	}
	function reportMissingHereDocuments(start: number, line: number) {
		const { missing, bodies } = scanner.consumeHereDocuments(start, line);
		for (const delimiter of missing)
			pushError(error(`Unterminated here document "${delimiter}"`, {
				start: source.length,
				end: source.length,
				line: source.split('\n').length - 1,
				source,
			}));
		return bodies;
	}

	function parseWord(): WordNode {
		const token = current();
		if (token.kind !== 'word') throw error('Expected shell word', token);
		next();
		const word = scanner.word(token);
		function parseBodies(node: WordPartNode) {
			if (node.kind === 'commandSubstitution' || node.kind === 'processSubstitution') {
				const offset = node.body.start;
				const end = node.body.end;
				const offsets: number[] = [];
				let input = source.slice(offset, end);
				if (node.kind === 'commandSubstitution' && node.backticks) {
					input = '';
					for (let index = offset; index < end; index++) {
						offsets.push(index);
						if (source[index] === '\\' && '$`\\'.includes(source.charAt(index + 1))) index++;
						input += source.charAt(index);
					}
					offsets.push(end);
				}
				const parser = createParser(input, options);
				const root = parser.parse();
				const line = source.slice(0, offset).split('\n').length - 1;
				function original(position: Pick<Token<string>, 'start' | 'end' | 'line'>) {
					const start = offsets[position.start] ?? offset + position.start;
					return {
						start,
						end: offsets[position.end] ?? offset + position.end,
						line: line + position.line,
						source,
					};
				}
				function relocate(child: Token<string> & { children?: readonly Node[] }) {
					Object.assign(child, original(child));
					if (child.children) for (const nested of child.children) relocate(nested);
				}
				relocate(root);
				node.body = root;
				node.children = [root];
				for (const diagnostic of parser.errors)
					pushError(error(diagnostic.message, original(diagnostic.position)));
			} else if (node.kind === 'quoted') node.children.forEach(parseBodies);
			else if (node.kind === 'parameterExpansion') node.operand?.children.forEach(parseBodies);
			else if (node.kind === 'arithmeticExpansion') node.body.children.forEach(parseBodies);
		}
		word.children.forEach(parseBodies);
		return word;
	}

	function isKeyword(value: string) {
		const token = current();
		return (
			token.kind === 'word' &&
			token.end - token.start === value.length &&
			source.startsWith(value, token.start)
		);
	}

	function consumeKeyword(value: string) {
		const token = current();
		if (!isKeyword(value)) throw error(`Expected "${value}"`, token);
		next();
		return token;
	}

	function consumeLinebreak() {
		let newline = false;
		while (current().kind === 'newline' || current().kind === 'comment') {
			if (current().kind === 'newline') newline = true;
			next();
		}
		return newline;
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
		const redirect: RedirectNode = {
			...operator,
			kind: 'redirect',
			operator: operator.kind,
			io,
			target,
			children: io ? [io, target] : [target],
			start: io?.start ?? operator.start,
			end: target.end,
		};
		if (operator.kind === '<<' || operator.kind === '<<-') {
			hasHereDocuments = true;
			scanner.queueHereDocument({
				redirect,
				delimiter: target.value ?? text(target),
				stripTabs: operator.kind === '<<-',
			});
		}
		return redirect;
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
			consumeLinebreak();
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

	function parseRedirects() {
		const redirects: RedirectNode[] = [];
		while (true) {
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
		return redirects;
	}

	function parseFunction(): FunctionNode {
		const name = parseFunctionName();
		const { parameters, returnType, end } = parseFunctionSignature();
		const body = parseFunctionBody();
		const redirects = body ? parseRedirects() : [];
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

	function parseFor(): ForNode {
		const keyword = consumeKeyword('for');
		const variable = parseWord();
		if (!isPortableName(variable))
			throw error('Expected portable loop variable', variable);
		const beforeIn = consumeLinebreak();
		const hasIn = isKeyword('in');
		const words: WordNode[] | undefined = hasIn ? [] : undefined;
		if (words) {
			next();
			while (
				current().kind !== 'eof' &&
				current().kind !== ';' &&
				current().kind !== 'newline' &&
				current().kind !== 'comment'
			)
				words.push(parseWord());
		}
		let separated = !words && beforeIn;
		if (current().kind === ';') {
			next();
			consumeLinebreak();
			separated = true;
		} else if (consumeLinebreak()) separated = true;
		if (!separated)
			throw error('Expected ";" or newline before "do"', current());
		consumeKeyword('do');
		const body = parseList(['done']);
		if (!body.children.length)
			pushError(error('Expected loop body', current()));
		const done = consumeKeyword('done');
		return {
			...keyword,
			kind: 'for',
			variable,
			words,
			body,
			children: [variable, ...words ?? [], body],
			end: done.end,
		};
	}

	function parseIf(keyword: 'if' | 'elif' = 'if'): IfNode {
		const first = consumeKeyword(keyword);
		const condition = parseList(['then']);
		if (!condition.children.length)
			pushError(error('Expected conditional condition', current()));
		consumeKeyword('then');
		const body = parseList(['elif', 'else', 'fi']);
		if (!body.children.length)
			pushError(error('Expected conditional body', current()));
		let alternate: IfNode | ListNode | undefined;
		let end: number;
		if (isKeyword('elif')) {
			alternate = parseIf('elif');
			end = alternate.end;
		} else {
			if (isKeyword('else')) {
				next();
				alternate = parseList(['fi']);
				if (!alternate.children.length)
					pushError(error('Expected conditional body', current()));
			}
			end = consumeKeyword('fi').end;
		}
		const redirects = keyword === 'if' ? parseRedirects() : [];
		return {
			...first,
			kind: 'if',
			condition,
			body,
			alternate,
			redirects,
			children: [condition, body, ...alternate ? [alternate] : [], ...redirects],
			end: redirects.at(-1)?.end ?? end,
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
		const parsePipelineCommand = () => {
			if (dialect === 'posix') {
				if (isKeyword('if')) return parseIf();
				if (isKeyword('for')) return parseFor();
				if (['then', 'elif', 'else', 'fi'].some(isKeyword))
					throw error(`Unexpected "${text(current())}"`, current());
			}
			return isTypeAlias()
				? parseTypeAlias()
				: isFunctionDefinition()
					? parseFunction()
					: parseCommand();
		};
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

	function validateConditionalSeparator(node: Node) {
		if (node.kind === 'if' && !commandEndKinds.has(current().kind))
			pushError(error('Expected separator after conditional', current()));
	}

	function parseList(stopWords: readonly string[] = []): ListNode {
		const first = current();
		const children: Node[] = [];
		const separators: ListNode['separators'] = [];
		const hereDocuments: HereDocumentNode[][] = [];
		while (
			current().kind !== 'eof' &&
			current().kind !== ')' &&
			current().kind !== '}' &&
			!stopWords.some(isKeyword)
		) {
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
			if (child) {
				children.push(child);
				hereDocuments.push([]);
				validateConditionalSeparator(child);
			}
			if (current().kind === 'comment') next();
			if (current().kind === ';' || current().kind === '&' || current().kind === 'newline') {
				const newline = current().kind === 'newline';
				separators.push(
					current().kind === ';'
						? ';'
						: current().kind === '&'
							? '&'
							: 'newline',
				);
				const bodies = next();
				if (newline && child && bodies.length)
					hereDocuments[hereDocuments.length - 1] = bodies;
			}
		}
		const last = children.at(-1) ?? first;
		return {
			...first,
			kind: 'list',
			children,
			separators,
			hereDocuments,
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
				list.hereDocuments?.push(...(recovered.hereDocuments ?? []));
				list.end = recovered.end;
			}
		}
		const eof = current();
		reportMissingHereDocuments(eof.end, eof.line);
		const root: RootNode = {
			...eof,
			kind: 'root',
			children: list.children.length ? [list] : [],
			start: 0,
			line: 0,
			end: source.length,
		};
		if (hasHereDocuments) extendHereDocumentSpans(root);
		return root;
	}

	return { parse: parseRoot, errors };
}
function extendHereDocumentSpans(node: Token<string> & { children?: readonly Node[] }): number {
	if (!node.children || node.kind === 'word')
		return node.end;
	for (const child of node.children)
		node.end = Math.max(node.end, extendHereDocumentSpans(child));
	return node.end;
}
function compileNode(node: Node): string {
	switch (node.kind) {
		case 'root':
			return node.children.map(compileNode).join('\n');
		case 'list':
			return node.children
				.map((child, index) => {
					const separator = node.separators[index];
					const documents = node.hereDocuments?.[index]?.map(compileNode).join('') ?? '';
					return `${compileNode(child)}${
						separator === 'newline' ? '\n' + documents : separator ? ` ${separator} ` : ''
					}`;
				})
				.join('')
				.trimEnd();
		case 'literal':
		case 'escape':
		case 'pattern':
		case 'quoted':
		case 'parameterExpansion':
		case 'commandSubstitution':
		case 'arithmeticExpansion':
		case 'processSubstitution':
		case 'word':
			return text(node);
		case 'heredoc':
			return node.value + node.terminator;
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
		case 'for': {
			const words = node.words?.map(word => compileNode(word)).join(' ');
			const header = node.words
				? `for ${compileNode(node.variable)} in${words ? ` ${words}` : ''}`
				: `for ${compileNode(node.variable)}`;
			const body = compileNode(node.body);
			return `${header}; do ${body}${/[;&]$/.test(body) ? '' : ' ;'} done`;
		}
		case 'if': {
			const list = (body: ListNode) => {
				const output = compileNode(body);
				if (body.separators.at(-1) === 'newline') return `${output}\n`;
				return `${output}${/[;&\n]$/.test(output) ? '' : ' ;'}`;
			};
			const alternate = node.alternate?.kind === 'if'
				? ` el${compileNode(node.alternate)}`
				: `${node.alternate ? ` else ${list(node.alternate)}` : ''} fi`;
			return `if ${list(node.condition)} then ${list(node.body)}${alternate}${
				node.redirects.length ? ` ${node.redirects.map(compileNode).join(' ')}` : ''
			}`;
		}
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

function lowerWord(node: WordNode, structured = false): IrWordNode {
	let flags = 0;
	if (node.hasParameterExpansion) flags |= IrWordFlags.ParameterExpansion;
	if (node.hasCommandSubstitution) flags |= IrWordFlags.CommandSubstitution;
	if (node.hasBackticks) flags |= IrWordFlags.Backticks;
	if (node.hasNonliteralConstruct && !flags) flags = IrWordFlags.Other;
	const value = node.literal ? wordValue(node) : text(node);
	return flags || structured ? [IrKind.Word, value, flags, node.children.map(lowerWordPart)] : [IrKind.Word, value];
}

function lowerWordPart(node: WordPartNode): IrWordPart {
	const body = (root: RootNode) => {
		const list = root.children[0];
		if (!list) return null;
		if (list.kind !== 'list') throw new Error('Expected substitution command list');
		return lowerList(list);
	};
	switch (node.kind) {
		case 'literal': return [IrKind.Literal, node.value];
		case 'escape': return [IrKind.Escape, node.value];
		case 'pattern': return [IrKind.Pattern, node.value];
		case 'quoted': return [IrKind.Quoted, node.quote, node.children.map(lowerWordPart)];
		case 'parameterExpansion': return [IrKind.ParameterExpansion, node.name.value, node.operator, node.operand ? lowerWord(node.operand, true) : null];
		case 'commandSubstitution': return [IrKind.CommandSubstitution, node.backticks, body(node.body)];
		case 'arithmeticExpansion': return [IrKind.ArithmeticExpansion, lowerWord(node.body, true)];
		case 'processSubstitution': return [IrKind.ProcessSubstitution, node.operator, body(node.body)];
	}
}

function lowerRedirect(node: RedirectNode): IrRedirectNode {
	const operator = irRedirectOperators[node.operator];
	const target = lowerWord(node.target);
	if (node.body !== undefined)
		return [IrKind.Redirect, operator, target, node.io && lowerWord(node.io), node.body.value];
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

function lowerIf(node: IfNode): IrIfNode {
	return [
		IrKind.If,
		lowerList(node.condition),
		lowerList(node.body),
		node.alternate?.kind === 'if'
			? lowerIf(node.alternate)
			: node.alternate ? lowerList(node.alternate) : null,
		...node.redirects.map(lowerRedirect),
	];
}

function lowerNode(node: Node): IrNode {
	switch (node.kind) {
		case 'literal':
		case 'escape':
		case 'pattern':
		case 'quoted':
		case 'parameterExpansion':
		case 'commandSubstitution':
		case 'arithmeticExpansion':
		case 'processSubstitution':
			return lowerWordPart(node);
		case 'word':
			return lowerWord(node);
		case 'heredoc':
			throw new Error('Cannot lower a standalone here document');
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
		case 'for':
			return [
				IrKind.For,
				lowerWord(node.variable),
				node.words?.map(word => lowerWord(word)) ?? null,
				lowerList(node.body),
			];
		case 'if':
			return lowerIf(node);
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
	if (!child) return [2];
	if (child.kind !== 'list') throw new Error('Expected root command list');
	return [2, lowerList(child)];
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
