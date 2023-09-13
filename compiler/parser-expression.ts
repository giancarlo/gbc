///<amd-module name="@cxl/gbc.compiler/parser-expression.js"/>
import { ErrorApi } from './error.js';

import type { ScannerToken, ScanFn, Token, Kind } from './scanner.js';

type MakeNodeMap<Base> = {
	[K in keyof Base]: Token<K> & Base[K];
};
type Infix = { children: [Node, Node] };
type MakeInfix<T extends string> = { [K in T]: Infix };

/* eslint @typescript-eslint/ban-types:off */
export type BaseNodeMap = {
	root: { children: Node[] };
	ident: {};
	string: {};
	number: {};
	comment: {};
	'?': { children: [Node, Node, Node | undefined] };
	'~': { children: [Node] };
	'!': { children: [Node] };
	'+': { children: [Node] };
	'-': { children: [Node] };
	call: { children: [Node, Node | undefined] };
} & MakeInfix<
	| '.'
	| '='
	| '>>'
	| ','
	| '||'
	| '&&'
	| '+'
	| '-'
	| '*'
	| '/'
	| '|'
	| '&'
	| '=='
	| '!='
	| '<'
	| '>'
	| '<='
	| '>='
	| '^'
>;
export type NodeMap = MakeNodeMap<BaseNodeMap>;
export type Node = NodeMap[keyof NodeMap];
export type NodeKind = keyof NodeMap;

export type OperatorTable = {
	[K in Kind]?: Operator<K>;
};
export type Operator<K extends string> =
	| {
			precedence: number;
			infix(token: Token<K>, left: Node): Node;
			prefix?(token: Token<K>): Node;
	  }
	| {
			prefix(token: Token<K>): Node;
			infix?: never;
	  };

type NodeWithChildren<Children = Node[]> = {
	[K in keyof NodeMap]: NodeMap[K] extends {
		children: Children;
	}
		? NodeMap[K]
		: never;
}[keyof NodeMap];

export type UnaryNode = NodeWithChildren<[Node]>;
export type InfixNode = NodeWithChildren<[Node, Node]>;
export type TernaryNode<Optional extends boolean> = NodeWithChildren<
	[Node, Node, Optional extends true ? Node | undefined : Node]
>;

export type ParserApi = ReturnType<typeof ParserApi>;
export function ParserApi(scanner: ScanFn) {
	const { error, errors, catchAndRecover, pushError } = ErrorApi();
	let token: ScannerToken;
	let scan: ReturnType<typeof scanner>;
	const current = () => token;

	function start(src: string) {
		scan = scanner(src);
		errors.length = 0;
		next();
	}

	function next(): ScannerToken {
		return catchAndRecover(() => (token = scan()), next);
	}

	function optional<K extends Kind>(kind: K) {
		if (kind === token.kind) {
			const result = token;
			next();
			return result as Token<K>;
		}
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

	function parseUntilKind<C>(parser: () => C | undefined, kind: Kind) {
		return parseUntil(parser, () => current()?.kind === kind);
	}

	/** Verify token is the correct kind and advance */
	function expect<K extends Kind>(kind: K): Token<K> {
		if (kind !== token.kind)
			throw error(`Expected "${kind}" but got "${token.kind}"`, token);

		const result = token as Token<K>;
		next();
		return result;
	}

	function expectNode<C>(node: C | undefined, msg: string) {
		if (!node) throw error(msg, token);
		return node;
	}

	return {
		current,
		error,
		parseUntilKind,
		pushError,
		errors,
		expect,
		expectNode,
		next,
		optional,
		start,
	};
}

export function parseExpression(api: ParserApi) {
	const { current, expect, expectNode, next, optional } = api;

	const table: OperatorTable = {
		'>>': infixOperator(2),
		'||': infixOperator(3),
		'&&': infixOperator(4),
		'|': infixOperator(5),
		'^': infixOperator(6),
		'&': infixOperator(7),
		'==': infixOperator(8),
		'!=': infixOperator(8),
		'<': infixOperator(9),
		'>': infixOperator(9),
		'<=': infixOperator(9),
		'>=': infixOperator(9),
		'/': infixOperator(12),
		'*': infixOperator(12),
		',': infixOperator(3),
		'=': infixOperator(2, 0),
		'+': {
			precedence: 11,
			prefix: prefix(14),
			infix: infix(11),
		},
		'-': {
			precedence: 11,
			prefix: prefix(14),
			infix: infix(11),
		},
		'~': {
			prefix: prefix(14),
		},
		'!': {
			prefix: prefix(14),
		},
		'.': {
			precedence: 17,
			infix(tk, left) {
				const right = expect('ident') as NodeMap['ident'];
				return {
					...tk,
					start: left.start,
					children: [left, right],
					end: right.end,
				};
			},
		},
		'(': {
			precedence: 20,
			prefix() {
				const node = expectNode(expression(), 'Expected expression');
				expect(')');
				return node;
			},
			infix(tk, left) {
				return {
					...tk,
					kind: 'call',
					children: [left, expression()],
					end: expect(')').end,
				};
			},
		},
		'?': {
			precedence: 2,
			infix: ternaryOptional(2, ':'),
		},
		number: { prefix: n => n },
		string: { prefix: n => n },
		ident: { prefix: n => n },
	};

	function expression(precedence = 0) {
		const left = current();
		const prefixOp = (table[left.kind] as Operator<string>)?.prefix;
		let result = prefixOp ? (next(), prefixOp(left)) : undefined;

		while (result) {
			const n = current();
			const op = table[n.kind] as Operator<string>;
			if (op?.infix && precedence < op.precedence) {
				next();
				result = op.infix(n, result);
			} else break;
		}

		return result;
	}

	function infix<N extends InfixNode>(rbp: number) {
		return (tk: Token<string>, left: Node) => {
			const right = expectNode(expression(rbp), 'Expected expression');
			const node = tk as N;
			node.start = left.start;
			node.children = [left, right];
			node.end = right.end;
			return node;
		};
	}

	function infixOperator<N extends InfixNode>(
		precedence: number,
		rbp = precedence,
	) {
		return {
			precedence,
			infix: infix<N>(rbp),
		};
	}

	function prefix<K extends UnaryNode['kind']>(rbp = 0) {
		return (tk: Token<K>) => {
			const right = expectNode(expression(rbp), 'Expected expression');
			return {
				...tk,
				children: [right],
				end: right.end,
			} as unknown as NodeMap[K];
		};
	}

	function ternaryOptional<N extends TernaryNode<true>>(
		precedence: number,
		operator2: Kind,
	) {
		const _infix = infix(precedence);
		return (node: Token<N['kind']>, left: Node) => {
			const result = _infix(node, left) as unknown as N;
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

	return expression;
}
