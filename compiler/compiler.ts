///<amd-module name="@cxl/gbc.compiler/compiler.js"/>
import { InfixNode, text } from '@cxl/gbc.sdk';
import { Flags } from './symbol-table.js';

import type { Node, NodeMap } from './node.js';
import type { RootNode } from './parser.js';

export const RUNTIME = `"use strict";const done=Symbol('done');`;

const infix = (n: InfixNode<NodeMap>, op = n.kind) =>
	`${compile(n.children[0])}${op}${compile(n.children[1])}`;
const block = (n: NodeMap['{'] | NodeMap['main']) =>
	`${
		n.statements.length === 1 && n.statements[0].kind !== 'def'
			? 'return '
			: ''
	}${compileEach(n.statements)}`;
const compileEach = (nodes: Node[], sep = '') => nodes.map(compile).join(sep);

function assign(node: Node, value?: Node) {
	if (node.kind !== 'ident' || !node.symbol || !value)
		throw 'Invalid definition';

	return `${node.symbol.flags & Flags.Variable ? 'let' : 'const'} ${text(
		node,
	)}=${compile(value)};`;
}

export function compile(node: Node): string {
	switch (node.kind) {
		case 'data':
			return `[${compileEach(node.children)}]`;
		case 'done':
			return 'done';
		case 'loop':
			return `while((${compile(node.children[0])})()!==done){}`;
		case 'root':
			return compileEach(node.children);
		case 'main':
			return block(node);
		case 'number':
			return node.value.toString();
		case 'return':
			return `return ${node.children ? compile(node.children[0]) : ''}`;
		case '++':
		case '--':
			return `${compile(node.children[0])}${node.kind}`;
		case '$':
		case 'next':
		case 'parameter':
		case 'ident':
		case 'string':
		case 'var':
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
				if (right.kind !== ',') throw 'Invalid definition';
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
		case '+':
		case '.':
		case '==':
		case '!=':
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
			const [l, r] = node.children;
			const left =
				r.kind === 'ident' || r.kind === 'macro'
					? compile(r)
					: `(${compile(r)})`;
			return `${left}(${compile(l)})`;
		}
		case 'def': {
			const [left, right] = node.children;

			if (left.kind === ',') {
				if (right.kind !== ',') throw 'Invalid definition';
				let result = '';
				for (let i = 0; i < left.children.length; i++) {
					result += assign(left.children[i], right.children[i]);
				}
				return result;
			}

			return assign(left, right);
		}
		case '{': {
			const defaultParam = node.scope.$?.references?.length ? '$' : '';
			return `(${
				node.parameters
					? compileEach(node.parameters, ',')
					: defaultParam
			})=>{${block(node)}}`;
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
		default:
			return '';
	}
}

export function compiler(root: RootNode) {
	return RUNTIME + compile(root);
}
