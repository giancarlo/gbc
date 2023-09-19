///<amd-module name="@cxl/gbc.compiler/compiler.js"/>
import { InfixNode, text } from '@cxl/gbc.sdk';
import { RootNode, Node, Flags, NodeMap } from './parser.js';

export const RUNTIME = '"use strict";';

const infix = (n: InfixNode<NodeMap>) =>
	`${compile(n.children[0])}${n.kind}${compile(n.children[1])}`;
const block = (n: NodeMap['{'] | NodeMap['main']) =>
	`${n.statements.length === 1 ? 'return ' : ''}${compileEach(n.statements)}`;
const compileEach = (nodes: Node[], sep = '') => nodes.map(compile).join(sep);

export function compile(node: Node): string {
	switch (node.kind) {
		case 'data':
			return `[${compileEach(node.children)}]`;
		case 'root':
			return compileEach(node.children);
		case 'main':
			return block(node);
		case 'number':
			return node.value.toString();
		case '$':
		case 'next':
		case 'parameter':
		case 'ident':
		case 'string':
		case 'var':
		case 'done':
		case '~':
		case '!':
			return text(node);
		case '-':
			return node.children[1]
				? infix(node)
				: `${node.kind}${compile(node.children[0])}`;
		case '+':
		case '.':
		case '==':
		case '!=':
		case '=':
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
		case '<<':
		case ',':
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
		case 'def':
			return `${node.flags & Flags.Variable ? 'let' : 'const'} ${compile(
				node.children[0],
			)}=${compile(node.children[1])};`;
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
