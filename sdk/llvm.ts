import { CompilerError, Flags } from './index.js';
import type { AstContext, AstNode, AstNodeMap } from './ast.js';

interface CheckedType {
	readonly kind: string;
	readonly family?: string;
	readonly size?: number;
	readonly rest?: unknown;
	readonly elements?: readonly CheckedType[];
}

interface CheckedSymbol {
	readonly kind: string;
	readonly flags: Flags;
	readonly type?: CheckedType;
	readonly value?: unknown;
	readonly ownership?: string;
}

interface LlvmAstContext extends AstContext {
	symbol: CheckedSymbol;
	variable: CheckedSymbol;
	function: CheckedSymbol & {
		readonly returnType?: CheckedType;
		readonly emissionType?: CheckedType;
		readonly typeParams?: readonly unknown[];
	};
}

type Node = AstNode<LlvmAstContext>;
type Nodes = AstNodeMap<LlvmAstContext>;
type Integer = 'i32' | 'i64';
type Scalar = Integer | 'i1';
type Value = { type: Scalar; operand: string };
type Function = {
	name: string;
	result: Scalar | 'void';
	parameters: readonly (readonly [CheckedSymbol, Scalar])[];
	body: NonNullable<Nodes['fn']['statements']>;
};

function unsupported(node: Node): never {
	throw new CompilerError(`LLVM target does not support ${node.kind} here`, node);
}

function scalar(type: CheckedType | undefined, node: Node): Scalar {
	if (type?.kind === 'type') {
		if (type.family === 'bool') return 'i1';
		if (type.family === 'int' && type.size === 4) return 'i32';
		if (type.family === 'int' && type.size === 8) return 'i64';
	}
	return unsupported(node);
}

function operand(value: Value, type: Scalar, node: Node): string {
	if (value.type !== type)
		throw new CompilerError('LLVM target does not support this scalar conversion', node);
	return value.operand;
}

function integerLiteral(node: Nodes['number']): Value {
	const { value, float } = node;
	if (float || (typeof value === 'number' && !Number.isSafeInteger(value))) return unsupported(node);
	if (value >= -2147483648 && value <= 2147483647)
		return { type: 'i32', operand: String(value) };
	if (value >= -9223372036854775808n && value <= 9223372036854775807n)
		return { type: 'i64', operand: String(value) };
	return unsupported(node);
}

const integerOperations = {
	'+': 'add', '-': 'sub', '*': 'mul', '&': 'and', '|': 'or', '^': 'xor', '<:': 'shl', ':>': 'ashr',
} as const;
const comparisons = {
	'==': 'eq', '!=': 'ne', '<': 'slt', '>': 'sgt', '<=': 'sle', '>=': 'sge',
};

function checkedFunction(node: Nodes['fn'], name: string): Function {
	const { symbol, statements, parameters, typeParameters, objectBacked } = node;
	const emission = symbol.emissionType;
	if (!statements || objectBacked || typeParameters?.length || symbol.typeParams?.length ||
		(emission && (!emission.elements || emission.elements.length > 1 || emission.rest))) unsupported(node);
	const type = emission?.elements?.[0] ?? symbol.returnType;
	return {
		name,
		result: type?.family === 'void' || emission?.elements?.length === 0 ? 'void' : scalar(type, node),
		parameters: (parameters ?? []).map(parameter => {
			if (parameter.value || parameter.symbol.ownership === 'var') unsupported(parameter);
			return [parameter.symbol, scalar(parameter.symbol.type, parameter)];
		}),
		body: statements,
	};
}

