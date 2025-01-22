///<amd-module name="@cxl/gbc.sdk"/>

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

export type BaseNode = Position & { children?: BaseNode[] };

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
			prefix(node: Token<Kind>): MapNode<Map>;
			infix?: never;
	  };

type NodeWithChildren<Map extends NodeMap, Children = MapNode<Map>[]> = {
	[K in keyof Map]: Map[K] extends {
		children: Children;
	}
		? Map[K]
		: never;
}[keyof Map];

export type ParentNode<Map extends NodeMap> = NodeWithChildren<Map>;

export type UnaryNode<Map extends NodeMap> = NodeWithChildren<
	Map,
	[MapNode<Map>]
>;
export type InfixNode<Map extends NodeMap> = NodeWithChildren<
	Map,
	[MapNode<Map>, MapNode<Map>]
>;
export type TernaryNode<
	Map extends NodeMap,
	Optional extends boolean,
> = NodeWithChildren<
	Map,
	[
		MapNode<Map>,
		MapNode<Map>,
		Optional extends true ? MapNode<Map> | undefined : MapNode<Map>,
	]
>;

export type MapKind<Map extends NodeMap> = keyof Map;
export type MapNode<Map extends NodeMap> = Map[keyof Map];

// Utility Types
export type DistributeToken<T> = T extends Token<infer U> ? Token<U> : never;
export type MapToToken<T extends string> = T extends infer U ? Token<U> : never;

export type TrieNode = { [K in string]: TrieNode } & { [TrieMatch]?: string };
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
	ident: ch => ch === '_' || alnum(ch),
	notIdent: ch => ch === undefined && ch !== '_' && !alnum(ch),
	eol: ch => ch === '\n',
	stringEscape: ch => ch === '\\',
} as const satisfies Record<string, MatchFn>;

