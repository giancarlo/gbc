export interface Position {
	start: number;
	end: number;
	line: number;
	source: string;
}

export interface Token<Kind> extends Position {
	kind: Kind;
}

export type MatchFn = (ch: string) => boolean;
export type ScanFn<Node extends Token<string>> = () => Node;
export type Scanner<Node extends Token<string>> = (src: string) => {
	next: ScanFn<Node>;
	backtrack: (pos: Position) => void;
};

export interface TokenizerError extends Token<'tokenizer-error'> {
	error: CompilerError;
}

export function* tokenize<Node extends Token<string>>(
	scanner: Scanner<Node>,
	source: string,
): Generator<Node | TokenizerError> {
	const { next, backtrack } = scanner(source);
	let offset = 0;

	for (;;) {
		try {
			const token = next();
			if (token.kind === 'eof') return;
			offset = Math.max(offset, token.end);
			yield token;
		} catch (value) {
			if (!(value instanceof CompilerError)) throw value;
			const start = Math.max(offset, value.position.start);
			const end = Math.min(
				source.length,
				Math.max(start + 1, value.position.end),
			);
			const error = {
				kind: 'tokenizer-error',
				start,
				end,
				line: value.position.line,
				source,
				error: value,
			} as const satisfies TokenizerError;
			yield error;
			if (end <= offset || end >= source.length) return;
			offset = end;
			backtrack(error);
		}
	}
}

export type NodeChildren<Node = BaseNode> = readonly (Node | undefined)[];

export type BaseNode = Position & { children?: NodeChildren };
export type LeafNode<Kind extends string> = Token<Kind> & { children?: never };

export interface ParentNodeBase<
	Children extends readonly unknown[] = NodeChildren,
> {
	children: Children;
}
export type RootNodeBase<Node = BaseNode> = ParentNodeBase<Node[]>;
export type UnaryNodeBase<Node = BaseNode> = ParentNodeBase<[Node]>;
export type BinaryNodeBase<Node = BaseNode> = ParentNodeBase<[Node, Node]>;
export type TernaryNodeBase<
	Node = BaseNode,
	Optional extends boolean = false,
> = ParentNodeBase<
	[Node, Node, Optional extends true ? Node | undefined : Node]
>;

export type NodeMap = {
	[K: string]: Token<string>;
};

export type OperatorTable<T extends NodeMap, Kind extends string> = {
	[K in Kind]?: Operator<K, T>;
};

export type Operator<Kind extends keyof Map, Map extends NodeMap> =
	| {
			precedence: number;
			infix(node: Token<Kind>, left: MapNode<Map>): MapNode<Map>;
			prefix?(node: Token<Kind>): MapNode<Map>;
	  }
	| {
			infix?: never;
			prefix(node: Token<Kind>): MapNode<Map>;
	  };

export type NodeWithChildren<Map extends NodeMap, Children = MapNode<Map>[]> = {
	[K in keyof Map]: Map[K] extends {
		children: Children;
	}
		? Map[K]
		: never;
}[keyof Map];

export type ParentNode<Map extends NodeMap> = NodeWithChildren<Map>;

export type UnaryNode<Map extends NodeMap> = NodeWithChildren<
	Map,
	UnaryNodeBase<MapNode<Map>>['children']
>;
export type InfixNode<Map extends NodeMap> = NodeWithChildren<
	Map,
	BinaryNodeBase<MapNode<Map>>['children']
>;
export type TernaryNode<
	Map extends NodeMap,
	Optional extends boolean,
> = NodeWithChildren<Map, TernaryNodeBase<MapNode<Map>, Optional>['children']>;

export type MapKind<Map extends NodeMap> = keyof Map;
export type MapNode<Map extends NodeMap> = Map[keyof Map];

// Utility Types
export type DistributeToken<T> = T extends Token<infer U> ? Token<U> : never;
export type MapToToken<T extends string> = T extends infer U ? Token<U> : never;

