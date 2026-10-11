import {
	ParserApi,
	ScannerApi,
	matchers,
	text,
	type CompilerError,
	type Scanner,
	type Token,
} from '@cxl/gbc.sdk';

export type ScannerKind =
	| '{' | '}' | '[' | ']' | ':' | ','
	| 'string' | 'number' | 'true' | 'false' | 'null';
export type ScannerToken = Token<ScannerKind | 'eof'>;
export type StringNode = Token<'string'> & { value: string };
export type PropertyNode = Token<'property'> & { children: [StringNode, Node] };
export type Node =
	| StringNode
	| Token<'number'> & { value: number }
	| Token<'literal'> & { value: boolean | null }
	| Token<'object'> & { children: PropertyNode[] }
	| Token<'array'> & { children: Node[] };
export interface ParseResult {
	node: Node | undefined;
	errors: CompilerError[];
}

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const boundary = (ch: string) => !ch || '{}[]:, \t\r\n'.includes(ch);

export const scan: Scanner<ScannerToken> = source => {
	const { current, tk, eof, matchWhile, skipWhitespace, backtrack, error } =
		ScannerApi({ source });

	function string() {
		let consumed = 1;
		let valid = true;
		while (!eof(consumed)) {
			const ch = current(consumed++);
			if (ch === '"') {
				if (!valid) throw error('Invalid string', consumed);
				return tk('string', consumed);
			}
			if (ch < ' ') throw error('Unescaped control character', consumed - 1);
			if (ch !== '\\') continue;
			const escape = current(consumed++);
			if (escape && escape < ' ')
				throw error('Invalid escape', consumed - 1);
			if (escape === 'u') {
				for (let i = 0; i < 4; i++) {
					if (!matchers.hexDigit(current(consumed))) {
						valid = false;
						break;
					}
					consumed++;
				}
			} else if (!escape || !'"\\/bfnrt'.includes(escape)) valid = false;
		}
		throw error('Unterminated string', Math.min(consumed, source.length - tk('', 0).start));
	}

	function next(): ScannerToken {
		skipWhitespace();
		if (eof()) return tk('eof', 0);
		const ch = current();
		switch (ch) {
			case '{': case '}': case '[': case ']': case ':': case ',':
				return tk(ch, 1);
			case '"':
				return string();
		}
		const consumed = matchWhile(ch => !boundary(ch));
		const start = tk('', 0).start;
		const value = source.slice(start, start + consumed);
		if (value === 'true' || value === 'false' || value === 'null')
			return tk(value, consumed);
		if (numberPattern.test(value)) return tk('number', consumed);
		throw error('Invalid JSON token', Math.max(1, consumed));
	}

	return { next, backtrack };
};

export function parse(source: string): ParseResult {
	const api = ParserApi(scan);
	const { current, consume, next, optional, error } = api;

	function string(): StringNode {
		const token = consume('string');
		const value: string = JSON.parse(text(token));
		return { ...token, value };
	}

	function property(): PropertyNode {
		const key = string();
		consume(':');
		const value = node();
		return { ...key, kind: 'property', end: value.end, children: [key, value] };
	}

	function container<K extends 'object' | 'array', C extends Node | PropertyNode>(
		kind: K,
		open: '{' | '[',
		close: '}' | ']',
		item: () => C,
	): Token<K> & { children: C[] } {
		const token = consume(open);
		const children: C[] = [];
		if (current().kind !== close) {
			do children.push(item());
			while (optional(','));
		}
		return { ...token, kind, children, end: consume(close).end };
	}

	function node(): Node {
		const token = current();
		switch (token.kind) {
			case 'string': return string();
			case 'number':
				next();
				return { ...token, kind: 'number', value: Number(text(token)) };
			case 'true': case 'false': case 'null':
				next();
				return { ...token, kind: 'literal', value: token.kind === 'null' ? null : token.kind === 'true' };
			case '{': return container('object', '{', '}', property);
			case '[': return container('array', '[', ']', node);
			default: throw error('Expected JSON value', token);
		}
	}

	const result = api.catchAndRecover(() => {
		api.start(source);
		const result = node();
		consume('eof');
		return result;
	}, () => undefined);
	return { node: api.errors.length ? undefined : result, errors: api.errors };
}
