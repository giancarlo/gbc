import {
	ParserApi,
	parserTable,
	text,
	type CompilerError,
	type Token,
} from '../sdk/index.js';
import type { Node, NodeMap } from './index.js';
import { scan, type ScannerToken } from './scanner.js';

export interface ParseResult {
	node: Node | undefined;
	errors: CompilerError[];
}

function numberValue(token: Token<'number'> | Token<'label'>): number {
	const value = text(token);
	const lower = value.toLowerCase();
	const end = lower.endsWith('&') ? -1 : lower.length;
	if (lower.startsWith('&h')) return parseInt(lower.slice(2, end), 16);
	if (lower.startsWith('&o')) return parseInt(lower.slice(2, end), 8);
	if (lower.startsWith('&b')) return parseInt(lower.slice(2, end), 2);
	return Number(lower.replace(/d/g, 'e').replace(/[!#%&@]$/, ''));
}

function stringValue(token: Token<'string'>): string {
	return text(token).slice(1, -1).replaceAll('""', '"');
}

const api = ParserApi(scan);
const expression = parserTable<NodeMap, ScannerToken>(table => {
	const { consume, current, expectExpression, infixOperator, optional } = table;

	function argument(): NodeMap['argument'] {
		const start = current();
		let value: Node | undefined;
		if (start.kind === 'to') {
			const operator = consume('to');
			const upper = current().kind === ',' || current().kind === ';' || current().kind === ')'
				? undefined
				: expectExpression();
			value = {
				...operator,
				kind: 'range',
				children: [undefined, upper],
				end: upper?.end ?? operator.end,
			};
		} else if (start.kind !== ',' && start.kind !== ';' && start.kind !== ')') {
			const lower = expectExpression();
			const operator = optional('to');
			if (operator) {
				const upper = current().kind === ',' || current().kind === ';' || current().kind === ')'
					? undefined
					: expectExpression();
				value = {
					...operator,
					kind: 'range',
					start: lower.start,
					children: [lower, upper],
					end: upper?.end ?? operator.end,
				};
			} else value = lower;
		}
		const separator = optional(',') ?? optional(';');
		return {
			...start,
			kind: 'argument',
			children: [value],
			separator: separator?.kind,
			end: separator?.end ?? value?.end ?? start.start,
		};
	}

	function call(open: Token<'('>, left: Node): NodeMap['call'] {
		const children: NodeMap['argument'][] = [];
		while (current().kind !== ')' && current().kind !== 'eof') {
			const item = argument();
			children.push(item);
			if (!item.separator) break;
			if (current().kind === ')') {
				children.push(argument());
				break;
			}
		}
		const close = consume(')');
		return {
			...open,
			kind: 'call',
			start: left.start,
			children: [left, ...children],
			end: close.end,
		};
	}

	return {
		number: {
			prefix(token) {
				const value = text(token);
				return { ...token, value: numberValue(token), text: value };
			},
		},
		label: {
			prefix(token) {
				const value = text(token);
				if (!/^\d+$/.test(value))
					throw table.error('Expected expression', token);
				return {
					...token,
					kind: 'number',
					value: numberValue(token),
					text: value,
				};
			},
		},
		string: {
			prefix(token) {
				return { ...token, value: stringValue(token) };
			},
		},
		ident: {
			prefix(token) {
				return { ...token, name: text(token) };
			},
		},
		'(': {
			precedence: 140,
			prefix(token) {
				const child = expectExpression();
				const close = consume(')');
				return {
					...token,
					kind: 'group',
					children: [child],
					end: close.end,
				};
			},
			infix(token, left) {
				return call(token, left);
			},
		},
		'.': {
			precedence: 140,
			infix(token, left) {
				const member = consume('ident');
				return {
					...token,
					kind: 'member',
					start: left.start,
					children: [left, { ...member, name: text(member) }],
					end: member.end,
				};
			},
		},
		'=>': {
			prefix(token) {
				const child = expectExpression();
				return {
					...token,
					kind: 'expression',
					children: [child],
					end: child.end,
				};
			},
		},
		'^': infixOperator<NodeMap['^']>(130, 129),
		'+': {
			...infixOperator<NodeMap['+']>(80),
			prefix(token) {
				const child = expectExpression(120);
				return {
					...token,
					kind: 'positive',
					children: [child],
					end: child.end,
				};
			},
		},
		'-': {
			...infixOperator<NodeMap['-']>(80),
			prefix(token) {
				const child = expectExpression(120);
				return {
					...token,
					kind: 'negate',
					children: [child],
					end: child.end,
				};
			},
		},
		'*': infixOperator<NodeMap['*']>(110),
		'/': infixOperator<NodeMap['/']>(110),
		'\\': infixOperator<NodeMap['\\']>(100),
		mod: infixOperator<NodeMap['mod']>(90),
		'=': infixOperator<NodeMap['=']>(70),
		'<>': infixOperator<NodeMap['<>']>(70),
		'<': infixOperator<NodeMap['<']>(70),
		'<=': infixOperator<NodeMap['<=']>(70),
		'>': infixOperator<NodeMap['>']>(70),
		'>=': infixOperator<NodeMap['>=']>(70),
		not: {
			prefix: table.prefix(60),
		},
		and: infixOperator<NodeMap['and']>(50),
		or: infixOperator<NodeMap['or']>(40),
		xor: infixOperator<NodeMap['xor']>(30),
		eqv: infixOperator<NodeMap['eqv']>(20),
		imp: infixOperator<NodeMap['imp']>(10),
	};
})(api);

function parse(source: string, assignment: boolean): ParseResult {
	api.start(source);
	const node = api.catchAndRecover(
		() => {
			const left = assignment ? expression(70) : expression();
			if (!left) throw api.error('Expected expression', api.current());
			if (!assignment || !api.optional('=')) return left;
			if (left.kind !== 'ident' && left.kind !== 'member' && left.kind !== 'call')
				throw api.error('Expected assignable expression', left);
			const right = api.expectNode(expression(), 'Expected expression');
			const result: NodeMap['assign'] = {
				...left,
				kind: 'assign',
				children: [left, right],
				end: right.end,
			};
			return result;
		},
		() => undefined,
	);
	const trailing = api.current();
	if (node && trailing.kind !== 'eof' && trailing.kind !== 'eol')
		api.pushError(api.error(`Unexpected token "${trailing.kind}"`, trailing));
	return { node, errors: [...api.errors] };
}

export function parseExpression(source: string): ParseResult {
	return parse(source, false);
}

export function parseAssignment(source: string): ParseResult {
	return parse(source, true);
}