export function compileLlvm(root: Nodes['root'], output?: CheckedSymbol): string {
	const functions = new Map<CheckedSymbol, Function>();
	const definitions: Function[] = [];
	let main: Nodes['main'] | undefined;
	const runtime = new Set<string>();

	for (const node of root.children) {
		if (node.kind === 'comment') continue;
		if (node.kind === 'main' && !main) {
			main = node;
			continue;
		}
		if (node.kind !== 'def' || node.value.kind !== 'fn') unsupported(node);
		const fn = checkedFunction(node.value, `fn${definitions.length}`);
		definitions.push(fn);
		functions.set(node.symbol, fn);
		functions.set(node.value.symbol, fn);
	}
	if (!main) throw new CompilerError('LLVM target requires a main block', root);

	function emitBody(fn: Function, isMain = false): string {
		const locals = new Map<CheckedSymbol, Value>();
		const args = fn.parameters.map(([symbol, type], index) => {
			const operand = `%arg${index}`;
			locals.set(symbol, { type, operand });
			return `${type} ${operand}`;
		});
		const lines = [`define ${isMain ? '' : 'internal '}${fn.result} @${fn.name}(${args.join(', ')}) {`, 'entry:'];
		let block = 'entry';
		let nextBlock = 0;
		let nextValue = 0;

		function instruction(text: string) {
			lines.push(`  ${text}`);
		}

		function register(text: string): string {
			const operand = `%v${nextValue++}`;
			instruction(`${operand} = ${text}`);
			return operand;
		}

		function value(type: Scalar, text: string): Value {
			return { type, operand: register(text) };
		}

		function coerce(input: Value, type: Scalar, node: Node): string {
			if (input.type === 'i32' && type === 'i64')
				return value('i64', `sext i32 ${input.operand} to i64`).operand;
			return operand(input, type, node);
		}

		function integer(input: Value, node: Node): Integer {
			if (input.type === 'i1') return unsupported(node);
			return input.type;
		}

		function integerType(lhs: Value, rhs: Value, node: Node): Integer {
			const left = integer(lhs, node);
			const right = integer(rhs, node);
			return left === 'i64' ? left : right;
		}

		function binary(node: Nodes[keyof typeof integerOperations]): Value {
			const [left, right] = node.children;
			const lhs = expr(left);
			const rhs = expr(right);
			const type = integerType(lhs, rhs, node);
			const first = coerce(lhs, type, left);
			let second = coerce(rhs, type, right);
			const opcode = integerOperations[node.kind];
			if (opcode === 'shl' || opcode === 'ashr')
				second = value(type, `and ${type} ${second}, ${type === 'i32' ? 31 : 63}`).operand;
			return value(type, `${opcode} ${type} ${first}, ${second}`);
		}

		function compare(node: Nodes[keyof typeof comparisons]): Value {
			const [left, right] = node.children;
			const lhs = expr(left);
			const rhs = expr(right);
			const opcode = comparisons[node.kind];
			const type = lhs.type === 'i1' && (opcode === 'eq' || opcode === 'ne')
				? 'i1' : integerType(lhs, rhs, node);
			return value('i1', `icmp ${opcode} ${type} ${coerce(lhs, type, left)}, ${coerce(rhs, type, right)}`);
		}

		function label(name: string) {
			block = name;
			lines.push(`${name}:`);
		}

		function branch(condition: Node, yes: () => Value, no: () => Value, node: Node): Value {
			const test = operand(expr(condition), 'i1', condition);
			const id = nextBlock++;
			const onTrue = `then${id}`, onFalse = `else${id}`, join = `join${id}`;
			instruction(`br i1 ${test}, label %${onTrue}, label %${onFalse}`);
			label(onTrue);
			const lhs = yes();
			const leftBlock = block;
			instruction(`br label %${join}`);
			label(onFalse);
			const rhs = operand(no(), lhs.type, node);
			const rightBlock = block;
			instruction(`br label %${join}`);
			label(join);
			return value(lhs.type, `phi ${lhs.type} [ ${lhs.operand}, %${leftBlock} ], [ ${rhs}, %${rightBlock} ]`);
		}

		function call(callee: Node, args: readonly Value[], node: Node): Value | undefined {
			const target = callee.kind === 'ident' && functions.get(callee.symbol);
			if (!target || args.length !== target.parameters.length) return unsupported(node);
			const values = args.map((argument, index) => {
				const parameter = target.parameters[index];
				if (!parameter) return unsupported(node);
				const [, type] = parameter;
				return `${type} ${coerce(argument, type, node)}`;
			});
			const invocation = `call ${target.result} @${target.name}(${values.join(', ')})`;
			if (target.result !== 'void') return value(target.result, invocation);
			instruction(invocation);
		}

		function directCall(node: Nodes['call']): Value | undefined {
			const [callee, arg] = node.children;
			const args = arg?.kind === ',' ? arg.children : arg ? [arg] : [];
			return call(callee, args.map(expr), node);
		}

		function print(input: Value): void {
			const { type, operand } = input;
			runtime.add('declare i32 @printf(ptr, ...)');
			if (type === 'i1') {
				runtime.add('@.true = private unnamed_addr constant [5 x i8] c"true\\00"');
				runtime.add('@.false = private unnamed_addr constant [6 x i8] c"false\\00"');
				const format = register(`select i1 ${operand}, ptr @.true, ptr @.false`);
				instruction(`call i32 (ptr, ...) @printf(ptr ${format})`);
				return;
			}
			const format = type === 'i32' ? '%d' : '%lld';
			runtime.add(`@.format.${type} = private unnamed_addr constant [${format.length + 1} x i8] c"${format}\\00"`);
			instruction(`call i32 (ptr, ...) @printf(ptr @.format.${type}, ${type} ${operand})`);
		}

		function pipe(node: Nodes['>>']): Value | undefined {
			const [input, ...stages] = node.children;
			if (!input || !stages.length) return unsupported(node);
			let carrier: Value | undefined = expr(input);
			for (const stage of stages) {
				if (!carrier) return unsupported(stage);
				if (stage.kind === 'ident' && stage.symbol === output) {
					print(carrier);
					carrier = undefined;
				} else carrier = call(stage, [carrier], stage);
			}
			return carrier;
		}

		function expr(node: Node): Value {
			switch (node.kind) {
				case 'number':
					return integerLiteral(node);
				case 'ident': {
					const local = locals.get(node.symbol);
					if (local) return local;
					if (node.symbol.kind === 'literal' && typeof node.symbol.value === 'boolean')
						return { type: 'i1', operand: String(node.symbol.value) };
					return unsupported(node);
				}
				case '(':
					return expr(node.children[0]);
				case 'negate':
				case '~': {
					const [child] = node.children;
					const input = expr(child);
					const type = integer(input, child);
					if (node.kind === 'negate' && type === 'i64') return unsupported(node);
					return value(type, node.kind === 'negate'
						? `sub ${type} 0, ${input.operand}` : `xor ${type} ${input.operand}, -1`);
				}
				case '!': {
					const [child] = node.children;
					return value('i1', `xor i1 ${operand(expr(child), 'i1', child)}, true`);
				}
				case '+': case '-': case '*': case '&': case '|': case '^': case '<:': case ':>':
					return binary(node);
				case '==': case '!=': case '<': case '>': case '<=': case '>=':
					return compare(node);
				case '&&':
				case '||': {
					const [left, right] = node.children;
					const evaluate = (): Value => ({ type: 'i1', operand: operand(expr(right), 'i1', right) });
					const onTrue = (): Value => ({ type: 'i1', operand: 'true' });
					const onFalse = (): Value => ({ type: 'i1', operand: 'false' });
					return node.kind === '&&'
						? branch(left, evaluate, onFalse, node)
						: branch(left, onTrue, evaluate, node);
				}
				case '?': {
					const [condition, yes, no] = node.children;
					if (!no) return unsupported(node);
					return branch(condition, () => expr(yes), () => expr(no), node);
				}
				case 'call':
					return directCall(node) ?? unsupported(node);
				case '>>':
					return pipe(node) ?? unsupported(node);
				default:
					return unsupported(node);
			}
		}

		function emitStatement(node: Node): void {
			switch (node.kind) {
				case 'def': {
					if (node.symbol.flags & Flags.Variable) return unsupported(node);
					const type = scalar(node.symbol.type, node);
					locals.set(node.symbol, { type, operand: coerce(expr(node.value), type, node) });
					return;
				}
				case 'call':
					if (directCall(node)) unsupported(node);
					return;
				case '>>':
					if (pipe(node)) unsupported(node);
					return;
				default:
					return unsupported(node);
			}
		}

		const body = fn.body.filter(node => node.kind !== 'comment');
		const tail = body.at(-1);
		if (tail?.kind === 'next' && !isMain) body.pop();
		for (const statement of body) emitStatement(statement);
		if (isMain) instruction('ret i32 0');
		else if (fn.result === 'void') {
			if (tail?.kind === 'next' && tail.children?.[0])
				emitStatement(tail.children[0]);
			instruction('ret void');
		} else {
			const result = tail?.kind === 'next' && tail.children?.[0];
			if (!result) return unsupported(tail ?? root);
			instruction(`ret ${fn.result} ${coerce(expr(result), fn.result, result)}`);
		}
		lines.push('}');
		return lines.join('\n');
	}

	const bodies = definitions.map(fn => emitBody(fn));
	bodies.push(emitBody({ name: 'main', result: 'i32', parameters: [], body: main.statements }, true));
	return [...runtime, ...bodies, ''].join('\n');
}
