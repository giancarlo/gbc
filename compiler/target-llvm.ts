import { CompilerError } from '@cxl/gbc.sdk';
import type { Node, NodeMap } from './node.js';

export function compileLlvm(root: NodeMap['root']): string {
	const calls: string[] = [];
	let hasMain = false;
	function unsupported(node: Node): never {
		throw new CompilerError(
			'LLVM target supports only an empty main or Int32 literal >> out statements',
			node,
		);
	}
	for (const node of root.children) {
		if (node.kind === 'comment') continue;
		if (node.kind !== 'main' || hasMain) unsupported(node);
		hasMain = true;
		for (const statement of node.statements) {
			if (statement.kind === 'comment') continue;
			if (statement.kind !== '>>' || statement.children.length !== 2)
				unsupported(statement);
			const [value, output] = statement.children;
			if (!value || !output || value.kind !== 'number' ||
				output.kind !== 'ident' || output.symbol.name !== 'out' ||
				typeof value.value !== 'number' || value.float ||
				!Number.isInteger(value.value) ||
				value.value < -2147483648 || value.value > 2147483647)
				unsupported(statement);
			calls.push(`  %out${calls.length} = call i32 (ptr, ...) @printf(ptr @.format, i32 ${value.value})`);
		}
	}
	if (!hasMain) throw new CompilerError('LLVM target requires a main block', root);
	return [
		'@.format = private unnamed_addr constant [3 x i8] c"%d\\00"',
		'declare i32 @printf(ptr, ...)',
		'define i32 @main() {',
		'entry:',
		...calls,
		'  ret i32 0',
		'}',
		'',
	].join('\n');
}
