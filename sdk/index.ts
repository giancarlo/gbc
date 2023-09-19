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

export type ScanFn<Node extends Token<string>> = () => Node;
export type Scanner<Node extends Token<string>> = (src: string) => () => Node;

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
					return value.kind === 'eof' ? { done: true } : { value };
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

${pos.line + (options?.startLine || 0)}: ${lineText}
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
export function SymbolTable<S extends { name: string }>(
	newScope: () => Record<string, S> = () => ({}),
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
		get(id: string) {
			for (
				let i = stack.length - 1, scope = stack[i];
				i >= 0;
				scope = stack[--i]
			)
				if (scope[id]) return scope[id];
		},
		set(id: string, symbol: S) {
			scope[id] = symbol;
			return symbol;
		},
		setSymbols(...symbols: S[]) {
			for (const s of symbols) scope[s.name] = s;
		},

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
	};

	function start(src: string) {
		scan = scanner(src);
		errors.length = 0;
		next();
	}

	function next(): Node {
		return catchAndRecover(() => (token = scan()), next);
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
				let token = current();
				while (token && !condition() && token.kind !== 'eof') {
					const node = parser();
					if (node) result.push(node);
					else token = next();
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

	function expectNodeKind<K extends Node['kind'], N extends Token<string>>(
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
		while (true) {
			// Handle empty params
			const item = parseFn();
			if (!item || !isItem(item)) break;
			result.push(item);
			if (!optional(separator)) break;
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
	const { current, next, error, expect, expectNode, optional } = api;

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
			const right = expectNode(expression(rbp), 'Expected expression');
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
			const right = expectNode(expression(rbp), 'Expected expression');
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
				const child3 = expectNode(
					expression(precedence),
					'Expected expression',
				);
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
			const child3 = expression(precedence);
			if (!child3) throw error('Expected expression', current());
			result.end = child3.end;
			result.children.push(child3);
			return result;
		};
	}

	const tableApi = {
		...api,
		expression,
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
