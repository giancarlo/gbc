import {
	ParserApi,
	parserTable,
	text,
	type CompilerError,
	type NodeWithChildren,
	type Token,
} from '../sdk/index.js';
import type { ComparisonOperator, Node, NodeMap } from './index.js';
import { scan, type ScannerToken } from './scanner.js';

export interface ParseResult {
	node: Node | undefined;
	errors: CompilerError[];
}

type ArgumentStatementNode = Extract<
	NodeWithChildren<NodeMap, NodeMap['argument'][]>,
	{ kind: ScannerToken['kind'] }
>;

type ArgumentStatementKind = ArgumentStatementNode['kind'];
type ArgumentStatementToken = Extract<
	ScannerToken,
	{ kind: ArgumentStatementKind }
>;

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
	const { consume, current, expectExpression, infixOperator, optional } =
		table;

	function argument(): NodeMap['argument'] {
		const start = current();
		let value: Node | undefined;
		if (start.kind === 'to') {
			const operator = consume('to');
			const upper =
				current().kind === ',' ||
				current().kind === ';' ||
				current().kind === ')'
					? undefined
					: expectExpression();
			value = {
				...operator,
				kind: 'range',
				children: [undefined, upper],
				end: upper?.end ?? operator.end,
			};
		} else if (
			start.kind !== ',' &&
			start.kind !== ';' &&
			start.kind !== ')'
		) {
			const lower = expectExpression();
			const operator = optional('to');
			if (operator) {
				const upper =
					current().kind === ',' ||
					current().kind === ';' ||
					current().kind === ')'
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
		timer: {
			prefix(token) {
				return { ...token, kind: 'ident', name: text(token) };
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
			if (
				left.kind !== 'ident' &&
				left.kind !== 'member' &&
				left.kind !== 'call'
			)
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
		api.pushError(
			api.error(`Unexpected token "${trailing.kind}"`, trailing),
		);
	return { node, errors: [...api.errors] };
}

export function parseExpression(source: string): ParseResult {
	return parse(source, false);
}

export function parseAssignment(source: string): ParseResult {
	return parse(source, true);
}

export function parseProgram(source: string): ParseResult {
	api.start(source);
	const { catchAndRecover, consume, current, next, optional } = api;
	const errors = api.errors;
	const boundary = () => {
		const kind = current().kind;
		return (
			kind === 'eof' ||
			kind === 'eol' ||
			kind === ':' ||
			kind === 'comment'
		);
	};

	function ident(): NodeMap['ident'] {
		const token = current();
		if (
			token.kind !== 'ident' &&
			token.kind !== 'label' &&
			token.kind !== 'number'
		)
			throw api.error('Expected identifier', token);
		next();
		return { ...token, kind: 'ident', name: text(token).replace(/:$/, '') };
	}

	function statementValue(): Node | undefined {
		if (current().kind !== '(') return expression();
		const open = consume('(');
		const children: Node[] = [];
		while (current().kind !== ')' && current().kind !== 'eof') {
			const child = expression();
			if (child) children.push(child);
			if (!optional(',')) break;
		}
		const close = consume(')');
		const onlyChild = children[0];
		let value: Node =
			children.length === 1 && onlyChild
				? {
						...open,
						kind: 'group',
						children: [onlyChild],
						end: close.end,
					}
				: { ...open, kind: 'tuple', children, end: close.end };
		if (optional('-')) {
			const right = api.expectNode(
				statementValue(),
				'Expected coordinate',
			);
			value = {
				...value,
				kind: '-',
				children: [value, right],
				end: right.end,
			};
		}
		return value;
	}

	function argument(): NodeMap['argument'] {
		const start = current();
		optional('#');
		const value =
			boundary() || current().kind === ',' || current().kind === ';'
				? undefined
				: statementValue();
		const separator = optional(',') ?? optional(';');
		return {
			...start,
			kind: 'argument',
			children: [value],
			separator: separator?.kind,
			end: separator?.end ?? value?.end ?? start.start,
		};
	}

	function argumentsUntilBoundary(): NodeMap['argument'][] {
		const result: NodeMap['argument'][] = [];
		while (!boundary()) {
			const before = current();
			result.push(argument());
			if (current() === before) next();
			if (!result.at(-1)?.separator && !boundary()) {
				const value = statementValue();
				if (value)
					result.push({
						...value,
						kind: 'argument',
						children: [value],
						separator: undefined,
					});
			}
		}
		return result;
	}

	function argumentStatement(
		token: ArgumentStatementToken,
	): ArgumentStatementNode {
		next();
		const children = argumentsUntilBoundary();
		return {
			...token,
			children,
			end: children.at(-1)?.end ?? token.end,
		};
	}

	function callStatement(token: Token<'call'>): NodeMap['callstmt'] {
		next();
		const value = api.expectNode(expression(), 'Expected procedure call');
		const argument: NodeMap['argument'] = {
			...value,
			kind: 'argument',
			children: [value],
			separator: undefined,
		};
		return {
			...token,
			kind: 'callstmt',
			children: [argument],
			end: value.end,
		};
	}

	function lineStatement(
		token: Token<'line'>,
	): NodeMap['line'] | NodeMap['lineinput'] {
		next();
		const lineInput = optional('input');
		const children = argumentsUntilBoundary();
		return {
			...token,
			kind: lineInput ? 'lineinput' : 'line',
			children,
			end: children.at(-1)?.end ?? lineInput?.end ?? token.end,
		};
	}

	function genericCallStatement(token: ScannerToken): NodeMap['callstmt'] {
		next();
		const command: NodeMap['ident'] = {
			...token,
			kind: 'ident',
			name: text(token),
		};
		const children: NodeMap['argument'][] = [
			{
				...command,
				kind: 'argument',
				children: [command],
				separator: undefined,
			},
			...argumentsUntilBoundary(),
		];
		return {
			...token,
			kind: 'callstmt',
			children,
			end: children.at(-1)?.end ?? token.end,
		};
	}

	function assignmentOrCall(): Node {
		const start = current();
		const left = api.expectNode(expression(70), 'Expected expression');
		if (optional('=')) {
			if (
				left.kind !== 'ident' &&
				left.kind !== 'member' &&
				left.kind !== 'call'
			)
				throw api.error('Expected assignable expression', left);
			const right = api.expectNode(expression(), 'Expected expression');
			return {
				...left,
				kind: 'assign',
				children: [left, right],
				end: right.end,
			};
		}
		if (boundary()) return left;
		const children: NodeMap['argument'][] = [
			{
				...left,
				kind: 'argument',
				children: [left],
				separator: undefined,
			},
		];
		children.push(...argumentsUntilBoundary());
		return {
			...start,
			kind: 'callstmt',
			children,
			end: children.at(-1)?.end ?? start.end,
		};
	}

	function skipSeparators(includeColon = true, includeEol = true) {
		for (;;) {
			if (current().kind === 'comment') next();
			else if (includeEol && optional('eol')) continue;
			else if (includeColon && optional(':')) continue;
			else break;
		}
	}

	function dimensions() {
		const result: Node[] = [];
		if (!optional('(')) return result;
		while (current().kind !== ')' && current().kind !== 'eof') {
			const lower = expression();
			if (lower && optional('to')) {
				const upper = api.expectNode(
					expression(),
					'Expected upper bound',
				);
				result.push({
					...lower,
					kind: 'range',
					children: [lower, upper],
					end: upper.end,
				});
			} else if (lower) result.push(lower);
			if (!optional(',')) break;
		}
		consume(')');
		return result;
	}

	function skipInitializer() {
		if (!optional('=>')) return;
		let depth = 0;
		while (!boundary()) {
			if (current().kind === '{') depth++;
			else if (current().kind === '}') depth--;
			next();
			if (depth === 0) break;
		}
	}

	function block(
		stop: () => boolean,
		includeColon = true,
		includeEol = true,
	): NodeMap['block'] {
		const start = current();
		const children: Node[] = [];
		skipSeparators(includeColon, includeEol);
		while (current().kind !== 'eof' && !stop()) {
			const before = current();
			const parsed = catchAndRecover(statement, () => {
				while (!boundary()) next();
				return undefined;
			});
			if (parsed) children.push(parsed);
			if (current() === before) {
				api.pushError(
					api.error(`Unexpected token "${before.kind}"`, before),
				);
				next();
			}
			skipSeparators(includeColon, includeEol);
		}
		return {
			...start,
			kind: 'block',
			children,
			end: children.at(-1)?.end ?? start.start,
		};
	}

	function variableDeclaration(): Node {
		const token = current();
		const redim = token.kind === 'redim';
		next();
		let shared = false;
		let staticVariable = token.kind === 'static';
		while (current().kind === 'shared' || current().kind === 'static') {
			shared ||= current().kind === 'shared';
			staticVariable ||= current().kind === 'static';
			next();
		}
		if (optional('as')) next();
		const declarations: Node[] = [];
		while (!boundary()) {
			const name = ident();
			const dimensionNodes = dimensions();
			if (optional('as')) next();
			skipInitializer();
			declarations.push({
				...name,
				kind: 'variable',
				children: dimensionNodes,
				name: name.name,
				dimensionCount: dimensionNodes.length,
				shared,
				static: staticVariable,
				redim,
				end: dimensionNodes.at(-1)?.end ?? name.end,
			});
			if (!optional(',')) break;
		}
		const declaration = declarations[0];
		if (declarations.length === 1 && declaration) return declaration;
		return {
			...token,
			kind: 'block',
			children: declarations,
			end: declarations.at(-1)?.end ?? token.end,
		};
	}

	function constantDeclaration(): NodeMap['constant'] {
		const token = consume('const');
		const name = ident();
		consume('=');
		const value = api.expectNode(expression(), 'Expected constant value');
		return {
			...token,
			kind: 'constant',
			children: [value],
			name: name.name,
			end: value.end,
		};
	}

	function parameters(): NodeMap['parameter'][] {
		const result: NodeMap['parameter'][] = [];
		if (!optional('(')) return result;
		while (current().kind !== ')' && current().kind !== 'eof') {
			const name = ident();
			let array = false;
			if (optional('(')) {
				consume(')');
				array = true;
			}
			if (optional('as')) next();
			result.push({ ...name, kind: 'parameter', name: name.name, array });
			if (!optional(',')) break;
		}
		consume(')');
		return result;
	}

	function procedure(declaration: boolean): Node {
		const token = declaration ? consume('declare') : current();
		const procedureToken = current();
		if (procedureToken.kind !== 'sub' && procedureToken.kind !== 'function')
			throw api.error('Expected SUB or FUNCTION', procedureToken);
		next();
		const name = ident();
		const params = parameters();
		if (declaration)
			return {
				...token,
				kind: 'declare',
				children: params,
				procedureKind: procedureToken.kind,
				name: name.name,
				end: params.at(-1)?.end ?? name.end,
			};
		optional('static');
		skipSeparators();
		const body = block(
			() => current().kind === 'end' && api.peekKind(procedureToken.kind),
		);
		consume('end');
		consume(procedureToken.kind);
		return {
			...token,
			kind: 'procedure',
			children: [...params, body],
			procedureKind: procedureToken.kind,
			name: name.name,
			parameterCount: params.length,
			expression: false,
			end: current().start,
		};
	}

	function ifStatement(): NodeMap['if'] {
		const token = consume('if');
		const branches: NodeMap['branch'][] = [];
		let condition = api.expectNode(expression(), 'Expected IF condition');
		if (optional('=>')) {
			const right = api.expectNode(expression(), 'Expected IF condition');
			condition = {
				...condition,
				kind: '>=',
				children: [condition, right],
				end: right.end,
			};
		}
		const impliedGoto =
			current().kind === 'goto' || current().kind === 'gosub';
		if (!impliedGoto) consume('then');
		const multiline =
			current().kind === 'eol' || current().kind === 'comment';
		for (;;) {
			if (multiline) skipSeparators();
			const body = block(
				() =>
					current().kind === 'elseif' ||
					current().kind === 'else' ||
					(current().kind === 'end' && api.peekKind('if')) ||
					(!multiline &&
						(current().kind === 'eol' || current().kind === 'eof')),
				true,
				multiline,
			);
			branches.push({
				...condition,
				kind: 'branch',
				children: [condition, body],
				end: body.end,
			});
			if (optional('elseif')) {
				condition = api.expectNode(
					expression(),
					'Expected ELSEIF condition',
				);
				consume('then');
				continue;
			}
			if (optional('else')) {
				const elseBody = multiline
					? (skipSeparators(),
						block(
							() => current().kind === 'end' && api.peekKind('if'),
						))
					: block(
							() => boundary() || current().kind === 'else',
							true,
							false,
						);
				branches.push({
					...token,
					kind: 'branch',
					children: [undefined, elseBody],
					end: elseBody.end,
				});
			}
			break;
		}
		if (multiline) {
			consume('end');
			consume('if');
		}
		return {
			...token,
			kind: 'if',
			children: branches,
			end: branches.at(-1)?.end ?? token.end,
		};
	}

	function isComparisonOperator(kind: string): kind is ComparisonOperator {
		return (
			kind === '=' ||
			kind === '<>' ||
			kind === '<' ||
			kind === '<=' ||
			kind === '>' ||
			kind === '>='
		);
	}

	function forStatement(): NodeMap['for'] {
		const token = consume('for');
		const variable = api.expectNode(
			expression(70),
			'Expected FOR variable',
		);
		consume('=');
		const lower = api.expectNode(expression(), 'Expected FOR lower bound');
		consume('to');
		const upper = api.expectNode(expression(), 'Expected FOR upper bound');
		const step = optional('step')
			? api.expectNode(expression(), 'Expected STEP value')
			: undefined;
		skipSeparators();
		const body = block(() => current().kind === 'next');
		if (optional('next')) {
			while (!boundary()) {
				if (current().kind === 'ident') next();
				if (!optional(',')) break;
			}
		}
		return {
			...token,
			kind: 'for',
			children: [variable, lower, upper, step, body],
			end: body.end,
		};
	}

	function doStatement(): NodeMap['do'] {
		const token = consume('do');
		let precondition: 'while' | 'until' | undefined;
		let before: Node | undefined;
		if (current().kind === 'while' || current().kind === 'until') {
			const conditionKind =
				current().kind === 'while' ? 'while' : 'until';
			precondition = conditionKind;
			next();
			before = api.expectNode(expression(), 'Expected loop condition');
		}
		skipSeparators();
		const body = block(() => current().kind === 'loop');
		consume('loop');
		let postcondition: 'while' | 'until' | undefined;
		let after: Node | undefined;
		if (current().kind === 'while' || current().kind === 'until') {
			const conditionKind =
				current().kind === 'while' ? 'while' : 'until';
			postcondition = conditionKind;
			next();
			after = api.expectNode(expression(), 'Expected loop condition');
		}
		return {
			...token,
			kind: 'do',
			children: [before, body, after],
			precondition,
			postcondition,
			end: after?.end ?? body.end,
		};
	}

	function whileStatement(): NodeMap['do'] {
		const token = consume('while');
		const condition = api.expectNode(
			expression(),
			'Expected WHILE condition',
		);
		skipSeparators();
		const body = block(() => current().kind === 'wend');
		consume('wend');
		return {
			...token,
			kind: 'do',
			children: [condition, body, undefined],
			precondition: 'while',
			postcondition: undefined,
			end: body.end,
		};
	}

	function selectStatement(): NodeMap['select'] {
		const token = consume('select');
		consume('case');
		const value = api.expectNode(expression(), 'Expected SELECT value');
		const cases: NodeMap['case'][] = [];
		skipSeparators();
		while (current().kind === 'case') {
			const caseToken = consume('case');
			let isElse = false;
			const tests: Node[] = [];
			if (optional('else')) isElse = true;
			else
				while (!boundary()) {
					if (optional('is')) {
						const operator = current();
						if (!isComparisonOperator(operator.kind))
							throw api.error(
								'Expected CASE comparison',
								operator,
							);
						next();
						const child = api.expectNode(
							expression(),
							'Expected CASE value',
						);
						tests.push({
							...operator,
							kind: 'caseis',
							children: [child],
							operator: operator.kind,
							end: child.end,
						});
					} else {
						const lower = api.expectNode(
							expression(),
							'Expected CASE value',
						);
						if (optional('to')) {
							const upper = api.expectNode(
								expression(),
								'Expected CASE range',
							);
							tests.push({
								...lower,
								kind: 'caserange',
								children: [lower, upper],
								end: upper.end,
							});
						} else tests.push(lower);
					}
					if (!optional(',')) break;
				}
			skipSeparators();
			const body = block(
				() =>
					current().kind === 'case' ||
					(current().kind === 'end' && api.peekKind('select')),
			);
			cases.push({
				...caseToken,
				kind: 'case',
				children: [...tests, body],
				testCount: tests.length,
				isElse,
				end: body.end,
			});
		}
		consume('end');
		consume('select');
		return {
			...token,
			kind: 'select',
			children: [value, ...cases],
			end: cases.at(-1)?.end ?? value.end,
		};
	}

	function jump(
		token: Token<'goto'> | Token<'gosub'>,
	): NodeMap['goto'] | NodeMap['gosub'] {
		next();
		const target = ident();
		if (token.kind === 'goto')
			return { ...token, children: [target], end: target.end };
		return { ...token, children: [target], end: target.end };
	}

	function dataStatement(): NodeMap['data'] {
		const token = consume('data');
		const children: Node[] = [];
		while (!boundary()) {
			const start = current();
			let end = start.end;
			while (!boundary() && current().kind !== ',') {
				end = current().end;
				next();
			}
			const value = start.source.slice(start.start, end);
			children.push({
				...start,
				kind: 'string',
				value: start.kind === 'string' ? stringValue(start) : value,
				end,
			});
			optional(',');
		}
		return {
			...token,
			kind: 'data',
			children,
			end: children.at(-1)?.end ?? token.end,
		};
	}

	function statement(): Node | undefined {
		const token = current();
		switch (token.kind) {
			case 'eof':
			case 'eol':
			case ':':
			case 'comment':
				return undefined;
			case 'label': {
				next();
				return {
					...token,
					kind: 'label',
					name: text(token).replace(/:$/, ''),
				};
			}
			case 'if':
				return ifStatement();
			case 'for':
				return forStatement();
			case 'do':
				return doStatement();
			case 'while':
				return whileStatement();
			case 'select':
				return selectStatement();
			case 'sub':
			case 'function':
				return procedure(false);
			case 'declare':
				return procedure(true);
			case 'dim':
			case 'redim':
			case 'static':
			case 'common':
				return variableDeclaration();
			case 'const':
				return constantDeclaration();
			case 'goto':
			case 'gosub':
				return jump(token);
			case 'return': {
				next();
				const target = boundary() ? undefined : ident();
				return {
					...token,
					kind: 'return',
					children: [target],
					end: target?.end ?? token.end,
				};
			}
			case 'data':
				return dataStatement();
			case 'call':
				return callStatement(token);
			case 'line':
				return lineStatement(token);
			case 'print':
			case 'input':
			case 'read':
			case 'restore':
			case 'randomize':
			case 'screen':
			case 'color':
			case 'locate':
			case 'cls':
			case 'pset':
			case 'preset':
			case 'circle':
			case 'paint':
			case 'get':
			case 'put':
			case 'draw':
			case 'play':
			case 'sound':
			case 'beep':
			case 'out':
			case 'poke':
			case 'open':
			case 'close':
			case 'write':
			case 'width':
			case 'view':
			case 'window':
			case 'defseg':
			case 'bload':
			case 'bsave':
			case 'clear':
			case 'end':
			case 'erase':
			case 'error':
			case 'let':
			case 'lock':
			case 'lprint':
			case 'lset':
			case 'option':
			case 'palette':
			case 'pcopy':
			case 'reset':
			case 'rset':
			case 'run':
			case 'seek':
			case 'shell':
			case 'sleep':
			case 'stop':
			case 'swap':
			case 'system':
			case 'unlock':
			case 'wait':
				return argumentStatement(token);
			case 'next':
			case 'loop':
			case 'wend':
			case 'elseif':
			case 'else':
				return undefined;
			default:
				return token.kind === 'ident' ||
					token.kind === 'number' ||
					token.kind === 'string' ||
					token.kind === '(' ||
					token.kind === '-' ||
					token.kind === '+' ||
					token.kind === 'not'
					? assignmentOrCall()
					: genericCallStatement(token);
		}
	}

	const start = current();
	const body = block(() => false);
	const root: NodeMap['root'] = {
		...start,
		kind: 'root',
		children: body.children,
		end: body.end,
	};
	return { node: root, errors: [...errors] };
}
