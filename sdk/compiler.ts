///<amd-module name="@cxl/gbc.sdk/compiler.js"/>
import type { Token } from './scanner.js';
import type { ParentNode } from './parser-table.js';
import type { MapNode, NodeMap } from './parser-table.js';

export type Compiler<T extends Token<string>> = (node: T) => string;

export type CompilerTable<T extends NodeMap> = {
	[K in keyof T]: Compiler<T[K]>;
};
export type CompilerApi<Map extends NodeMap> = ReturnType<
	typeof compilerApi<Map>
>;
export type CompilerTableFn<Node extends NodeMap> = (
	api: CompilerApi<Node>,
) => CompilerTable<Node>;
export interface CompilerOptions<Node extends NodeMap> {
	tableFn: CompilerTableFn<Node>;
	runtime?: string;
}

function compilerApi<Map extends NodeMap>(tableFn: CompilerTableFn<Map>) {
	function compile(node: MapNode<Map>) {
		let result = '';
		const compiler = table[node.kind];
		result += compiler(node as Map[string]);
		return result;
	}
	const api = {
		compile,
		compileChildren(node: ParentNode<Map>) {
			return node.children?.map(api.compile).join('') || '';
		},
		compileEach(nodes: MapNode<Map>[], sep = '') {
			return nodes.map(compile).join(sep);
		},
	};
	const table = tableFn(api);
	return api;
}

export function Compiler<Map extends NodeMap>({
	tableFn,
	runtime,
}: CompilerOptions<Map>) {
	const api = compilerApi<Map>(tableFn);

	return {
		compile(root: MapNode<Map>) {
			return `${runtime || ''}${api.compile(root)}`;
		},
	};
}