export type TrieNode<Kind extends string = string> = {
	[K in string]: TrieNode<Kind> | undefined;
} & { [TrieMatch]?: Kind };
const TrieMatch = Symbol('TrieMatch');

const alpha = (ch: string) =>
	(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const digit = (ch: string) => ch >= '0' && ch <= '9';
const alnum = (ch: string) => alpha(ch) || digit(ch);
const hexDigit = (ch: string) =>
	(ch >= '0' && ch <= '9') ||
	(ch >= 'a' && ch <= 'f') ||
	(ch >= 'A' && ch <= 'F');

export const matchers = {
	alpha,
	digit,
	alnum,
	hexDigit,
	digitUnderscore: ch => ch === '_' || digit(ch),
	hexDigitUnderscore: ch => ch === '_' || hexDigit(ch),
	binaryDigit: ch => ch === '0' || ch === '1',
	binaryDigitUnderscore: ch => ch === '0' || ch === '1' || ch === '_',
	octalDigit: ch => ch >= '0' && ch <= '7',
	ident: ch => ch === '_' || alnum(ch),
	notIdent: ch => ch !== '_' && !alnum(ch),
	eol: ch => ch === '\n',
	lineBreak: ch => ch === '\r' || ch === '\n',
	notLineBreak: ch => ch !== '\r' && ch !== '\n',
	horizontalSpace: ch => ch === ' ' || ch === '\t',
} as const satisfies Record<string, MatchFn>;

export const stringEscape = (n: number, src: string) =>
	src[n - 1] === '\\' && src[n - 2] !== '\\';

/** Append n as unsigned LEB128 to out. */
export function uleb128(n: number, out: number[]) {
	do {
		let b = n & 0x7f;
		n >>>= 7;
		if (n !== 0) b |= 0x80;
		out.push(b);
	} while (n !== 0);
}

/** Append n as signed LEB128 to out. */
export function sleb128(n: number, out: number[]) {
	let more = true;
	while (more) {
		let b = n & 0x7f;
		n >>= 7;
		const sign = b & 0x40;
		if ((n === 0 && !sign) || (n === -1 && sign)) more = false;
		else b |= 0x80;
		out.push(b);
	}
}

/** Append n as signed LEB128 to out — BigInt for values beyond 32 bits. */
export function sleb128big(n: bigint, out: number[]) {
	let more = true;
	while (more) {
		let b = Number(n & 0x7fn);
		n >>= 7n;
		const sign = b & 0x40;
		if ((n === 0n && !sign) || (n === -1n && sign)) more = false;
		else b |= 0x80;
		out.push(b);
	}
}

export class CompilerError {
	stack?: string;
	constructor(
		public message: string,
		public position: Position,
	) {}
}

export function text({ source, start, end }: Position) {
	return source.slice(start, end);
}

export function each<Node extends Token<string>>(scan: ScanFn<Node>) {
	return {
		[Symbol.iterator]() {
			return {
				next() {
					const value = scan();
					return value.kind === 'eof'
						? { done: true, value }
						: { value };
				},
			};
		},
	};
}

export function line({ source, start }: Position) {
	const len = source.length;
	let lineStart = start,
		lineEnd = start;
	while (lineStart-- && source.charAt(lineStart) !== '\n');
	while (source.charAt(lineEnd) !== '\n' && lineEnd++ <= len);
	return {
		start: lineStart,
		end: lineEnd,
	};
}

export function lineText(node: Position) {
	const ln = line(node);
	return node.source.slice(ln.start + 1, ln.end);
}

export function formatError(
	error: CompilerError,
	options?: { startLine?: number },
) {
	const pos = error.position;
	const { start, end } = line(pos);
	const lineText = pos.source.slice(start + 1, end).replace(/\t/g, '  ');
	const padText = pos.source.slice(start + 1, pos.start).replace(/\t/g, '  ');
	const text = pos.source.slice(pos.start, pos.end).replace(/\t/g, '  ');
	const pad = pos.line.toString().length + 2 + padText.length;

	return `${error.message}

${pos.line + (options?.startLine ?? 1)}: ${lineText}
${' '.repeat(pad)}${'~'.repeat(text.length || 1)}${
		error.stack ? `\n\n${error.stack}` : ''
	}`;
}

export type ErrorApi = ReturnType<typeof ErrorApi>;
export function ErrorApi() {
	const errors: CompilerError[] = [];

	const error = (msg: string, pos: Position) => new CompilerError(msg, pos);

	function pushError(error: CompilerError) {
		errors.push(error);
		if (errors.length > 100) {
			errors.push(
				new CompilerError('Too many errors. Aborting compilation', {
					start: 0,
					end: 0,
					line: 0,
					source: '',
				}),
			);
			throw 'TOO_MANY_ERRORS';
		}
	}

	function catchAndRecover<T>(fn: () => T, recover: () => T) {
		try {
			return fn();
		} catch (e) {
			if (e instanceof CompilerError) {
				pushError(e);
				return recover();
			} else throw e;
		}
	}

	return {
		catchAndRecover,
		errors,
		error,
		pushError,
	};
}

export enum Flags {
	None = 0,
	Variable = 1,
	Export = 2,
	External = 16,
	Intrinsic = 32,
	Module = 64,
}

export type SymbolKind =
	| 'type'
	| 'literal'
	| 'function'
	| 'parameter'
	| 'variable'
	| 'data';

export type Type =
	| { kind: 'type'; name?: string }
	| { kind: 'function'; name?: string };

export interface Symbol<
	Node extends BaseNode = BaseNode,
	SymbolType extends Type = Type,
> {
	kind: SymbolKind;
	name?: string;
	definition?: Node;
	references?: Position[];
	type?: SymbolType;
	flags: Flags;
}

export type SymbolTable<S extends { name: string }> = ReturnType<
	typeof SymbolTable<S>
>;
export function SymbolTable<S>(
	newScope: () => Map<string | symbol, S> = () => new Map(),
) {
	const globalScope = newScope();
	let scope = globalScope;
	const stack = [globalScope];

	function push() {
		stack.push((scope = newScope()));
		return scope;
	}

	function pop(expectedScope: typeof globalScope) {
		if (stack.length === 1) throw new Error('Invalid pop');
		const popped = stack.pop();
		if (popped !== expectedScope) throw new Error('Invalid scope popped');
		const newScope = stack[stack.length - 1];
		if (!newScope) throw new Error('Invalid scope stack');
		scope = newScope;
	}

	return {
		globalScope,
		stack,
		push,
		pop,
		get(id: string | symbol) {
			for (
				let i = stack.length - 1, scope = stack[i];
				i >= 0;
				scope = stack[--i]
			) {
				const found = scope?.get(id);
				if (found !== undefined) return found;
			}
		},
		set<T extends S>(id: string | symbol, symbol: T): T {
			scope.set(id, symbol);
			return symbol;
		},
		setSymbols(symbols: Record<string, S>) {
			for (const [id, symbol] of Object.entries(symbols))
				scope.set(id, symbol);
		},

		/**
		 * This function allows executing code within a new scope of the symbol table.
		 * The `fn` function receives the new scope object.
		 * The scope is automatically pushed onto the stack before executing `fn` and popped off when `fn` finishes.
		 */
		withScope<C>(fn: (scope: typeof globalScope) => C) {
			const scope = push();
			try {
				return fn(scope);
			} finally {
				pop(scope);
			}
		},
	};
}

export type MakeNodeMap<Base> = {
	[K in keyof Base]: Token<K> & Base[K];
};

export type ParserApi<Node extends Token<string>> = ReturnType<
	typeof ParserApi<Node>
>;
export function ParserApi<Node extends Token<string>>(scanner: Scanner<Node>) {
	const { error, errors, catchAndRecover, pushError } = ErrorApi();
	let token: Node;
	let scan: ReturnType<typeof scanner>;

	const current = () => token;
	const expectNodeParser = (fn: () => Node | undefined, msg: string) => () =>
		expectNode(fn(), msg);

	const api = {
		current,
		error,
		pushError,
		errors,
		catchAndRecover,
		consume,
		expectNode,
		expectNodeKind,
		expectNodeParser,
		next,
		node,
		optional,
		skipWhile,
		enclosed,
		skipUntil,
		parseUntil,
		parseUntilKind,
		parseList,
		parseListWithEmpty,
		peekKind,
		start,
		backtrack,
		parseWhile,
	};

	function start(src: string) {
		scan = scanner(src);
		errors.length = 0;
		next();
	}

	function backtrack(pos: Node) {
		scan.backtrack(pos);
		token = pos;
	}

	function next(): Node {
		return catchAndRecover(() => (token = scan.next()), next);
	}

	function peekKind<K extends Node['kind']>(kind: K) {
		const position = token;
		const errorCount = errors.length;
		try {
			return next().kind === kind;
		} finally {
			backtrack(position);
			errors.length = errorCount;
		}
	}

	function skipWhile(kind: Node['kind']) {
		while (token.kind === kind) next();
	}

	function optional<K extends Node['kind']>(kind: K): Token<K> | undefined;
	function optional(kind: Node['kind']): Token<Node['kind']> | undefined {
		if (kind === token.kind) {
			const result = token;
			next();
			return result;
		}
	}

	function node<K extends string>(kind: K): Token<K> {
		return {
			...token,
			kind,
		};
	}

	function enclosed<C extends Node>(
		start: Node['kind'],
		content: () => C,
		end: Node['kind'],
	) {
		const s = consume(start);
		const result = content();
		const e = consume(end);
		result.start = s.start;
		result.end = e.end;
		return result;
	}

	function skipUntil(condition: () => boolean) {
		while (!condition()) next();
	}

	/**
	 * Repeatedly applies the given parser function as long as it continues returning valid nodes,
	 * collecting the results into an array until no more nodes are produced or end-of-file is reached.
	 */
	function parseWhile<C>(parser: () => C | undefined) {
		const result: C[] = [];
		while (token.kind !== 'eof') {
			const node = parser();
			if (node) result.push(node);
			else break;
		}

		return result;
	}

	function parseUntil<C>(
		parser: () => C | undefined,
		condition: () => boolean,
	) {
		const result: C[] = [];
		catchAndRecover(
			() => {
				while (!condition() && token.kind !== 'eof') {
					const node = parser();
					if (node) result.push(node);
					else
						throw error(
							`Unexpected token "${token.kind}"`,
							current(),
						);
				}
			},
			() => skipUntil(condition),
		);

		return result;
	}

	/** Verify token is the correct kind and advance */
	function consume<K extends Node['kind']>(kind: K): Token<K>;
	function consume(kind: Node['kind']): Token<Node['kind']> {
		if (kind !== token.kind)
			throw error(`Expected "${kind}" but got "${token.kind}"`, token);

		const result = token;
		next();
		return result;
	}

	function narrowNodeKind<N extends Token<string>, K extends N['kind']>(
		node: N,
		kind: K,
	): Extract<N, Token<K>>;
	function narrowNodeKind(node: Token<string>, _kind: string): Token<string> {
		return node;
	}

	function expectNodeKind<N extends Token<string>, K extends N['kind']>(
		node: N | undefined,
		kind: K,
		msg: string,
	): Extract<N, Token<K>> {
		if (node?.kind !== kind) throw error(msg, node || token);
		return narrowNodeKind(node, kind);
	}

	function expectNode<C>(node: C | undefined, msg: string) {
		if (!node) throw error(msg, token);
		return node;
	}

	function parseUntilKind<C>(
		parser: () => C | undefined,
		kind: Node['kind'],
	) {
		return parseUntil(parser, () => current().kind === kind);
	}

	function parseListWithEmpty<C>(
		parseFn: () => C | undefined,
		separator: Node['kind'],
		isItem: (item: C) => boolean,
	) {
		const result: (C | undefined)[] = [];
		do {
			const token = current();
			// Handle empty params
			if (token.kind === separator) {
				result.push(undefined);
				continue;
			}

			const item = parseFn();
			if (!item || !isItem(item)) break;
			result.push(item);
			if (!optional(separator)) break;
		} while (token.kind !== 'eol');
		return result;
	}

	function parseList<C>(
		parseFn: () => C | undefined,
		separator: Node['kind'] | ((item: C) => boolean),
		isItem: (item: C) => boolean,
	) {
		const result: C[] = [];
		const sepIsFn = typeof separator === 'function';
		while (true) {
			const item = parseFn();
			if (!item || !isItem(item)) break;
			result.push(item);
			const cont = sepIsFn ? separator(item) : !!optional(separator);
			if (!cont) break;
		}
		return result;
	}

	return api;
}

type ParserTableFn<Map extends NodeMap, ScannerToken extends Token<string>> = (
	tableApi: ParseTableApi<Map, ScannerToken>,
) => OperatorTable<Map, ScannerToken['kind']>;

type ParseTableApi<
	Map extends NodeMap,
	ScannerToken extends Token<string>,
> = ParserApi<ScannerToken> &
	ReturnType<typeof parseTableApi<Map, ScannerToken>>;

function parseTableApi<Map extends NodeMap, ScannerToken extends Token<string>>(
	tableFn: ParserTableFn<Map, ScannerToken>,
	api: ParserApi<ScannerToken>,
) {
	const { current, next, consume, expectNode, optional } = api;

	function operator<K extends ScannerToken['kind']>(kind: K) {
		return table[kind];
	}

	function expression(precedence = 0) {
		const left = current();
		const prefixOp = operator(left.kind)?.prefix;
		let result = prefixOp ? (next(), prefixOp(left)) : undefined;

		while (result) {
			const n = current();
			const op = operator(n.kind);
			if (op?.infix && precedence < op.precedence) {
				next();
				result = op.infix(n, result);
			} else break;
		}

		return result;
	}

	function createInfixNode<Node extends InfixNode<Map>>(
		tk: Token<Node['kind']>,
		left: MapNode<Map>,
		right: MapNode<Map>,
	): Node;
	function createInfixNode(
		tk: Token<string>,
		left: MapNode<Map>,
		right: MapNode<Map>,
	) {
		return {
			...tk,
			start: left.start,
			children: [left, right],
			end: right.end,
		};
	}

	function infix<Node extends InfixNode<Map>>(
		rbp: number,
		cb?: (node: Node) => void,
	) {
		return (tk: Token<string>, left: MapNode<Map>) => {
			const right = expectExpression(rbp);
			const node = createInfixNode<Node>(tk, left, right);
			cb?.(node);
			return node;
		};
	}

	function infixOperator<Node extends InfixNode<Map>>(
		precedence: number,
		rightBindingPower = precedence,
		cb?: (node: Node) => void,
	) {
		return {
			precedence,
			infix: infix<Node>(rightBindingPower, cb),
		};
	}

	function createUnaryNode<Node extends UnaryNode<Map>>(
		tk: Token<Node['kind']>,
		right: MapNode<Map>,
	): Node;
	function createUnaryNode(tk: Token<string>, right: MapNode<Map>) {
		return {
			...tk,
			children: [right],
			end: right.end,
		};
	}

	function prefix<K extends UnaryNode<Map>['kind']>(
		rbp = 0,
		cb?: (node: UnaryNode<Map>) => MapNode<Map>,
	) {
		return (tk: Token<K>) => {
			const right = expectExpression(rbp);
			const result = createUnaryNode<UnaryNode<Map>>(tk, right);
			return cb ? cb(result) : result;
		};
	}

	function createTernaryNode<
		Node extends TernaryNode<Map, true> | TernaryNode<Map, false>,
	>(
		tk: Token<Node['kind']>,
		left: MapNode<Map>,
		right: MapNode<Map>,
		child3: MapNode<Map> | undefined,
	): Node;
	function createTernaryNode(
		tk: Token<string>,
		left: MapNode<Map>,
		right: MapNode<Map>,
		child3: MapNode<Map> | undefined,
	) {
		return {
			...tk,
			start: left.start,
			children: [left, right, child3],
			end: child3?.end ?? right.end,
		};
	}

	function ternaryOptional<Node extends TernaryNode<Map, true>>(
		precedence: number,
		operator2: ScannerToken['kind'],
	) {
		return (node: Token<Node['kind']>, left: MapNode<Map>) => {
			const right = expectExpression(precedence);
			let child3: MapNode<Map> | undefined;
			if (optional(operator2)) {
				child3 = expectExpression(precedence);
			}
			return createTernaryNode<Node>(node, left, right, child3);
		};
	}

	function ternary<Node extends TernaryNode<Map, false>>(
		precedence: number,
		operator2: ScannerToken['kind'],
	) {
		return (node: Token<Node['kind']>, left: MapNode<Map>) => {
			const right = expectExpression(precedence);
			consume(operator2);
			const child3 = expectExpression(precedence);
			return createTernaryNode<Node>(node, left, right, child3);
		};
	}

	function expectExpression(precedence = 0) {
		return expectNode(expression(precedence), 'Expected expression');
		/*const result = expression(precedence);
		if (!result) throw error('Expected expression', current());
		return result;*/
	}

	const tableApi = {
		...api,
		expression,
		expectExpression,
		infix,
		infixOperator,
		ternary,
		ternaryOptional,
		prefix,
	};

	const table = tableFn(tableApi);

	return tableApi;
}

export function parserTable<
	Map extends NodeMap,
	ScannerToken extends Token<string>,
>(tableFn: ParserTableFn<Map, ScannerToken>) {
	return (api: ParserApi<ScannerToken>) =>
		parseTableApi(tableFn, api).expression;
}

type NodeAtIndex<Node extends BaseNode, Seen = never> = Node extends Seen
	? Node
	: Node extends { children: readonly (infer Child)[] }
		? Node | NodeAtIndex<Extract<Child, BaseNode>, Seen | Node>
		: Node;

export function findNodeAtIndex<Node extends BaseNode>(
	node: Node,
	index: number,
): NodeAtIndex<Node> | undefined;
export function findNodeAtIndex(
	node: BaseNode,
	index: number,
): BaseNode | undefined {
	if (index < node.start || index >= node.end) return;
	if (node.children) {
		for (const child of node.children) {
			if (!child) continue;
			const result = findNodeAtIndex(child, index);
			if (result) return result;
		}
	}
	return node;
}

export type ChildrenOf<Node extends BaseNode> = Node extends {
	children: infer Children extends readonly unknown[];
}
	? Children
	: undefined;

export function childNodes<Node extends BaseNode>(node: Node): ChildrenOf<Node>;
export function childNodes(node: BaseNode): NodeChildren | undefined {
	return node.children;
}

/**
 * Builds a trie from the input map and
 */
export function createTrie<T extends string>(...map: T[]) {
	const trie: TrieNode<T> = {};

	// Build the trie from the input map
	for (const token of map) {
		let current = trie;
		for (const char of token) current = current[char] ??= {};
		current[TrieMatch] = token;
	}
	return trie;
}

export function createCaseInsensitiveTrie<T extends string>(...map: T[]) {
	const trie = createTrie(...map);
	const pending = [trie];
	for (let i = 0; i < pending.length; i++) {
		const node = pending[i];
		if (!node) continue;
		for (const [ch, child] of Object.entries(node)) {
			if (!child) continue;
			node[ch.toLowerCase()] = child;
			node[ch.toUpperCase()] = child;
			pending.push(child);
		}
	}
	return trie;
}

export function ScannerApi({ source }: { source: string }) {
	const length = source.length;
	let index = 0;
	let line = 0;
	let endLine = 0;

	function tk<Kind extends string>(kind: Kind, consume: number): Token<Kind> {
		return {
			kind,
			start: index,
			end: (index += consume),
			line,
			source,
		};
	}

	function lineToken<Kind extends string>(
		kind: Kind,
		consume: number,
	): Token<Kind> {
		const result = tk(kind, consume);
		line = endLine = result.line + 1;
		return result;
	}

	function matchUntil(match: MatchFn, consumed = 0) {
		while (
			index + consumed < length &&
			!match(source.charAt(index + consumed))
		)
			consumed++;
		return consumed;
	}

	function matchWhile(match: MatchFn, consumed = 0) {
		while (
			index + consumed < length &&
			match(source.charAt(index + consumed))
		)
			consumed++;
		return consumed;
	}

	function matchString(
		s: string,
		matchEnd?: (ch: string) => boolean,
		consumed = 0,
	) {
		const start = index + consumed;

		for (let i = 0; i < s.length; i++)
			if (source.charAt(start + i) !== s[i]) return 0;

		if (matchEnd?.(source.charAt(start + s.length))) return 0;

		return consumed + s.length;
	}

	/**
	 * Attempts to match a sequence of characters enclosed according to the provided match function,
	 * supporting optional escape logic for handling special character sequences within the enclosure.
	 * Useful for parsing strings or blocks with delimiters (like quotes or brackets) where escapes may appear.
	 */
	function matchEnclosed(
		match: MatchFn,
		escape?: (index: number, source: string) => boolean,
		n = 1,
	) {
		while (
			index + n < length &&
			(match(source.charAt(index + n)) || escape?.(index + n, source))
		) {
			if (source.charAt(index + n) === '\n') endLine++;
			n++;
		}
		return n;
	}

	function error(message: string, consumed = 0, start = index) {
		index += consumed;
		return new CompilerError(message, {
			start,
			end: index,
			line,
			source,
		});
	}

	function skipWhitespace() {
		for (let ch = source[index]; index < length; ch = source[++index]) {
			if (ch === '\n') endLine++;
			else if (ch !== '\r' && ch !== ' ' && ch !== '\t') break;
		}
		line = endLine;
	}

	function backtrack(pos: Position) {
		index = pos.end;
		endLine = line = pos.line;
	}

	function matchWhileRegex(regex: RegExp, consumed = 0) {
		while (
			index + consumed < length &&
			regex.test(source.charAt(index + consumed))
		)
			consumed++;
		return consumed;
	}

	function createTrieMatcher<T extends string>(
		trie: TrieNode<T>,
		end: MatchFn,
	) {
		function trieToken<Kind extends string>(
			kind: Kind,
			consumed: number,
		): MapToToken<Kind>;
		function trieToken(kind: string, consumed: number): Token<string> {
			return tk(kind, consumed);
		}

		return (consumed = 0) => {
			let ch = source.at(index + consumed);
			let node = trie;
			while (ch) {
				const child = node[ch];
				if (!child) break;
				node = child;
				consumed++;
				ch = source.at(index + consumed);
				if (node[TrieMatch] && (!ch || end(ch)))
					return trieToken(node[TrieMatch], consumed);
			}
		};
	}

	return {
		createTrieMatcher,
		tk,
		lineToken,
		matchWhile,
		matchUntil,
		matchString,
		matchEnclosed,
		matchWhileRegex,
		error,
		skip: (offset = 1) => (index += offset),
		skipWhitespace,
		backtrack,
		eof: (offset = 0) => index + offset >= length,
		current: (offset = 0) => source.charAt(index + offset),
	};
}
