import {
	CompilerError,
	Flags,
	syntheticNext,
	type AstContext,
	type AstNodeMap,
	type CheckedBody,
	type Position,
	type ScalarType,
} from '@cxl/gbc.sdk/frontend.js';
import { compileLlvm } from '@cxl/gbc.sdk/llvm.js';
import { analyze, type BasicSymbol } from './analyze.js';
import type { Node, NodeMap } from './index.js';
import { parseProgram } from './parser.js';

const long = { kind: 'type', family: 'int', size: 4, name: 'Int32' } as const satisfies ScalarType & { name: string };

interface CheckedSymbol {
	kind: 'variable' | 'parameter' | 'function';
	flags: Flags;
	name: string;
	type?: typeof long;
}

interface BasicAstContext extends AstContext {
	symbol: CheckedSymbol;
	variable: CheckedSymbol;
	function: CheckedSymbol;
}

type Nodes = AstNodeMap<BasicAstContext>;
type CheckedNode = Nodes[keyof Nodes];

export type BasicCheckedAst = Nodes['root'];
export type CompileResult =
	| { ast: BasicCheckedAst; ir: string; errors: [] }
	| { ast?: never; ir?: never; errors: CompilerError[] };

function position({ source, start, end, line }: Position): Position {
	return { source, start, end, line };
}

function fail(message: string, node: Node): never {
	throw new CompilerError(message, position(node));
}

function explicitLong(node: NodeMap['procedure' | 'parameter']): boolean {
	return node.annotation?.name.toLowerCase() === 'long' && node.resolved?.type?.name === 'long';
}

function resultAssignment(node: Node): NodeMap['assign' | '='] {
	if (node.kind === 'assign') return node;
	if (node.kind === 'let' && node.children.length === 1) {
		const item = node.children[0];
		const expr = item?.children[0];
		if (item?.separator === undefined && expr?.kind === '=') return expr;
	}
	return fail('BASIC LLVM requires an assignment to the function result', node);
}

function lowerValue(node: Node, parameters: ReadonlyMap<BasicSymbol, CheckedSymbol>): CheckedNode {
	if (node.kind === 'group')
		return { ...position(node), kind: '(', children: [lowerValue(node.children[0], parameters)] };
	if (node.kind === 'ident' && node.resolved) {
		const symbol = parameters.get(node.resolved);
		if (symbol) return { ...position(node), kind: 'ident', symbol };
	}
	const literal = node.kind === 'positive' || node.kind === 'negate' ? node.children[0] : node;
	if (literal.kind !== 'number' || !/^\d+&?$/.test(literal.text))
		return fail('BASIC LLVM supports only decimal integer literals and LONG parameters as results', node);
	const value = node.kind === 'negate' ? -literal.value : literal.value;
	if (value < -2147483648 || value > 2147483647)
		return fail('Integer literal is outside the BASIC LONG range', node);
	return { ...position(node), kind: 'number', value };
}

function lower(root: NodeMap['root']): BasicCheckedAst {
	const [procedure, extra] = root.children;
	if (extra) fail('BASIC LLVM supports exactly one function and no top-level statements', extra);
	if (procedure?.kind !== 'procedure' || procedure.procedureKind !== 'function' ||
		procedure.expression || !explicitLong(procedure) || !procedure.resolved)
		return fail('BASIC LLVM requires one FUNCTION with an explicit AS LONG result', procedure ?? root);
	const body = procedure.children[procedure.parameterCount];
	if (body?.kind !== 'block') return fail('BASIC LLVM requires a function body', procedure);
	const statements = body.children;
	const first = statements[0];
	if (statements.length !== 1 || !first)
		return fail('BASIC LLVM requires one assignment to the function result', statements[1] ?? body);
	const assignment = resultAssignment(first);
	const [destination, expression] = assignment.children;
	if (destination.kind !== 'ident' || destination.resolved?.role !== 'result' || destination.resolved.definition !== procedure)
		return fail('BASIC LLVM can assign only the function result', destination);

	const parameterSymbols = new Map<BasicSymbol, CheckedSymbol>();
	const parameters = procedure.children.slice(0, procedure.parameterCount).map((param): Nodes['parameter'] => {
		if (param.kind !== 'parameter' || !explicitLong(param) || param.array || !param.resolved)
			return fail('BASIC LLVM parameters must be scalar and explicitly AS LONG', param);
		const symbol: CheckedSymbol = { kind: 'parameter', flags: Flags.None, name: param.resolved.name, type: long };
		parameterSymbols.set(param.resolved, symbol);
		const label: Nodes['label'] = { ...position(param), kind: 'label' };
		return { ...position(param), kind: 'parameter', label, symbol, children: [label, undefined, undefined] };
	});
	const name = procedure.resolved.name;
	const owner: CheckedSymbol = { kind: 'function', flags: Flags.None, name };
	const result = syntheticNext(lowerValue(expression, parameterSymbols), owner);
	const fn: Nodes['fn'] = {
		...position(procedure), kind: 'fn', parameters, symbol: owner,
		children: [...parameters, result], statements: [result],
	};
	const label: Nodes['label'] = { ...position(procedure), kind: 'label' };
	const definition: Nodes['def'] = {
		...position(procedure), kind: 'def', label, value: fn,
		symbol: { kind: 'variable', flags: Flags.Export, name },
		children: [label, undefined, fn],
	};
	const facts: CheckedBody<CheckedNode> = {
		calls: new Map(), stages: new Map(), threads: new Map(), types: new Map(),
		numeric: new Map(), comparisons: new Map(), conversions: new Map(),
	};
	return {
		...position(root), kind: 'root', children: [definition],
		checked: {
			main: facts,
			entry: { globals: [], statements: [], exports: [{ name, node: definition, target: 0 }], debug: false, testMode: false },
			instances: [{
				signature: {
					node: fn, name, parameters: parameters.map(() => long),
					result: long, cardinality: 'one', mayEmitVoid: false,
				},
				body: facts,
			}],
		},
	};
}

export function compile(source: string): CompileResult {
	const parsed = parseProgram(source);
	if (parsed.errors.length) return { errors: parsed.errors };
	if (parsed.node?.kind !== 'root')
		return { errors: [new CompilerError('Expected a BASIC program', { source, start: 0, end: 0, line: 0 })] };
	const analysis = analyze(parsed.node);
	if (analysis.errors.length) return { errors: analysis.errors };
	try {
		const ast = lower(analysis.root);
		return { ast, ir: compileLlvm(ast), errors: [] };
	} catch (error) {
		if (!(error instanceof CompilerError)) throw error;
		return { errors: [error] };
	}
}
