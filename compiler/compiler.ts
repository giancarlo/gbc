///<amd-module name="@cxl/gbc.compiler/compiler.js"/>
import { CompilerError, InfixNode, text } from '@cxl/gbc.sdk';
import { Flags } from './symbol-table.js';

import { BlockFlags, Node, NodeMap } from './node.js';

export const RUNTIME = `"use strict";`;

const infix = (n: InfixNode<NodeMap>, op: string = n.kind) =>
	`${compile(n.children[0])}${op}${compile(n.children[1])}`;

const blockLambda = (n: NodeMap['fn']) => {
	const next = n.statements?.[0];
	const expr = next?.kind === 'next' && next.children?.[0];
	return expr ? `(${compile(expr)})` : '';
};
const block = (n: NodeMap['fn']) =>
	n.flags & BlockFlags.Lambda
		? blockLambda(n)
		: `{${n.statements ? compileEach(n.statements) : ''}}`;
const compileEach = (nodes: Node[], sep = ';') => nodes.map(compile).join(sep);
function isExpression(n: Node) {
	return n.kind !== 'next' && n.kind !== 'done';
}
function generatorYield(n: Node) {
	if (n.kind === ',') return n.children.map(next).join(';');
	return next(n);
}
function generatorBody(n: NodeMap['fn']) {
	return n.statements
		? `${
				n.kind === 'fn' && n.statements.length === 1 && isExpression(n)
					? generatorYield(n.statements[0])
					: compileEach(n.statements)
		  }`
		: '';
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
		case 'loop':
			return `(function*(){while(${compile(node.children[0])})yield})()`;
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
			return node.generator
				? nextGenerator(node.children?.[0])
				: next(node.children?.[0]);
		case 'parameter':
		case 'ident':
		case 'string':
		case '~':
		case '!':
			return text(node);
		case '-':
			return node.children[1]
				? infix(node)
				: `${node.kind}${compile(node.children[0])}`;
		case ',':
			return node.children.map(compile).join(',');
		case '=': {
			const [left, right] = node.children;
			if (left.kind === ',') {
				if (right.kind !== ',')
					throw new CompilerError('Invalid definition', right);
				let result = '{';
				for (let i = 0; i < left.children.length; i++) {
					result += `const __${i}=${compile(right.children[i])};`;
				}
				for (let i = 0; i < left.children.length; i++) {
					const name = text(left.children[i]);
					result += `${name}=__${i};`;
				}
				return result + '}';
			}
			return `${text(left)}=${compile(right)}`;
		}
		case '<:':
			return infix(node, '<<');
		case ':>':
			return infix(node, '>>');
		case '==':
			return infix(node, '===');
		case '!=':
			return infix(node, '!==');
		case '+':
		case '.':
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
			let i = node.children.length,
				text = `yield(_${i - 1})`;

			while (i--) {
				const child = node.children[i];
				if (i === 0) break;

				if (i === 1) {
					text = `(function*(){const _=${compile(
						node.children[0],
					)};const __=${compile(
						child,
					)};if(_ instanceof Iterator)for(const _0 of _){for(const _1 of __(_0)){${text}}}else for(const _1 of __(${compile(
						node.children[0],
					)})){${text}}})()`;
				} else
					text = `for(const _${i} of (${compile(child)})(_${
						i - 1
					})){${text}}`;
			}
			return text;
		}
		case 'def': {
			const symbol = node.left.symbol;
			if (symbol.kind !== 'variable') throw 'Invalid node';
			const isVar =
				symbol.kind === 'variable' && symbol.flags & Flags.Variable;
			const isExport = symbol.flags & Flags.Export;

			return `${isExport ? 'export ' : ''}${isVar ? 'let' : 'const'} ${
				symbol.name
			}=${compile(node.right)}`;
		}
		case 'fn': {
			const parameters =
				node.parameters && compileEach(node.parameters, ',');
			return node.flags & BlockFlags.Sequence
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
		case 'macro':
			return node.value;
		case 'comment':
		case 'type':
			return '';
		default:
			throw new CompilerError(`Unexpected "${node.kind}"`, node);
	}
}

export function compiler(root: Node) {
	return RUNTIME + compile(root);
}
