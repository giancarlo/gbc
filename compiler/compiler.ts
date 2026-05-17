import { CompilerError, InfixNode, text } from '../sdk/index.js';
import { Flags } from './symbol-table.js';

import { Node, NodeMap } from './node.js';

export const RUNTIME = `"use strict";
const __std={
	*out(...args){console.log(...args); yield* args}
};
const __iter= r => {
	return r instanceof Iterator ? r : [r];
};`;

const infix = (n: InfixNode<NodeMap>, op: string = n.kind) =>
	`${compile(n.children[0])}${op}${compile(n.children[1])}`;

const blockLambda = (n: NodeMap['fn']) => {
	const next = n.statements?.[0];
	const expr = next?.kind === 'next' && next.children?.[0];
	return expr ? `(${compile(expr)})` : '';
};
const block = (n: NodeMap['fn']) =>
	n.symbol.flags & Flags.Lambda
		? blockLambda(n)
		: `{${n.statements ? compileEach(n.statements) : ''}}`;
const compileEach = (nodes: Node[], sep = ';') => nodes.map(compile).join(sep);
function isExpression(n: Node) {
	return n.kind !== 'next' && n.kind !== 'done' && n.kind !== 'def';
}
function generatorYield(n: Node) {
	if (n.kind === ',') return n.children.map(nextGenerator).join(';');
	return nextGenerator(n);
}
function generatorBody(n: NodeMap['fn']) {
	if (!n.statements) return '';
	const only = n.statements.length === 1 ? n.statements[0] : undefined;
	return only !== undefined && isExpression(only)
		? generatorYield(only)
		: compileEach(n.statements);
}

function next(child?: Node) {
	return child ? `return(${compile(child)})` : 'return';
}

function nextGenerator(child?: Node) {
	return child
		? `{const _$=${compile(
				child,
			)};if(_$ instanceof Iterator)(yield* _$);else (yield _$)}`
		: 'yield';
}

export function compile(node: Node): string {
	switch (node.kind) {
		case 'data':
			return `[${compileEach(node.children)}]`;
		case 'done':
			return 'return;';
		case 'break':
			return 'break;';
		case 'loop':
			return `(function*(){let __i=0;while(true)yield __i++})()`;
		case 'root':
			return compileEach(node.children);
		case 'main':
			return compileEach(node.statements);
		case 'number':
			return node.value.toString();
		case '++':
		case '--':
			return `${compile(node.children[0])}${node.kind}`;
		case 'next':
			return node.owner.flags & Flags.Sequence
				? nextGenerator(node.children?.[0])
				: next(node.children?.[0]);
		case 'parameter': {
			const name = text(node.label);
			return node.value ? `${name}=${compile(node.value)}` : name;
		}
		case 'ident':
		case 'string':
		case '~':
		case '!':
			return text(node);
		case '-':
			return infix(node);
		case 'negate':
			return `${node.kind}${compile(node.children[0])}`;
		case ',':
			return node.children.map(compile).join(',');
		case '=': {
			const [left, right] = node.children;
			if (left.kind === ',') {
				if (right.kind !== ',')
					throw new CompilerError('Invalid definition', right);
				let result = '{';
				for (let i = 0; i < left.children.length; i++) {
					const child = right.children[i];
					if (child !== undefined)
						result += `const __${i}=${compile(child)};`;
				}
				for (let i = 0; i < left.children.length; i++) {
					const child = left.children[i];
					if (child) result += `${text(child)}=__${i};`;
				}
				return result + '}';
			}
			return `${text(left)}=${compile(right)}`;
		}
		case '@':
			return '__std';
		case '<:':
			return infix(node, '<<');
		case ':>':
			return infix(node, '>>');
		case '==':
			return infix(node, '===');
		case '!=':
			return infix(node, '!==');
		case '.': {
			const [left, right] = node.children;
			if (right.kind === 'number')
				return `${compile(left)}[${right.value}]`;
			if (right.kind === 'ident' && left.kind === 'data') {
				const idx = dataLabelIndex(left, right.symbol.name);
				if (idx >= 0)
					return `${compile(left)}[${idx}]`;
			}
			return infix(node);
		}
		case '+':
		case '|':
		case '&&':
		case '||':
		case '&':
		case '/':
		case '*':
		case '>':
		case '<':
		case '>=':
		case '<=':
		case '^':
			return infix(node);
		case '>>': {
			const [first, ...stages] = node.children;
			if (!first || !stages.length) throw new Error('Invalid Node');
			const valueId = '_0';
			const fnIds = stages.map((_, i) => `_f${i}`);
			let header = `const ${valueId}=${compile(first)}`;
			for (let i = 0; i < stages.length; i++)
				header += `,${fnIds[i]}=${compile(stages[i]!)}`;
			header += ';';

			const build = (i: number, input: string): string => {
				const result = `_r${i}`;
				const value = `_v${i + 1}`;
				const inner =
					i === stages.length - 1
						? `yield ${value}`
						: build(i + 1, value);
				return `const ${result}=${fnIds[i]}(${input});for(const ${value} of __iter(${result})){${inner}}`;
			};

			const body = `for(const _v0 of __iter(${valueId})){${build(
				0,
				'_v0',
			)}}`;
			return `(function*(){${header}${body}})()`;
		}
		case 'def': {
			const symbol = node.label.symbol;
			if (symbol.kind !== 'variable') throw 'Invalid node';
			const isVar = symbol.flags & Flags.Variable;
			const isExport = symbol.flags & Flags.Export;

			return `${isExport ? 'export ' : ''}${isVar ? 'let' : 'const'} ${
				symbol.name
			}=${compile(node.value)}`;
		}
		case '$':
			return '$';
		case 'fn': {
			const parameters =
				node.parameters && compileEach(node.parameters, ',');
			return node.symbol.flags & Flags.Sequence
				? `function*(${parameters ?? '$'}){${generatorBody(node)}}`
				: `(${parameters ?? ''})=>${block(node)}`;
		}
		case '?':
			return `${compile(node.children[0])} ? ${compile(
				node.children[1],
			)} : ${node.children[2] ? compile(node.children[2]) : undefined}`;
		case 'call':
			return `${compile(node.children[0])}(${
				node.children[1] ? compile(node.children[1]) : ''
			})`;
		case 'propdef':
			return node.value ? compile(node.value) : '';
		case 'is':
			return `(${compile(node.children[0])} instanceof ${compile(node.children[1])})`;
		case 'typeident':
			return text(node);
		case 'external':
		case 'comment':
		case 'type':
			return '';
		default:
			throw new CompilerError(`Unexpected "${node.kind}"`, node);
	}
}

function dataLabelIndex(
	data: NodeMap['data'],
	name: string | undefined,
): number {
	if (!name) return -1;
	const inner = data.children[0];
	if (!inner) return -1;
	if (inner.kind === 'propdef')
		return inner.label?.symbol.name === name ? 0 : -1;
	if (inner.kind !== ',') return -1;
	for (let i = 0; i < inner.children.length; i++) {
		const item = inner.children[i];
		if (item?.kind === 'propdef' && item.label?.symbol.name === name)
			return i;
	}
	return -1;
}

export function compiler(root: Node) {
	return RUNTIME + compile(root);
}