export class CompilerError {
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
${' '.repeat(pad)}${'~'.repeat(text.length || 1)}`;
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

export type SymbolTable<S extends { name: string }> = ReturnType<
	typeof SymbolTable<S>
>;
export function SymbolTable<S>(
	newScope: () => Record<string | symbol, S> = () => ({}),
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
		scope = stack[stack.length - 1];
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
			)
				if (scope[id]) return scope[id];
		},
		set<T extends S>(id: string | symbol, symbol: T): T {
			scope[id] = symbol;
			return symbol;
		},
		setSymbols(symbols: Record<string, S>) {
			Object.assign(scope, symbols);
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
		expect,
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
		start,
		backtrack,
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

	function skipWhile(kind: Node['kind']) {
		while (token?.kind === kind) next();
	}

	function optional<K extends Node['kind']>(kind: K) {
		if (kind === token.kind) {
			const result = token;
			next();
			return result as unknown as Token<K>;
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
		const s = expect(start);
		const result = content();
		const e = expect(end);
		result.start = s.start;
		result.end = e.end;
		return result;
	}

	function skipUntil(condition: () => boolean) {
		while (!condition()) next();
	}

	function parseUntil<C>(
		parser: () => C | undefined,
		condition: () => boolean,
	) {
		const result: C[] = [];
		catchAndRecover(
			() => {
				while (token && !condition() && token.kind !== 'eof') {
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
	function expect<K extends Node['kind']>(kind: K): Token<K> {
		if (kind !== token.kind)
			throw error(`Expected "${kind}" but got "${token.kind}"`, token);

		const result = token as unknown as Token<K>;
		next();
		return result;
	}

	function expectNodeKind<N extends Token<string>, K extends N['kind']>(
		node: N | undefined,
		kind: K,
		msg: string,
	) {
		if (!node || node.kind !== kind) throw error(msg, node || token);
		return node as Extract<N, { kind: K }>;
	}

	function expectNode<C>(node: C | undefined, msg: string) {
		if (!node) throw error(msg, token);
		return node;
	}

	function parseUntilKind<C>(
		parser: () => C | undefined,
		kind: Node['kind'],
	) {
		return parseUntil(parser, () => current()?.kind === kind);
	}

	function parseListWithEmpty<C>(
		parseFn: () => C | undefined,
		separator: Node['kind'],
		isItem: (item: C) => boolean,
	) {
		const result: (C | undefined)[] = [];
		let token: Node;
		while ((token = current())) {
			// Handle empty params
			if (token.kind === separator) {
				result.push(undefined);
				continue;
			}

			const item = parseFn();
			if (!item || !isItem(item)) break;
			result.push(item);
			if (!optional(separator)) break;
		}
		return result;
	}

	function parseList<C>(
		parseFn: () => C | undefined,
		separator: Node['kind'],
		isItem: (item: C) => boolean,
	) {
		const result: C[] = [];
		do {
			// Handle empty params
			const item = parseFn();
			if (!item || !isItem(item)) break;
			result.push(item);
		} while (optional(separator));

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
	const { current, next, expect, expectNode, optional } = api;

	function expression(precedence = 0) {
		const left = current();
		const prefixOp = table[left.kind as ScannerToken['kind']]?.prefix;
		let result = prefixOp ? (next(), prefixOp(left)) : undefined;

		while (result) {
			const n = current();
			const op = table[n.kind as ScannerToken['kind']];
			if (op?.infix && precedence < op.precedence) {
				next();
				result = op.infix(n, result);
			} else break;
		}

		return result;
	}

	function infix<Node extends InfixNode<Map>>(
		rbp: number,
		cb?: (node: Node) => void,
	) {
		return (tk: Token<string>, left: MapNode<Map>) => {
			const node = tk as Node;
			node.start = left.start;
			const right = expectExpression(rbp);
			node.children = [left, right];
			node.end = right.end;
			cb?.(node);
			return node as Node;
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

	function prefix<K extends UnaryNode<Map>['kind']>(
		rbp = 0,
		cb?: (node: UnaryNode<Map>) => MapNode<Map>,
	) {
		return (tk: Token<K>) => {
			const right = expectExpression(rbp);
			const result = {
				...tk,
				children: [right],
				end: right.end,
			} as unknown as UnaryNode<Map>;
			return cb ? cb(result) : result;
		};
	}

	function ternaryOptional<Node extends TernaryNode<Map, true>>(
		precedence: number,
		operator2: ScannerToken['kind'],
	) {
		const _infix = infix(precedence);
		return (node: Token<Node['kind']>, left: MapNode<Map>) => {
			const result = _infix(
				node as unknown as InfixNode<Map>,
				left,
			) as unknown as Node;
			if (optional(operator2)) {
				const child3 = expectExpression(precedence);
				result.end = child3.end;
				result.children.push(child3);
			}
			return result;
		};
	}

	function ternary<Node extends TernaryNode<Map, false>>(
		precedence: number,
		operator2: ScannerToken['kind'],
	) {
		return (node: Token<Node['kind']>, left: MapNode<Map>) => {
			const result = infix(precedence)(
				node as unknown as InfixNode<Map>,
				left,
			) as unknown as Node;

			expect(operator2);
			const child3 = expectExpression(precedence);
			result.end = child3.end;
			result.children.push(child3);
			return result;
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

export function findNodeAtIndex(node: BaseNode, index: number) {
	if (node.children) {
		for (const child of node.children)
			if (child.children) findNodeAtIndex(child, index);
			else if (child.start <= index && child.end >= index) return child;
	}
	return node;
}

/**
 * Builds a trie from the input map and
 */
export function createTrie<T extends string>(...map: T[]) {
	const trie: TrieNode = {};

	// Build the trie from the input map
	for (const token of map) {
		let current: TrieNode = trie;
		for (const char of token) current = current[char] ??= {};
		current[TrieMatch] = token;
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
		match: (ch: string) => boolean,
		consumed = 0,
	) {
		const start = index + consumed;

		for (let i = 0; i < s.length; i++)
			if (source.charAt(start + i) !== s[i]) return 0;

		if (match(source.charAt(start + s.length))) return 0;

		return consumed + s.length;
	}

	function matchEnclosed(match: MatchFn, escape?: MatchFn) {
		let n = 1;
		while (
			index + n < length &&
			(match(source.charAt(index + n)) ||
				escape?.(source.charAt(index + n - 1)))
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

	function matchRegex<T extends string>(
		regex: RegExp,
	): MapToToken<T> | undefined {
		const m = regex.exec(source.slice(index));
		const token = m && (m[1] ?? m[0]);
		return token ? (tk(token, token.length) as MapToToken<T>) : undefined;
	}

	function createTrieMatcher<T extends string>(
		map: readonly T[],
		end: MatchFn,
	) {
		const trie = createTrie(...map);
		return (): MapToToken<T> | undefined => {
			let ch = source[index];
			let consumed = 0;
			let node = trie;
			while ((node = node[ch])) {
				consumed++;
				ch = source[index + consumed];
				if (node[TrieMatch] && end(ch))
					return tk(node[TrieMatch], consumed) as MapToToken<T>;
			}
		};
	}

	return {
		createTrieMatcher,
		tk,
		matchWhile,
		matchString,
		matchEnclosed,
		matchRegex,
		error,
		skipWhitespace,
		backtrack,
		eof: () => index >= length,
		current: (offset = 0) => source.charAt(index + offset),
	};
}
