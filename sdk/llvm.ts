import { allocator, dropBuffer, printString, references as referenceRuntime } from './llvm-heap.js';
import { CompilerError, Flags, text } from './index.js';
import {
	astDispatchArms,
	type AstContext,
	type AstNode,
	type AstNodeMap,
	type CheckedAstType,
	type CheckedBody,
	type CheckedCall,
	type CheckedProgram,
	type NumericConversionRange,
	type NumericOperationFacts,
} from './ast.js';

declare class TextEncoder {
	encode(input: string): Uint8Array;
}

interface CheckedSymbol {
	readonly kind: string;
	readonly name?: string;
	readonly flags: Flags;
	readonly type?: CheckedAstType;
	readonly value?: unknown;
	readonly ownership?: string;
}

interface LlvmAstContext extends AstContext {
	symbol: CheckedSymbol;
	variable: CheckedSymbol;
	function: CheckedSymbol & {
		readonly returnType?: CheckedAstType;
		readonly emissionType?: CheckedAstType;
		readonly typeParams?: readonly unknown[];
	};
}

type CheckedNode = AstNode<LlvmAstContext>;
type Integer = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64';
type Float = 'float' | 'double';
type Scalar = Integer | Float | 'i1' | 'ptr';
const float32x4 = '<4 x float>';
type Representation = Scalar | typeof float32x4 | 'i128';
type Variant = { type: Representation; character?: true; heap?: CheckedAstType };
type Shape = Variant & { errors?: readonly number[]; variants?: readonly Variant[] };
type Value = Shape & { operand: string; tag?: string };
type Function<Context extends LlvmAstContext> = {
	name: string;
	result: Shape | 'void';
	parameters: readonly (readonly [CheckedSymbol | undefined, Shape | undefined])[];
	body: readonly AstNode<Context>[];
	facts?: CheckedBody<AstNode<Context>>;
	ownedParameters?: readonly boolean[];
	stream?: 'many' | 'optional';
	input?: true;
};

const arithmetic = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'rem' } as const;
const bitwise = { '&': 'and', '|': 'or', '^': 'xor', '<:': 'shl', ':>': 'ashr' } as const;
const comparisons = { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' } as const;
const divByZero = 1, numericOverflow = 2, outOfMemory = 3;
const numericErrorTags = new Map([
	['DivByZero', divByZero], ['NumericOverflow', numericOverflow], ['OutOfMemory', outOfMemory],
]);
const scalarVariants: readonly Representation[] = ['i1', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'float', 'double'];

function variantKey(variant: Variant): string {
	if (variant.character) return 'char';
	if (variant.type !== 'ptr') return variant.type;
	return heapKey(variant.heap);
}

function heapKey(type: CheckedAstType | undefined): string {
	switch (type?.family) {
		case 'buffer': return `buffer:${type.name}<${heapKey(type.elem)}>`;
		case 'data': return `data:${type.name}`;
		case 'literal': case 'string': case undefined: return 'string';
		default: return `${type?.family}:${type?.name}`;
	}
}

function hasHeap(shape: Shape): boolean {
	return shape.type === 'ptr' || (shape.variants?.some(variant => variant.type === 'ptr') ?? false);
}

const floatIntrinsics = new Map([
	['sqrt', 'sqrt'], ['abs', 'fabs'], ['floor', 'floor'], ['ceil', 'ceil'], ['trunc', 'trunc'],
	['nearest', 'nearbyint'], ['copysign', 'copysign'],
]);

function unsupported(node: CheckedNode): never {
	throw new CompilerError(`LLVM target does not support ${node.kind} here`, node);
}

function scalar(type: CheckedAstType | undefined): Scalar | undefined {
	if (type?.kind !== 'type') return undefined;
	const { family, size } = type;
	if (family === 'bool') return 'i1';
	if (family === 'char') return 'u32';
	if (family === 'data') return recordScalar(type.name);
	if (family === 'string' || family === 'buffer' || (family === 'literal' && typeof type.value === 'string')) return 'ptr';
	if (family === 'float') return size === 4 ? 'float' : size === 8 ? 'double' : undefined;
	if (family === 'int' || family === 'uint') {
		const unsigned = family === 'uint';
		switch (size) {
			case 1: return unsigned ? 'u8' : 'i8';
			case 2: return unsigned ? 'u16' : 'i16';
			case 4: return unsigned ? 'u32' : 'i32';
			case 8: return unsigned ? 'u64' : 'i64';
			case undefined: return undefined;
		}
	}
}

function recordScalar(name?: string): 'ptr' | undefined {
	if (name !== 'Error' && !numericErrorTags.has(name ?? '')) return 'ptr';
}

function plainVariant(type: CheckedAstType | undefined): Variant | undefined {
	const plain = type?.family === 'vector' && type.elem?.family === 'float' && type.elem.size === 4
		? float32x4 : scalar(type);
	if (plain) return { type: plain, character: type?.family === 'char' ? true : undefined, heap: plain === 'ptr' ? type : undefined };
}

function abiShape(type: CheckedAstType | undefined): Shape | undefined {
	const plain = plainVariant(type);
	if (plain) return plain;
	if (type?.family !== 'union' || !Array.isArray(type.members)) return;
	const members: readonly CheckedAstType[] = type.members;
	const variants = new Map<string, Variant>();
	const errors: number[] = [];
	for (const member of members) {
		if (member.family === 'void') continue;
		const value = plainVariant(member);
		const error = numericErrorTags.get(member.name ?? '');
		if (value) variants.set(variantKey(value), value);
		else if (error !== undefined) errors.push(error);
		else return;
	}
	if (variants.size > 1) return {
		type: variants.has(float32x4) ? 'i128' : 'u64', variants: [...variants.values()], errors,
	};
	const [value] = variants.values();
	if (value) return { ...value, errors: errors.length ? errors : undefined };
}

function shape(type: CheckedAstType | undefined, node: CheckedNode): Shape {
	return abiShape(type) ?? unsupported(node);
}

function isFloat(type: Representation): type is Float {
	return type === 'float' || type === 'double';
}

function numericIntrinsic(type: Scalar, operation: string): string | undefined {
	if (isFloat(type)) return floatIntrinsics.get(operation);
	if (operation === 'min' || operation === 'max')
		return `${isUnsigned(type) ? 'u' : 's'}${operation}`;
}

function isUnsigned(type: Representation): boolean {
	return type.startsWith('u');
}

function irType(type: Representation) {
	if (type === 'i1' || type === 'ptr' || type === float32x4 || type === 'i128' || isFloat(type)) return type;
	return type === 'i64' || type === 'u64' ? 'i64' : 'i32';
}

function variantBits(type: Exclude<ReturnType<typeof irType>, 'ptr'>) {
	return type === 'float' ? 'i32' : type === 'double' ? 'i64' : type === float32x4 ? 'i128' : type;
}

function abiType(shape: Shape): string {
	const type = irType(shape.type);
	return shape.errors || shape.variants ? `{ ${type}, i8 }` : type;
}

type RecordFields = Readonly<Record<string, { readonly type?: CheckedAstType }>>;

function isRecordFields(members: CheckedAstType['members']): members is RecordFields {
	return members !== undefined && !Array.isArray(members);
}

function recordFields(type: CheckedAstType | undefined): RecordFields {
	return type?.family === 'data' && isRecordFields(type.members) ? type.members : {};
}

function memoryType(shape: Shape): string {
	if (shape.errors || shape.variants) return abiType(shape);
	const { type } = shape;
	if (type === 'i8' || type === 'u8') return 'i8';
	if (type === 'i16' || type === 'u16') return 'i16';
	return irType(type);
}

function memberAlignment(type: Shape): string {
	return type.type === float32x4 || type.type === 'i128' ? ', align 8' : '';
}

function sizeOf(type: string): string {
	return `ptrtoint (ptr getelementptr (${type}, ptr null, i32 1) to i64)`;
}

function floatConstant(number: number): string {
	const bytes = new DataView(new ArrayBuffer(8));
	bytes.setFloat64(0, number);
	return `0x${bytes.getBigUint64(0).toString(16).padStart(16, '0').toUpperCase()}`;
}

function numberLiteral(node: AstNodeMap<LlvmAstContext>['number']): Value {
	const { value, float } = node;
	if (float) return { type: 'double', operand: floatConstant(Number(value)) };
	if (typeof value === 'number' && !Number.isSafeInteger(value)) return unsupported(node);
	if (value >= -2147483648 && value <= 2147483647)
		return { type: 'i32', operand: String(value) };
	if (value >= -9223372036854775808n && value <= 9223372036854775807n)
		return { type: 'i64', operand: String(value) };
	if (value >= 0 && value <= 18446744073709551615n)
		return { type: 'u64', operand: String(value) };
	return unsupported(node);
}

function legacyFunctionResult(node: AstNodeMap<LlvmAstContext>['fn']): Shape | 'void' {
	const { symbol, typeParameters } = node;
	const emission = symbol.emissionType;
	if (typeParameters?.length || symbol.typeParams?.length ||
		(emission && (!emission.elements || emission.elements.length > 1 || emission.rest)))
		return unsupported(node);
	const type = emission?.elements?.[0] ?? symbol.returnType;
	return type?.family === 'void' || emission?.elements?.length === 0 ? 'void' : shape(type, node);
}

function checkedFunction<Context extends LlvmAstContext>(
	node: AstNodeMap<Context>['fn'],
	name: string,
	instance?: CheckedProgram<Context>['instances'][number],
): Function<Context> {
	const { statements, parameters, objectBacked } = node;
	const signature = instance?.signature;
	if (!statements || objectBacked) return unsupported(node);
	const stream = signature?.cardinality === 'many' ? 'many'
		: signature?.cardinality === 'one' && signature.mayEmitVoid ? 'optional' : undefined;
	const result = signature
		? signature.cardinality === 'zero' || stream === 'many' ? 'void' : shape(signature.result, node)
		: legacyFunctionResult(node);
	return {
		name,
		result,
		parameters: signature?.input ? [[undefined, shape(signature.input, node)]] : (parameters ?? []).map((parameter, index) => {
			if (!signature && (parameter.symbol.ownership === 'var' || parameter.value)) return unsupported(parameter);
			const type = signature?.parameters[index] ?? parameter.symbol.type;
			return [parameter.symbol, signature && type?.kind === 'function' ? undefined : shape(type, parameter)];
		}),
		body: statements,
		facts: instance?.body,
		ownedParameters: signature?.ownedParameters,
		stream,
		input: signature?.input ? true : undefined,
	};
}

export function compileLlvm<Context extends LlvmAstContext>(
	root: Readonly<AstNodeMap<Context>['root']>,
	output?: CheckedSymbol,
): string {
	type Node = AstNode<Context>;
	type Nodes = AstNodeMap<Context>;
	const functions = new Map<CheckedSymbol, Function<Context>>();
	const definitions: Function<Context>[] = [];
	let main: Nodes['main'] | undefined;
	const runtime = new Set<string>();
	const streamEffects = new Set<Function<Context>>();
	let strings: Map<string, string> | undefined;
	let drops: Map<string, string> | undefined;
	let encoder: TextEncoder | undefined;
	let variantTags: Map<string, number> | undefined;

	function variantTag(variant: Variant, node: Node): number {
		const index = !variant.character && variant.type !== 'ptr' ? scalarVariants.indexOf(variant.type) : -1;
		if (index !== -1) return index + 16;
		const key = variantKey(variant);
		const tags = variantTags ??= new Map<string, number>();
		const known = tags.get(key);
		if (known !== undefined) return known;
		const tag = 16 + scalarVariants.length + tags.size;
		if (tag > 255) return unsupported(node);
		tags.set(key, tag);
		return tag;
	}
	const standardOutput = root.checked?.output ?? output;

	const prepared = root.checked?.instances.map((instance, index) =>
		checkedFunction<Context>(instance.signature.node, `fn${index}`, instance));

	for (const node of root.children) {
		if (node.kind === 'comment') continue;
		if (node.kind === 'main' && !main) {
			main = node;
			continue;
		}
		if (prepared && (node.kind === 'type' || node.kind === 'extend' || node.kind === 'import' ||
			(node.kind === 'def' && (node.value.kind === 'fn' || astDispatchArms<Context>(node.value)))))
			continue;
		if (node.kind !== 'def' || node.value.kind !== 'fn') unsupported(node);
		const fn = checkedFunction<Context>(node.value, `fn${definitions.length}`);
		definitions.push(fn);
		functions.set(node.symbol, fn);
		functions.set(node.value.symbol, fn);
	}

	if (!main) throw new CompilerError('LLVM target requires a main block', root);

	function emitBody(fn: Function<Context>, isMain = false): string {
		let locals = new Map<CheckedSymbol, Value>();
		let facts = fn.facts;
		const activeStreams = new Set<Function<Context>>();
		const args = fn.parameters.flatMap(([, type], index) => type ? [`${abiType(type)} %arg${index}`] : []);
		const resultType = fn.result === 'void' ? 'void' : abiType(fn.result);
		const allocations: string[] = [];
		const lines = [`define ${isMain ? '' : 'internal '}${resultType} @${fn.name}(${args.join(', ')}) {`, 'entry:'];
		let block = 'entry';
		let nextBlock = 0;
		let nextValue = 0;
		let dollar: Value | undefined;
		type Scope = { parent?: Scope; slots?: string[]; bindings?: Map<object, string> };
		type Exit = { label: string; scope: Scope };
		let scope: Scope = {};
		let breakLabel: Exit | undefined;
		let completion: { label?: string; scope: Scope } | undefined;
		fn.parameters.forEach(([symbol, type], index) => {
			if (!type) return;
			const argument = unpack(type, `%arg${index}`);
			if (symbol) locals.set(symbol, argument);
			if (fn.ownedParameters?.[index]) track(argument, scope);
			if (fn.input && index === 0) dollar = argument;
		});
		function instruction(text: string) {
			lines.push(`  ${text}`);
		}

		function register(text: string): string {
			const operand = `%v${nextValue++}`;
			instruction(`${operand} = ${text}`);
			return operand;
		}

		function storage(type: string): string {
			const pointer = `%v${nextValue++}`;
			allocations.push(`  ${pointer} = alloca ${type}`);
			return pointer;
		}

		function heapTags(type: Shape, node: Node): number[] {
			return type.variants?.filter(variant => variant.type === 'ptr').map(variant => variantTag(variant, node)) ?? [];
		}

		function heapPointer(input: Value): string | undefined {
			if (input.type === 'ptr') return input.tag === undefined ? input.operand
				: register(`select i1 ${register(`icmp eq i8 ${input.tag}, 0`)}, ptr ${input.operand}, ptr null`);
			const tags = heapTags(input, root);
			if (tags.length) {
				const pointer = register(`inttoptr ${irType(input.type)} ${input.operand} to ptr`);
				const test = tags.map(tag => register(`icmp eq i8 ${input.tag}, ${tag}`))
					.reduce((left, right) => register(`or i1 ${left}, ${right}`), 'false');
				return register(`select i1 ${test}, ptr ${pointer}, ptr null`);
			}
		}

		function retain(input: Value): void {
			const pointer = heapPointer(input);
			if (pointer !== undefined) {
				runtime.add(referenceRuntime);
				instruction(`call void @gb.retain(ptr ${pointer})`);
			}
		}

		function referenceSlot(owner = scope): string {
			runtime.add(referenceRuntime);
			const slot = storage('ptr');
			allocations.push(`  store ptr null, ptr ${slot}`);
			(owner.slots ??= []).push(slot);
			return slot;
		}

		function replaceReference(slot: string, input: Value): void {
			const pointer = heapPointer(input) ?? 'null';
			instruction(`call void @gb.retain(ptr ${pointer})`);
			release(slot);
			instruction(`store ptr ${pointer}, ptr ${slot}`);
		}

		function track<T extends Value>(input: T, owner = scope, binding?: object): T {
			const pointer = heapPointer(input);
			if (pointer === undefined) return input;
			const slot = referenceSlot(owner);
			instruction(`store ptr ${pointer}, ptr ${slot}`);
			if (binding) (owner.bindings ??= new Map<object, string>()).set(binding, slot);
			return input;
		}

		function release(slot: string): void {
			instruction(`call void @gb.release(ptr ${register(`load ptr, ptr ${slot}`)})`);
			instruction(`store ptr null, ptr ${slot}`);
		}

		function cleanup(stop?: Scope): void {
			for (let owner: Scope | undefined = scope; owner && owner !== stop; owner = owner.parent)
				if (owner.slots) for (const slot of owner.slots) release(slot);
		}

		function scoped<T>(run: () => T): T {
			const outer = scope;
			scope = { parent: outer };
			try {
				const result = run();
				cleanup(outer);
				return result;
			} finally {
				scope = outer;
			}
		}

		function statementScope(statement: Node, run: () => void): void {
			scoped(run);
			for (const binding of facts?.lastUses?.get(statement) ?? []) {
				const slot = scope.bindings?.get(binding);
				if (slot) release(slot);
			}
		}

		function value(type: Representation, text: string): Value {
			return { type, operand: register(text) };
		}

		function operand(input: Value, type: Representation, node: Node): string {
			if (input.type !== type || input.tag !== undefined) return unsupported(node);
			return input.operand;
		}

		function cast(input: Value, type: Representation, opcode: string): string {
			return register(`${opcode} ${irType(input.type)} ${input.operand} to ${irType(type)}`);
		}

		function coerce(input: Value, type: Representation, node: Node, explicit = false): string {
			const from = irType(input.type);
			const to = irType(type);
			if (from === to) return input.operand;
			if (from === 'ptr' || to === 'ptr' || from === float32x4 || to === float32x4 ||
			from === 'i128' || to === 'i128') return unsupported(node);
			if (from === 'i32' && to === 'i64')
				return cast(input, type, (explicit ? isUnsigned(type) : isUnsigned(input.type)) ? 'zext' : 'sext');
			if (isFloat(type)) {
				if (isFloat(input.type)) return cast(input, type, to === 'double' ? 'fpext' : 'fptrunc');
				if (from !== 'i1') return cast(input, type, from === 'i64' && isUnsigned(input.type) ? 'uitofp' : 'sitofp');
			}
			if (explicit && to === 'i32' && from === 'i64') return cast(input, type, 'trunc');
			throw new CompilerError('LLVM target does not support this scalar conversion', node);
		}

		function encodeVariant(input: Value, width: 'i64' | 'i128'): string {
			const ir = irType(input.type);
			if (ir === 'ptr') return register(`ptrtoint ptr ${input.operand} to ${width}`);
			const bits = variantBits(ir);
			const encoded = bits === ir ? input.operand : register(`bitcast ${ir} ${input.operand} to ${bits}`);
			return resizePayload(encoded, bits, width);
		}

		function resizePayload(input: string, from: string, to: string): string {
			if (from === to) return input;
			const op = from === 'i128' || (from === 'i64' && to !== 'i128') ? 'trunc' : 'zext';
			return register(`${op} ${from} ${input} to ${to}`);
		}

		function decodeVariant(input: Value, variant: Variant): Value {
			const ir = irType(variant.type);
			const from = irType(input.type);
			if (ir === 'ptr') return { ...variant, operand: register(`inttoptr ${from} ${input.operand} to ptr`) };
			const width = variantBits(ir);
			const bits = resizePayload(input.operand, from, width);
			return { ...variant, operand: width === ir ? bits : register(`bitcast ${width} ${bits} to ${ir}`) };
		}

		function normalizeShape(input: Value, target: Shape, node: Node): Value {
			if (input.heap?.family !== 'data') return input;
			if (target.heap?.family === 'data') return normalizeRecord(input, target.heap, node);
			if (!target.variants || target.variants.some(variant => variantKey(variant) === variantKey(input))) return input;
			const records = target.variants.filter(variant => variant.heap?.family === 'data');
			const candidate = records.length === 1 ? records[0]?.heap : undefined;
			return candidate ? normalizeRecord(input, candidate, node) : input;
		}

		function pack(input: Value, target: Shape, node: Node, owned = false): string {
			input = normalizeShape(input, target, node);
			if (owned && hasHeap(target)) retain(input);
			if (input.variants && !target.variants) return unsupported(node);
			if (!target.errors && !target.variants && input.tag !== undefined) return unsupported(node);
			let payload = input.operand;
			let tag = input.tag ?? '0';
			if (!target.variants) payload = coerce(input, target.type, node);
			else if (!input.variants) {
				const chosen = target.variants.find(variant => variantKey(variant) === variantKey(input));
				if (!chosen) return unsupported(node);
				payload = encodeVariant(input, target.type === 'i128' ? 'i128' : 'i64');
				const scalarTag = variantTag(chosen, node);
				tag = input.tag === undefined ? String(scalarTag)
					: register(`select i1 ${register(`icmp eq i8 ${tag}, 0`)}, i8 ${scalarTag}, i8 ${tag}`);
			} else payload = resizePayload(payload, irType(input.type), irType(target.type));
			if (!target.errors && !target.variants) return payload;
			const type = abiType(target);
			const packed = register(`insertvalue ${type} poison, ${irType(target.type)} ${payload}, 0`);
			return register(`insertvalue ${type} ${packed}, i8 ${tag}, 1`);
		}

		function unpack(target: Shape, input: string): Value {
			if (!target.errors && !target.variants) return { ...target, operand: input };
			const abi = abiType(target);
			return { ...target, operand: register(`extractvalue ${abi} ${input}, 0`), tag: register(`extractvalue ${abi} ${input}, 1`) };
		}

		function integer(input: Value, node: Node): Integer {
			if (input.type === 'i1' || input.type === 'ptr' || input.type === float32x4 || input.type === 'i128' ||
				isFloat(input.type) || input.tag !== undefined) return unsupported(node);
			return input.type;
		}

		function integerType(lhs: Value, rhs: Value, node: Node): 'i32' | 'i64' {
			const left = irType(integer(lhs, node));
			const right = irType(integer(rhs, node));
			return left === 'i64' || right === 'i64' ? 'i64' : 'i32';
		}

		function arithmeticValue(node: Nodes[keyof typeof arithmetic]): Value {
			const [left, right] = node.children;
			const lhs = expr(left), rhs = expr(right);
			if (lhs.tag !== undefined || rhs.tag !== undefined) return unsupported(node);
			const opcode = arithmetic[node.kind];
			if (lhs.type === float32x4 && rhs.type === float32x4) {
				const vectorOpcode = node.kind === '%' ? 'div' : opcode;
				return value(float32x4, `f${vectorOpcode} ${float32x4} ${lhs.operand}, ${rhs.operand}`);
			}
			const division = node.kind === '/' || node.kind === '%';
			const numeric = facts?.numeric.get(node) ?? node.numeric;
			const type = scalar(numeric?.valueType) ?? integerType(lhs, rhs, node);
			const ir = irType(type);
			const first = coerce(lhs, type, left), second = coerce(rhs, type, right);
			if (isFloat(type)) return value(type, `f${opcode} ${ir} ${first}, ${second}`);
			if (!division)
				return value(type, `${opcode} ${ir} ${first}, ${second}`);
			if (!numeric || type === 'i1' || type === 'ptr') return unsupported(node);
			return divide(node.kind, type, first, second, numeric);
		}

		function divide(
			operation: '/' | '%',
			type: Integer,
			first: string,
			second: string,
			numeric: NumericOperationFacts<CheckedAstType>,
		): Value {
			const ir = irType(type);
			const zero = register(`icmp eq ${ir} ${second}, 0`);
			if (!numeric.zeroError) trapIf(zero);
			const checkedZero = numeric.zeroError && zero;
			let overflow: string | undefined;
			const signed = !numeric.unsigned;
			if (numeric.overflowError || (signed && operation === '/')) {
				const minimum = register(`icmp eq ${ir} ${first}, ${numeric.signedMinimum}`);
				const negativeOne = register(`icmp eq ${ir} ${second}, -1`);
				const belowMinimum = register(`and i1 ${minimum}, ${negativeOne}`);
				if (numeric.overflowError) overflow = belowMinimum;
				else trapIf(belowMinimum);
			}
			const error = checkedZero && overflow ? register(`or i1 ${checkedZero}, ${overflow}`) : checkedZero ?? overflow;
			let divisor = error ? register(`select i1 ${error}, ${ir} 1, ${ir} ${second}`) : second;
			if (signed && operation === '%') {
				const negativeOne = register(`icmp eq ${ir} ${divisor}, -1`);
				divisor = register(`select i1 ${negativeOne}, ${ir} 1, ${ir} ${divisor}`);
			}
			const result = value(type, `${signed ? 's' : 'u'}${arithmetic[operation]} ${ir} ${first}, ${divisor}`);
			if (error) result.errors = numeric.errors.flatMap(type => numericErrorTags.get(type.name ?? '') ?? []);
			if (overflow) result.tag = register(`select i1 ${overflow}, i8 ${numericOverflow}, i8 0`);
			if (checkedZero) result.tag = register(`select i1 ${checkedZero}, i8 ${divByZero}, i8 ${result.tag ?? 0}`);
			return result;
		}

		function bitwiseValue(node: Nodes[keyof typeof bitwise]): Value {
			const [left, right] = node.children;
			const lhs = expr(left), rhs = expr(right);
			const type = integerType(lhs, rhs, node);
			const first = coerce(lhs, type, left);
			let second = coerce(rhs, type, right);
			const opcode = bitwise[node.kind];
			if (opcode === 'shl' || opcode === 'ashr')
				second = register(`and ${type} ${second}, ${type === 'i32' ? 31 : 63}`);
			return value(type, `${opcode} ${type} ${first}, ${second}`);
		}

		function payload(pointer: string): string {
			return register(`getelementptr %gb.heap, ptr ${pointer}, i32 1`);
		}

		function header(pointer: string, capacity = false): string {
			return register(`getelementptr %gb.heap, ptr ${pointer}, i32 0, i32 ${capacity ? 3 : 2}`);
		}

		function length(input: Value, capacity = false): string {
			const pointer = input.operand;
			const [read, nonnull, , empty] = branches<string | void>(register(`icmp ne ptr ${pointer}, null`),
				() => register(`load i32, ptr ${header(pointer, capacity)}`), () => {});
			return register(`phi i32 [ ${read}, %${nonnull} ], [ 0, %${empty} ]`);
		}

		function allocate(type: CheckedAstType | undefined, bytes: string | number, len: string | number, cap: string | number, drop = 'null'): Value {
			runtime.add(referenceRuntime);
			runtime.add(allocator);
			runtime.add('declare void @llvm.trap()');
			runtime.add('declare i32 @fflush(ptr)');
			return track({ heap: type, type: 'ptr', operand: register(
				`call ptr @gb.allocate(i64 ${bytes}, i32 ${len}, i32 ${cap}, ptr ${drop})`,
			) });
		}

		function constantString(text: string): Value {
			const literals = strings ??= new Map<string, string>();
			let name = literals.get(text);
			if (!name) {
				name = `@.string.${literals.size}`;
				literals.set(text, name);
				const bytes = (encoder ??= new TextEncoder()).encode(text);
				const data = Array.from(bytes, byte => `\\${byte.toString(16).padStart(2, '0')}`).join('');
				runtime.add(`${name} = private unnamed_addr constant { %gb.heap, [${bytes.length} x i8] } { %gb.heap { i64 -1, ptr null, i32 ${bytes.length}, i32 1 }, [${bytes.length} x i8] c"${data}" }`);
				runtime.add(referenceRuntime);
			}
			return { type: 'ptr', operand: name };
		}

		function copyBytes(target: string, source: string, count: string): void {
			runtime.add('declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)');
			instruction(`call void @llvm.memcpy.p0.p0.i64(ptr ${target}, ptr ${source}, i64 ${count}, i1 false)`);
		}

		function formatFloat(input: Value, output: string, node: Node): string {
			runtime.add(floatOutput);
			return register(`call i32 @gb.format.float(double ${coerce(input, 'double', node)}, ptr ${output})`);
		}

		function asString(input: Value, node: Node, type?: CheckedAstType): Value {
			if (input.tag !== undefined) return unsupported(node);
			if (input.type === 'ptr') {
				if (input.heap?.family === 'buffer' || input.heap?.family === 'data') return unsupported(node);
				return input;
			}
			if (input.type === 'i1') {
				const yes = constantString('true');
				const no = constantString('false');
				return value('ptr', `select i1 ${input.operand}, ptr ${yes.operand}, ptr ${no.operand}`);
			}
			if (type?.family === 'char') return characterString(input);
			if (!isFloat(input.type)) return unsupported(node);
			const result = allocate(undefined, 32, 0, 1);
			const count = formatFloat(input, payload(result.operand), node);
			instruction(`store i32 ${count}, ptr ${header(result.operand)}`);
			return result;
		}

		function characterString(input: Value): Value {
			const bits = input.operand;
			const result = allocate(undefined, 4, 0, 1);
			const data = payload(result.operand);
			const bound = [0, 0x80, 0x800, 0x10000];
			function write(index: number, shift: number, prefix: number): void {
				const shifted = shift ? register(`lshr i32 ${bits}, ${shift}`) : bits;
				const chunk = index ? register(`and i32 ${shifted}, 63`) : shifted;
				const extended = prefix ? register(`or i32 ${chunk}, ${prefix}`) : chunk;
				const byte = register(`trunc i32 ${extended} to i8`);
				instruction(`store i8 ${byte}, ptr ${register(`getelementptr i8, ptr ${data}, i32 ${index}`)}`);
			}
			function encode(bytes: number): void {
				const prefix = [0, 0, 0xc0, 0xe0, 0xf0][bytes] ?? 0;
				for (let index = 0; index < bytes; index++)
					write(index, (bytes - index - 1) * 6, index ? 0x80 : prefix);
				instruction(`store i32 ${bytes}, ptr ${header(result.operand)}`);
			}
			function width(bytes: number): void {
				if (bytes === 4) encode(bytes);
				else branches(register(`icmp ult i32 ${bits}, ${bound[bytes]}`),
					() => encode(bytes), () => width(bytes + 1));
			}
			width(1);
			return result;
		}

		function stringLiteral(node: Nodes['string'] | Nodes['interp']): Value {
			const chunks = facts?.literals?.get(node);
			if (!chunks) return unsupported(node);
			if (node.kind === 'string') return constantString(chunks[0] ?? '');
			const parts: Value[] = [];
			chunks.forEach((chunk, index) => {
				if (chunk) parts.push(constantString(chunk));
				const child = node.children[index];
				if (child) {
					const conversion = facts?.interpolation?.get(child);
					parts.push(conversion ? emitBound(conversion, child) ?? unsupported(child)
						: asString(expr(child), child, facts?.types.get(child)));
				}
			});
			const sizes = parts.map(part => register(`zext i32 ${length(part)} to i64`));
			const bytes = sizes.reduce((sum, size) => register(`add i64 ${sum}, ${size}`), '0');
			trapIf(register(`icmp ugt i64 ${bytes}, 2147483647`), true);
			const result = allocate(facts?.types.get(node), bytes, register(`trunc i64 ${bytes} to i32`), 1);
			let destination = payload(result.operand);
			parts.forEach((part, index) => {
				const size = sizes[index];
				if (size === undefined) return;
				branches(register(`icmp ne i64 ${size}, 0`), () => {
					copyBytes(destination, payload(part.operand), size);
				}, () => {});
				destination = register(`getelementptr i8, ptr ${destination}, i64 ${size}`);
			});
			return result;
		}

		function loadMember(type: Shape, address: string): Value {
			const ir = memoryType(type);
			const loaded = register(`load ${ir}, ptr ${address}${memberAlignment(type)}`);
			if (ir === 'i8' || ir === 'i16')
				return { ...type, operand: register(`${isUnsigned(type.type) ? 'zext' : 'sext'} ${ir} ${loaded} to i32`) };
			return unpack(type, loaded);
		}

		function storeMember(input: Value, type: Shape, address: string, node: Node): void {
			const ir = memoryType(type);
			const packed = pack(input, type, node, true);
			const stored = ir === 'i8' || ir === 'i16' ? register(`trunc i32 ${packed} to ${ir}`) : packed;
			instruction(`store ${ir} ${stored}, ptr ${address}${memberAlignment(type)}`);
		}

		function storageKey(type: Shape, node: Node): string {
			const ir = memoryType(type);
			const refs = heapTags(type, node);
			return refs.length ? `${ir}:${refs.join(',')}` : ir;
		}

		function dropMember(type: Shape, slot: string, node: Node, address: string): string {
			const ir = memoryType(type);
			const load = `  ${slot}.value = load ${ir}, ptr ${slot}${memberAlignment(type)}`;
			if (!type.variants && !type.errors)
				return `${address}\n${load}\n  call void @gb.release(ptr ${slot}.value)`;
			const lines = [
				address, load,
				`  ${slot}.payload = extractvalue ${ir} ${slot}.value, 0`,
				`  ${slot}.tag = extractvalue ${ir} ${slot}.value, 1`,
			];
			const tags = type.variants ? heapTags(type, node) : [0];
			const tests = tags.map(tag => {
				const test = `${slot}.test${tag}`;
				lines.push(`  ${test} = icmp eq i8 ${slot}.tag, ${tag}`);
				return test;
			});
			const test = tests.reduce((left, right, index) => {
				const combined = `${slot}.or${index}`;
				lines.push(`  ${combined} = or i1 ${left}, ${right}`);
				return combined;
			}, 'false');
			const pointer = type.variants ? `${slot}.pointer` : `${slot}.payload`;
			if (type.variants) lines.push(`  ${pointer} = inttoptr ${irType(type.type)} ${slot}.payload to ptr`);
			lines.push(`  ${slot}.owned = select i1 ${test}, ptr ${pointer}, ptr null`, `  call void @gb.release(ptr ${slot}.owned)`);
			return lines.join('\n');
		}

		function recordLayout(type: CheckedAstType | undefined, node: Node) {
			const fields = Object.entries(recordFields(type)).map(([key, member]) => [key, shape(member.type, node)] as const);
			const layout = `{ ${fields.map(([, type]) => memoryType(type)).join(', ')} }`;
			return { fields, layout };
		}

		function allocateRecord(type: CheckedAstType | undefined, node: Node) {
			const { fields, layout } = recordLayout(type, node);
			const key = `record:${fields.map(([, item]) => storageKey(item, node)).join(';')}`;
			const destructors = drops ??= new Map<string, string>();
			let drop = destructors.get(key);
			if (drop === undefined) {
				const heapFields = fields.flatMap(([, item], index) => hasHeap(item) ? [index] : []);
				drop = heapFields.length ? `@gb.drop.record.${destructors.size}` : 'null';
				destructors.set(key, drop);
				if (heapFields.length) {
					const members = heapFields.map(index => {
						const field = fields[index]?.[1];
						if (!field) return unsupported(node);
						const slot = `%slot${index}`;
						return dropMember(field, slot, node, `  ${slot} = getelementptr ${layout}, ptr %data, i32 0, i32 ${index}`);
					});
					runtime.add(`define internal void ${drop}(ptr %object) {
entry:
  %data = getelementptr %gb.heap, ptr %object, i32 1
${members.join('\n')}
  ret void
}`);
				}
			}
			const result = allocate(type, sizeOf(layout), 0, 0, drop);
			return { result, data: payload(result.operand), fields, layout };
		}

		function fieldAddress(layout: string, data: string, index: number): string {
			return register(`getelementptr ${layout}, ptr ${data}, i32 0, i32 ${index}`);
		}

		function record(node: Nodes['data'], type = facts?.types.get(node)): Value {
			const items = node.children[0]?.kind === ',' ? node.children[0].children : node.children;
			const first = items[0];
			if (items.length === 1 && first && first.kind !== 'propdef') return expr(first);
			const { result, data, fields, layout } = allocateRecord(type, node);
			let positional = 0;
			for (const item of items) {
				const key = item.kind === 'propdef' && item.label ? text(item.label) : String(positional++);
				const index = fields.findIndex(field => field[0] === key);
				const target = fields[index]?.[1];
				const child = item.kind === 'propdef' ? item.value : item;
				if (!target || !child) return unsupported(item);
				const input = expr(child);
				storeMember(input, target, fieldAddress(layout, data, index), item);
			}
			return result;
		}

		function sameRecord(left: CheckedAstType | undefined, right: CheckedAstType | undefined, node: Node): boolean {
			if (left === right) return true;
			const a = Object.entries(recordFields(left));
			const b = Object.entries(recordFields(right));
			return a.length === b.length && a.every(([name, field], index) => {
				const other = b[index];
				if (name !== other?.[0]) return false;
				const first = shape(field.type, node);
				const second = shape(other[1].type, node);
				return storageKey(first, node) === storageKey(second, node) &&
					(first.heap?.family !== 'data' || second.heap?.family !== 'data' || sameRecord(first.heap, second.heap, node));
			});
		}

		function normalizeRecord(input: Value, target: CheckedAstType, node: Node): Value {
			const source = input.heap;
			if (sameRecord(source, target, node)) return { ...input, heap: target };
			if (input.tag !== undefined) return unsupported(node);
			const { fields, layout } = recordLayout(source, node);
			const [converted, live, , empty] = branches<string | void>(register(`icmp ne ptr ${input.operand}, null`), () => {
				const source = payload(input.operand);
				const destination = allocateRecord(target, node);
				for (const [index, [key, type]] of destination.fields.entries()) {
					const from = fields.findIndex(field => field[0] === key);
					const actual = fields[from]?.[1];
					if (!actual) return unsupported(node);
					const value = loadMember(actual, fieldAddress(layout, source, from));
					storeMember(value, type, fieldAddress(destination.layout, destination.data, index), node);
				}
				return destination.result.operand;
			}, () => {});
			return { type: 'ptr', heap: target, operand: register(`phi ptr [ ${converted}, %${live} ], [ null, %${empty} ]`) };
		}

		function recordMember(input: Value, field: number | string | undefined, node: Node, fallback?: number): Value {
			const { fields, layout } = recordLayout(input.heap, node);
			const named = typeof field === 'string' ? fields.findIndex(([key]) => key === field) : -1;
			const index = typeof field === 'number' ? field : named < 0 ? fallback ?? -1 : named;
			const target = fields[index]?.[1];
			if (!target) return unsupported(node);
			const pointer = operand(input, 'ptr', node);
			const abi = abiType(target);
			const [loaded, from, , zero] = branches<string | void>(register(`icmp ne ptr ${pointer}, null`), () =>
				pack(loadMember(target, fieldAddress(layout, payload(pointer), index)), target, node), () => {});
			return unpack(target, register(`phi ${abi} [ ${loaded}, %${from} ], [ zeroinitializer, %${zero} ]`));
		}

		function member(node: Nodes['.']): Value {
			const projected = facts?.projections?.get(node);
			if (projected) return expr(projected);
			const [receiver, field] = node.children;
			const input = expr(receiver);
			const target = field.kind === 'number' ? Number(field.value) : field.kind === 'ident' ? field.symbol.name : undefined;
			return recordMember(input, target, field);
		}

		function bufferBytes(type: string, count: string): string {
			return register(`mul i64 ${register(`zext i32 ${count} to i64`)}, ${sizeOf(type)}`);
		}

		function buffer(type: CheckedAstType, capacity: Value, node: Node): Value {
			const cap = scalarArgument(capacity, 'i32', node);
			const element = shape(type.elem, node);
			const ir = memoryType(element);
			const bytes = bufferBytes(ir, cap);
			trapIf(register(`icmp ugt i64 ${bytes}, 2147483639`), true);
			let drop = 'null';
			if (hasHeap(element)) {
				const key = `buffer:${storageKey(element, node)}`;
				const destructors = drops ??= new Map<string, string>();
				drop = destructors.get(key) ?? `@gb.drop.buffer.${destructors.size}`;
				if (!destructors.has(key)) {
					destructors.set(key, drop);
					runtime.add(dropBuffer(drop, dropMember(element, '%slot', node,
						`  %slot = getelementptr ${ir}, ptr %data, i32 %index`)));
				}
			}
			return allocate(type, bytes, type.components?.length ? 0 : cap, cap, drop);
		}

		function vectorAddress(buffer: Value, offset: Value, node: Node): string {
			const pointer = operand(buffer, 'ptr', node);
			const index = scalarArgument(offset, 'i32', node);
			const len = length(buffer);
			const past = register(`icmp ugt i32 ${index}, ${len}`);
			const remaining = register(`sub i32 ${len}, ${index}`);
			const short = register(`icmp ult i32 ${remaining}, 4`);
			trapIf(register(`or i1 ${past}, ${short}`), true);
			return register(`getelementptr float, ptr ${payload(pointer)}, i32 ${index}`);
		}

		function vectorConstructor(arg: Node, node: Node): Value {
			if (arg.kind === ',') {
				const [buffer, index] = arg.children;
				if (!buffer || !index || arg.children.length !== 2) return unsupported(node);
				const address = vectorAddress(expr(buffer), expr(index), node);
				return value(float32x4, `load ${float32x4}, ptr ${address}, align 4`);
			}
			const lane = scalarArgument(expr(arg), 'float', arg);
			const first = register(`insertelement ${float32x4} poison, float ${lane}, i32 0`);
			return value(float32x4, `shufflevector ${float32x4} ${first}, ${float32x4} poison, <4 x i32> zeroinitializer`);
		}

		function vectorStore(args: readonly Value[], node: Node, assigned?: Node): undefined {
			const [buffer, index, vector] = args;
			if (!buffer || !index) return unsupported(node);
			const address = vectorAddress(buffer, index, node);
			const input = assigned ? expr(assigned) : vector;
			if (!input) return unsupported(node);
			instruction(`store ${float32x4} ${operand(input, float32x4, node)}, ptr ${address}, align 4`);
		}

		function vectorSum(input: Value, node: Node): Value {
			const vector = operand(input, float32x4, node);
			const lane = (index: number) => register(`extractelement ${float32x4} ${vector}, i32 ${index}`);
			const left = register(`fadd float ${lane(0)}, ${lane(1)}`);
			const right = register(`fadd float ${lane(2)}, ${lane(3)}`);
			return value('float', `fadd float ${left}, ${right}`);
		}

		function bufferOperation(node: Node, bound: CheckedCall<Node>, args: readonly Value[], assigned?: Node): Value | undefined {
			const [first, second, third] = args;
			if (!first) return unsupported(node);
			const op = bound.intrinsic?.name;
			const type = first.heap ?? bound.inputs?.[0];
			if (op === 'length') {
				if (first.type !== 'ptr') return { type: 'i32', operand: '1' };
				return { type: 'i32', operand: type?.family === 'data'
					? String(Object.keys(recordFields(type)).length) : length(first) };
			}
			if (op === 'capacity') return { type: 'i32', operand: length(first, true) };
			if (type?.family !== 'buffer' || !second) return unsupported(node);
			const pointer = operand(first, 'ptr', node);
			const len = length(first);
			const elem = shape(type.elem, node);
			const ir = memoryType(elem);
			if (op === 'transfer') {
				const destination = operand(second, 'ptr', node);
				const invalid = register(`icmp eq ptr ${pointer}, ${destination}`);
				const occupied = register(`icmp ne i32 ${length(second)}, 0`);
				const small = register(`icmp ugt i32 ${len}, ${length(second, true)}`);
				trapIf(register(`or i1 ${invalid}, ${register(`or i1 ${occupied}, ${small}`)}`), true);
				const bytes = bufferBytes(ir, len);
				copyBytes(payload(destination), payload(pointer), bytes);
				instruction(`store i32 ${len}, ptr ${header(destination)}`);
				instruction(`store i32 0, ptr ${header(pointer)}`);
				return second;
			}
			const index = scalarArgument(second, 'i32', node);
			if (op === 'get') trapIf(register(`icmp uge i32 ${index}, ${len}`), true);
			else {
				const past = register(`icmp ugt i32 ${index}, ${len}`);
				const full = register(`icmp uge i32 ${index}, ${length(first, true)}`);
				trapIf(register(`or i1 ${past}, ${full}`), true);
			}
			const slot = register(`getelementptr ${ir}, ptr ${payload(pointer)}, i32 ${index}`);
			if (op === 'get') {
				const input = loadMember(elem, slot);
				retain(input);
				return track(input);
			}
			const input = assigned ? expr(assigned) : third;
			if (!input || op !== 'set') return unsupported(node);
			const previous = hasHeap(elem) ? heapPointer(loadMember(elem, slot)) : undefined;
			storeMember(input, elem, slot, node);
			if (previous !== undefined) instruction(`call void @gb.release(ptr ${previous})`);
			const append = register(`icmp eq i32 ${index}, ${len}`);
			const next = register(`add i32 ${len}, ${register(`zext i1 ${append} to i32`)}`);
			instruction(`store i32 ${next}, ptr ${header(pointer)}`);
		}

		function compareStrings(left: Value, right: Value, equal: boolean): Value {
			const lhs = length(left), rhs = length(right);
			const sameLength = register(`icmp eq i32 ${lhs}, ${rhs}`);
			const nonempty = register(`icmp ne i32 ${lhs}, 0`);
			const test = register(`and i1 ${sameLength}, ${nonempty}`);
			const [match, compared, , skipped] = branches<string | void>(test, () => {
				runtime.add('declare i32 @memcmp(ptr, ptr, i64)');
				const size = register(`zext i32 ${lhs} to i64`);
				const result = register(`call i32 @memcmp(ptr ${payload(left.operand)}, ptr ${payload(right.operand)}, i64 ${size})`);
				return register(`icmp eq i32 ${result}, 0`);
			}, () => {});
			const result = value('i1', `phi i1 [ ${match}, %${compared} ], [ ${sameLength}, %${skipped} ]`);
			return equal ? result : value('i1', `xor i1 ${result.operand}, true`);
		}

		function compareHeap(left: Value, right: Value, operation: typeof comparisons[keyof typeof comparisons], node: Node): Value {
			if (right.type !== 'ptr' || (operation !== 'eq' && operation !== 'ne')) return unsupported(node);
			const aggregate = [left, right].some(input => input.heap?.family === 'data' || input.heap?.family === 'buffer');
			return aggregate ? value('i1', `icmp ${operation} ptr ${left.operand}, ${right.operand}`)
				: compareStrings(left, right, operation === 'eq');
		}

		function compare(node: Nodes[keyof typeof comparisons]): Value {
			const [left, right] = node.children;
			const lhs = expr(left), rhs = expr(right);
			const opcode = comparisons[node.kind];
			if (lhs.tag !== undefined || rhs.tag !== undefined) return unsupported(node);
			if (lhs.type === 'ptr') return compareHeap(lhs, rhs, opcode, node);
			if (lhs.type === 'i1' && (opcode === 'eq' || opcode === 'ne'))
				return value('i1', `icmp ${opcode} i1 ${lhs.operand}, ${operand(rhs, 'i1', right)}`);
			const numeric = facts?.comparisons.get(node) ?? node.comparison;
			const useFloat = numeric?.floatType || isFloat(lhs.type) || isFloat(rhs.type);
			const type = useFloat ? 'double' : numeric?.wide ? 'i64' : integerType(lhs, rhs, node);
			const first = coerce(lhs, type, left), second = coerce(rhs, type, right);
			const prefix = useFloat ? (opcode === 'ne' ? 'u' : 'o')
				: opcode === 'eq' || opcode === 'ne' ? ''
				: numeric?.unsigned ? 'u' : 's';
			return value('i1', `${useFloat ? 'fcmp' : 'icmp'} ${prefix}${opcode} ${type} ${first}, ${second}`);
		}

		function truncateFloat(node: Nodes['call'], input: Value, type: Integer, conversion: NumericConversionRange): Value {
			const { checked, minimum, maximum } = conversion;
			const number = coerce(input, 'double', node);
			const wide = irType(type) === 'i64';
			const unsigned = isUnsigned(type);
			const magnitude = wide ? 2 ** 63 : 2 ** 31;
			const physicalMinimum = unsigned ? -1 : wide ? -magnitude : -magnitude - 1;
			const lowerPredicate = checked || (wide && !unsigned) ? 'oge' : 'ogt';
			const lower = register(`fcmp ${lowerPredicate} double ${number}, ${floatConstant(checked ? minimum : physicalMinimum)}`);
			const upper = register(`fcmp olt double ${number}, ${floatConstant(checked ? maximum : magnitude * (unsigned ? 2 : 1))}`);
			const valid = register(`and i1 ${lower}, ${upper}`);
			const opcode = unsigned ? 'fptoui' : 'fptosi';
			if (!checked) {
				trapIf(register(`xor i1 ${valid}, true`));
				return { type, operand: cast(input, type, opcode) };
			}
			const safe = value('double', `select i1 ${valid}, double ${number}, double 0.0`);
			return {
				type,
				operand: cast(safe, type, opcode),
				tag: register(`select i1 ${valid}, i8 0, i8 ${numericOverflow}`),
				errors: [numericOverflow, outOfMemory],
			};
		}

		function convert(node: Nodes['call'], argument: Node, target: CheckedAstType, range: NumericConversionRange | undefined): Value {
			const type = scalar(target);
			const input = expr(argument);
			if (!type || type === 'ptr' || type === 'i1' || input.type === 'i1' || input.tag !== undefined) return unsupported(node);
			const result = isFloat(input.type) && !isFloat(type)
				? range ? truncateFloat(node, input, type, range) : unsupported(node)
				: { type, operand: coerce(input, type, argument, true) };
			if (target.size === 1 || target.size === 2) {
				const narrow = `i${target.size * 8}`;
				const truncated = register(`trunc i32 ${result.operand} to ${narrow}`);
				result.operand = register(`${isUnsigned(type) ? 'zext' : 'sext'} ${narrow} ${truncated} to i32`);
			}
			return result;
		}

		function label(name: string) {
			block = name;
			lines.push(`${name}:`);
		}

		function trapIf(test: string, heap = false): void {
			const id = nextBlock++;
			const trap = `trap${id}`, resume = `resume${id}`;
			runtime.add('declare void @llvm.trap()');
			instruction(`br i1 ${test}, label %${trap}, label %${resume}`);
			label(trap);
			if (heap) {
				cleanup();
				runtime.add('declare i32 @fflush(ptr)');
				instruction('call i32 @fflush(ptr null)');
			}
			instruction('call void @llvm.trap()');
			instruction('unreachable');
			label(resume);
		}

		function branches<T>(test: string, yes: () => T, no: () => T): readonly [T, string, T, string] {
			const id = nextBlock++;
			const onTrue = `then${id}`, onFalse = `else${id}`, join = `join${id}`;
			instruction(`br i1 ${test}, label %${onTrue}, label %${onFalse}`);
			label(onTrue);
			const lhs = yes();
			const leftBlock = block;
			instruction(`br label %${join}`);
			label(onFalse);
			const rhs = no();
			const rightBlock = block;
			instruction(`br label %${join}`);
			label(join);
			return [lhs, leftBlock, rhs, rightBlock];
		}

		function branch(test: string, yes: () => Value, no: () => Value, node: Node): Value {
			const checked = abiShape(facts?.types.get(node));
			if (checked && (checked.variants || hasHeap(checked))) {
				const [left, leftBlock, right, rightBlock] = branches(test,
					() => pack(yes(), checked, node), () => pack(no(), checked, node));
				const joined = register(`phi ${abiType(checked)} [ ${left}, %${leftBlock} ], [ ${right}, %${rightBlock} ]`);
				return unpack(checked, joined);
			}
			let type: Representation;
			const [lhs, leftBlock, rhs, rightBlock] = branches(test, () => {
				const lhs = yes();
				type = lhs.type;
				return lhs;
			}, () => {
				const rhs = no();
				return { ...rhs, operand: coerce(rhs, type, node) };
			});
			const result = value(lhs.type, `phi ${irType(lhs.type)} [ ${lhs.operand}, %${leftBlock} ], [ ${rhs.operand}, %${rightBlock} ]`);
			result.heap = checked?.heap ?? lhs.heap;
			result.character = checked?.character ?? lhs.character;
			if (lhs.tag !== undefined || rhs.tag !== undefined) {
				result.errors = [...new Set([...(lhs.errors ?? []), ...(rhs.errors ?? [])])];
				result.tag = register(`phi i8 [ ${lhs.tag ?? 0}, %${leftBlock} ], [ ${rhs.tag ?? 0}, %${rightBlock} ]`);
			}
			return result;
		}

		function call(target: Function<Context>, args: readonly Value[], node: Node, tail = false): Value | undefined {
			if (args.length > target.parameters.length) return unsupported(node);
			const values = target.parameters.flatMap(([, type], index) => {
				if (!type) return [];
				const argument = args[index];
				if (!argument) return unsupported(node);
				return [`${abiType(type)} ${pack(argument, type, node, target.ownedParameters?.[index])}`];
			});
			const result = target.result === 'void' ? 'void' : abiType(target.result);
			const invocation = `call ${result} @${target.name}(${values.join(', ')})`;
			if (tail) {
				cleanup();
				instruction(`ret ${result} ${register(`musttail ${invocation}`)}`);
			} else if (target.result !== 'void') return track(unpack(target.result, register(invocation)));
			else instruction(invocation);
		}

		function scalarArgument(operand: Value, type: Scalar, node: Node): string {
			if (operand.tag !== undefined) return unsupported(node);
			return coerce(operand, type, node);
		}

		function floatExtremum(type: Float, operation: 'min' | 'max', left: string, right: string): Value {
			const bits = type === 'float' ? 'i32' : 'i64';
			const leftBits = register(`bitcast ${type} ${left} to ${bits}`);
			const rightBits = register(`bitcast ${type} ${right} to ${bits}`);
			const equalBits = register(`${operation === 'min' ? 'or' : 'and'} ${bits} ${leftBits}, ${rightBits}`);
			const equalValue = register(`bitcast ${bits} ${equalBits} to ${type}`);
			const selectLeft = register(`fcmp ${operation === 'min' ? 'olt' : 'ogt'} ${type} ${left}, ${right}`);
			const extreme = register(`select i1 ${selectLeft}, ${type} ${left}, ${type} ${right}`);
			const equal = register(`fcmp oeq ${type} ${left}, ${right}`);
			const ordered = register(`select i1 ${equal}, ${type} ${equalValue}, ${type} ${extreme}`);
			const unordered = register(`fcmp uno ${type} ${left}, ${right}`);
			return value(type, `select i1 ${unordered}, ${type} ${floatConstant(NaN)}, ${type} ${ordered}`);
		}

		function intrinsic(node: Node, args: readonly Value[], target: Nodes['call']['intrinsic']): Value | undefined {
			const parameter = target?.parameters?.[0]?.type;
			const input = scalar(parameter);
			const result = scalar(target?.returnType);
			if (!input || !result || !parameter?.name || !target?.name?.endsWith(parameter.name)) return;
			const operation = target.name.slice(0, -parameter.name.length);
			return emitIntrinsic(node, args, operation, input, result);
		}

		function emitIntrinsic(
			node: Node,
			args: readonly Value[],
			operation: string,
			input: Scalar,
			result: Scalar,
		): Value | undefined {
			const opcode = numericIntrinsic(input, operation);
			const extremum = isFloat(input) && (operation === 'min' || operation === 'max');
			if (!opcode && !extremum && operation !== 'bits') return;
			const ir = irType(input);
			const operands = args.map(arg => scalarArgument(arg, input, node));
			if (extremum) {
				const [left, right] = operands;
				if (left === undefined || right === undefined) return unsupported(node);
				return floatExtremum(input, operation, left, right);
			}
			if (operation === 'bits') return value(result, `bitcast ${ir} ${operands[0]} to ${irType(result)}`);
			const suffix = input === 'float' ? 'f32' : input === 'double' ? 'f64' : ir;
			const intrinsic = `@llvm.${opcode}.${suffix}`;
			runtime.add(`declare ${ir} ${intrinsic}(${operands.map(() => ir).join(', ')})`);
			return value(result, `call ${ir} ${intrinsic}(${operands.map(operand => `${ir} ${operand}`).join(', ')})`);
		}

		function inScope<T>(scope: Function<Context>, values: readonly (Value | undefined)[], run: () => T): T {
			const previousLocals = locals;
			const previousFacts = facts;
			const previousDollar = dollar;
			locals = new Map();
			facts = scope.facts;
			dollar = scope.input ? values[0] : undefined;
			for (const [index, input] of values.entries()) {
				const symbol = scope.parameters[index]?.[0];
				if (symbol && input) locals.set(symbol, input);
			}
			try {
				return run();
			} finally {
				locals = previousLocals;
				facts = previousFacts;
				dollar = previousDollar;
			}
		}

		function argumentsFor(bound: CheckedCall<Node>, target: Function<Context> | undefined, node: Node, order = bound.evaluationOrder): Value[] {
			const values: Value[] = [];
			for (const index of order) {
				if (target && !target.parameters[index]?.[1]) continue;
				const expression = bound.arguments[index];
				if (!expression) return unsupported(node);
				values[index] = target && bound.defaulted.includes(index)
					? inScope(target, values, () => expr(expression)) : expr(expression);
			}
			return values;
		}

		function carriedArguments(bound: CheckedCall<Node>, node: Node, carrier: Value, target: Function<Context> | undefined): Value[] {
			return target && bound.spread ? target.parameters.map(([symbol], index) =>
				recordMember(carrier, symbol?.name, node, index)) : [carrier];
		}

		function emitBound(
			bound: CheckedCall<Node>,
			node: Node,
			carrier?: Value,
			yieldValue?: (input: Value) => void,
		): Value | undefined {
			if (bound.constant !== undefined) return { type: 'i32', operand: String(bound.constant) };
			const target = bound.target === undefined ? undefined : prepared?.[bound.target];
			const name = bound.intrinsic?.name;
			const delayed = !carrier && (name === 'set' || name === 'simd.store') && !bound.defaulted.length &&
				bound.evaluationOrder.every((slot, index) => slot === index) ? bound.arguments[2] : undefined;
			const args = carrier
				? carriedArguments(bound, node, carrier, target)
				: argumentsFor(bound, target, node, delayed ? bound.evaluationOrder.slice(0, 2) : bound.evaluationOrder);
			if (bound.output && args[0]) {
				print(args[0], node);
				return;
			}
			if (target?.stream) {
				if (!yieldValue) return unsupported(node);
				emitStream(target, args, yieldValue, node);
				return;
			}
			if (target) return call(target, args, node);
			switch (name) {
				case 'simd.sum':
					return args[0] ? vectorSum(args[0], node) : unsupported(node);
				case 'simd.store':
					return vectorStore(args, node, delayed);
				case 'length': case 'capacity': case 'get': case 'set': case 'transfer':
					return bufferOperation(node, bound, args, delayed);
				default:
					return intrinsic(node, args, bound.intrinsic) ?? unsupported(node);
			}
		}

		function construct(node: Nodes['call'], arg: Node): Value {
			const target = facts?.types.get(node);
			if (target?.family === 'vector') return vectorConstructor(arg, node);
			if (arg.kind === ',') return unsupported(node);
			if (target?.family === 'buffer') return buffer(target, expr(arg), node);
			if (target?.family === 'string') return asString(expr(arg), arg, facts?.types.get(arg));
			if (target?.family === 'char') {
				const input = expr(arg);
				const type = integer(input, arg);
				const cp = coerce(input, 'u32', arg, true);
				const invalid = register(`icmp uge i32 ${cp}, 1114112`);
				const surrogate = register(`icmp ult i32 ${register(`sub i32 ${cp}, 55296`)}, 2048`);
				const replace = register(`or i1 ${invalid}, ${surrogate}`);
				return { type: 'u32', character: true, operand: type === 'u8' ? cp
					: register(`select i1 ${replace}, i32 65533, i32 ${cp}`) };
			}
			if (target?.family === 'data') return arg.kind === 'data' ? record(arg, target) : normalizeRecord(expr(arg), target, node);
			const conversion = facts?.conversions.get(node) ?? node.conversion;
			if (!conversion) return unsupported(node);
			return convert(node, arg, conversion.target, conversion.range);
		}

		function directCall(node: Nodes['call']): Value | undefined {
			const bound = facts?.calls.get(node);
			if (bound) return emitBound(bound, node);
			const [callee, arg] = node.children;
			if (callee.kind === 'typeident' && arg) return construct(node, arg);
			const args = arg?.kind === ',' ? arg.children : arg ? [arg] : [];
			const target = callee.kind === 'ident' && functions.get(callee.symbol);
			if (target) return call(target, args.map(expr), node);
			return intrinsic(node, args.map(expr), node.intrinsic) ?? unsupported(node);
		}

		function print(input: Value, node: Node): void {
			if (input.tag !== undefined) return unsupported(node);
			const { type, operand } = input;
			if (input.character) return print(characterString(input), node);
			if (type === float32x4 || type === 'i128') return unsupported(node);
			if (type === 'ptr') {
				if (input.heap?.family === 'data' || input.heap?.family === 'buffer') return unsupported(node);
				runtime.add(printString);
				runtime.add('declare i32 @putchar(i32)');
				instruction(`call void @gb.print.string(ptr ${operand})`);
				return;
			}
			runtime.add('declare i32 @printf(ptr, ...)');
			if (type === 'i1') {
				runtime.add('@.true = private unnamed_addr constant [5 x i8] c"true\\00"');
				runtime.add('@.false = private unnamed_addr constant [6 x i8] c"false\\00"');
				const format = register(`select i1 ${operand}, ptr @.true, ptr @.false`);
				instruction(`call i32 (ptr, ...) @printf(ptr ${format})`);
				return;
			}
			const ir = irType(type);
			if (isFloat(type)) {
				const output = storage('[32 x i8]');
				const length = formatFloat(input, output, node);
				runtime.add('@.format.text = private unnamed_addr constant [5 x i8] c"%.*s\\00"');
				instruction(`call i32 (ptr, ...) @printf(ptr @.format.text, i32 ${length}, ptr ${output})`);
				return;
			}
			const format = `%${ir === 'i64' ? 'll' : ''}${isUnsigned(type) ? 'u' : 'd'}`;
			runtime.add(`@.format.${type} = private unnamed_addr constant [${format.length + 1} x i8] c"${format}\\00"`);
			instruction(`call i32 (ptr, ...) @printf(ptr @.format.${type}, ${ir} ${operand})`);
		}

		function dispatch(node: Nodes['|'], input: Value): Value {
			const arms = new Map<number, Nodes['fn']>();
			const tags = [0, ...(input.errors ?? [])];
			const payload: Value = { type: input.type, character: input.character, heap: input.heap, operand: input.operand };
			const stages = astDispatchArms<Context>(node);
			if (!stages) return unsupported(node);
			for (const arm of stages) {
				if (arm.kind !== 'fn' || arm.parameters?.length !== 1) return unsupported(arm);
				const type = arm.parameters[0]?.symbol.type;
				const matches = plainVariant(type)?.type === input.type ? [0]
					: type?.name === 'Error' ? tags.slice(1)
					: [numericErrorTags.get(type?.name ?? '')];
				for (const tag of matches)
					if (tag !== undefined && tags.includes(tag) && !arms.has(tag)) arms.set(tag, arm);
			}

			function emitArm(arm: Nodes['fn'], accepted: readonly number[]): Value {
				return stageBlock(arm, accepted.includes(0) ? payload : undefined) ?? unsupported(arm);
			}

			function selectArm(remaining: readonly number[]): Value {
				const first = remaining[0];
				const arm = first !== undefined && arms.get(first);
				if (!arm) return unsupported(node);
				const accepted = remaining.filter(tag => arms.get(tag) === arm);
				const rest = remaining.filter(tag => arms.get(tag) !== arm);
				if (!rest.length) return emitArm(arm, accepted);
				const tests = accepted.map(tag => register(`icmp eq i8 ${input.tag}, ${tag}`));
				const [firstTest, ...others] = tests;
				if (!firstTest) return unsupported(node);
				const test = others.reduce((left, right) => register(`or i1 ${left}, ${right}`), firstTest);
				return branch(test, () => emitArm(arm, accepted), () => selectArm(rest), node);
			}
			return selectArm(tags);
		}

		function stageBlock(
			stage: Nodes['fn'],
			carrier: Value | undefined,
			yieldValue?: (input: Value) => void,
		): Value | undefined {
			const outer = { locals, dollar, completion };
			locals = new Map(locals);
			dollar = carrier;
			const parameters = stage.parameters ?? [];
			if (carrier) parameters.forEach((parameter, index) => {
				const symbol = parameter.symbol;
				const value = parameters.length === 1 ? carrier : recordMember(carrier, symbol.name, parameter, index);
				locals.set(symbol, value);
			});
			try {
				const body = stage.statements ?? [];
				if (yieldValue) {
					scoped(() => streamBody(body, input => {
						const inner = { locals, dollar, completion };
						({ locals, dollar, completion } = outer);
						try {
							yieldValue(input);
						} finally {
							({ locals, dollar, completion } = inner);
						}
					}));
					return;
				}
				const statements = body.filter(node => node.kind !== 'comment');
				const tail = statements.pop();
				const result = scoped(() => {
					for (const statement of statements) emitStatement(statement);
					if (!tail) return;
					const input = evaluate(tail.kind === 'next' ? tail.children?.[0] ?? tail : tail);
					if (input) retain(input);
					return input;
				});
				if (result) return track(result);
			} finally {
				({ locals, dollar, completion } = outer);
			}
		}

		function armType(arm: Node): CheckedAstType | undefined {
			if (arm.kind === 'fn' && arm.parameters?.length === 1)
				return arm.parameters[0]?.symbol.type;
		}

		function literalTest(input: Value, literal: number | boolean): string {
			const ir = irType(input.type);
			const compare = isFloat(input.type) ? 'fcmp oeq' : 'icmp eq';
			const constant = isFloat(input.type) ? floatConstant(Number(literal))
				: ir === 'i1' ? String(Boolean(literal)) : String(Number(literal));
			return register(`${compare} ${ir} ${input.operand}, ${constant}`);
		}

		function dispatchStream(
			arms: readonly Node[],
			rest: readonly Node[],
			input: Value,
			yieldValue: (input: Value) => void,
		): void {
			for (const arm of arms) {
				if (arm.kind !== 'fn') return unsupported(arm);
				const type = armType(arm);
				const run = (carrier?: Value) => {
					stageBlock(arm, carrier, value => { drive(rest, value, yieldValue); });
				};
				if (type?.family === 'literal') {
					const literal = type.value;
					if (typeof literal === 'string') {
						const match = (value: Value) => {
							const expected = constantString(literal);
							const test = register(`icmp eq ptr ${value.operand}, ${expected.operand}`);
							branches(test, () => run(value), () => {});
						};
						if (input.tag === undefined) {
							if (input.type === 'ptr') match(input);
						} else tagArm(input, input.tag, type, value => { if (value) match(value); });
					} else {
						if (typeof literal !== 'number' && typeof literal !== 'boolean') return unsupported(arm);
						if (input.type !== 'ptr') branches(literalTest(input, literal), () => run(input), () => {});
					}
				} else if (input.tag === undefined) {
					const candidate = plainVariant(type);
					if (candidate && variantKey(candidate) === variantKey(input)) run(input);
				} else tagArm(input, input.tag, type, run);
			}
		}

		function tagArm(input: Value, tag: string, type: CheckedAstType | undefined, run: (carrier?: Value) => void): void {
			const variant = plainVariant(type);
			const normal = variant && (input.variants ? input.variants.find(candidate => variantKey(candidate) === variantKey(variant))
				: variantKey(variant) === variantKey(input) ? variant : undefined);
			if (normal) {
				const test = register(`icmp eq i8 ${tag}, ${input.variants ? variantTag(normal, root) : 0}`);
				branches(test, () => run(input.variants ? decodeVariant(input, normal)
					: { ...normal, operand: input.operand }), () => {});
			} else {
				const error = numericErrorTags.get(type?.name ?? '');
				const compare = type?.name === 'Error' ? input.variants ? 'ult' : 'ne' : 'eq';
				const operand = type?.name === 'Error' ? input.variants ? 16 : 0 : error;
				if (operand !== undefined)
					branches(register(`icmp ${compare} i8 ${tag}, ${operand}`), () => run(), () => {});
			}
		}

		function drive(
			stages: readonly Node[],
			carrier: Value,
			yieldValue?: (input: Value) => void,
			index = 0,
		): Value | undefined {
			const stage = stages[index];
			const nextIndex = index + 1;
			if (!stage) {
				if (yieldValue) yieldValue(carrier);
				else return carrier;
				return;
			}
			if (yieldValue && stage.kind === '|') {
				const arms = astDispatchArms<Context>(stage);
				if (!arms) return unsupported(stage);
				dispatchStream(arms, stages.slice(nextIndex), carrier, yieldValue);
				return;
			}
			const type = armType(stage);
			if (yieldValue && type && (carrier.tag !== undefined || type.family === 'literal')) {
				let end = nextIndex;
				while (end < stages.length && armType(stages[end] ?? stage)) end++;
				dispatchStream(stages.slice(index, end), stages.slice(end), carrier, yieldValue);
				return;
			}
			if (carrier.variants && carrier.tag !== undefined) {
				if (!yieldValue) return unsupported(stage);
				for (const type of carrier.variants) {
					const test = register(`icmp eq i8 ${carrier.tag}, ${variantTag(type, stage)}`);
					branches(test, () => { drive(stages, decodeVariant(carrier, type), yieldValue, index); }, () => {});
				}
				return;
			}

			const next = yieldValue ? (input: Value) => { drive(stages, input, yieldValue, nextIndex); } : undefined;
			const result = driveStage(stage, carrier, next);
			if (result) return drive(stages, result, yieldValue, nextIndex);
		}

		function driveStage(stage: Node, carrier: Value, yieldValue?: (input: Value) => void): Value | undefined {
			const alternatives = facts?.stages.get(stage);
			if (alternatives) {
				const bound = alternatives.find(alternative => {
					const variant = plainVariant(alternative.input);
					return variant && variantKey(variant) === variantKey(carrier);
				})
					?? (alternatives.length === 1 ? alternatives[0] : undefined);
				if (!bound) return unsupported(stage);
				return emitBound(bound, stage, carrier, yieldValue);
			}
			switch (stage.kind) {
				case 'ident': {
					if (stage.standardOutput || stage.symbol === standardOutput) {
						print(carrier, stage);
						return;
					}
					const target = functions.get(stage.symbol);
					if (target) return call(target, [carrier], stage);
					break;
				}
				case '|':
					if (carrier.tag !== undefined) return dispatch(stage, carrier);
					break;
				case 'fn':
					if (carrier.tag === undefined) return stageBlock(stage, carrier, yieldValue);
					break;
				default:
					break;
			}
			return unsupported(stage);
		}

		function pipe(node: Nodes['>>'], yieldValue?: (input: Value) => void): Value | undefined {
			const [input, ...stages] = node.children;
			if (!input || !stages.length) return unsupported(node);
			const [first, ...rest] = stages;
			const packed = first && facts?.stages.get(first)?.find(alternative => alternative.packed);
			if (first && packed) {
				const result = emitBound(packed, first, undefined, yieldValue
					? carrier => { drive(rest, carrier, yieldValue); } : undefined);
				if (result) return drive(rest, result, yieldValue);
				return;
			}
			if (yieldValue) {
				if (input.kind === 'loop') loop(stages, yieldValue);
				else emitValues(input, carrier => { drive(stages, carrier, yieldValue); });
			}
			else {
				const value = expr(input);
				if (!value.variants) return drive(stages, value);
				const type = shape(facts?.types.get(node), node);
				const abi = abiType(type);
				const slot = storage(abi);
				const owned = hasHeap(type) ? referenceSlot() : undefined;
				instruction(`store ${abi} zeroinitializer, ptr ${slot}`);
				drive(stages, value, input => {
					const packed = pack(input, type, node);
					if (owned) replaceReference(owned, unpack(type, packed));
					instruction(`store ${abi} ${packed}, ptr ${slot}`);
				});
				return unpack(type, register(`load ${abi}, ptr ${slot}`));
			}
		}

		function jump(target: string): void {
			instruction(`br label %${target}`);
		}

		function exit(target: Exit | undefined, node: Node): void {
			if (!target) return unsupported(node);
			cleanup(target.scope);
			jump(target.label);
			label(`dead${nextBlock++}`);
		}

		function loop(stages: readonly Node[], yieldValue: (input: Value) => void): void {
			const id = nextBlock++;
			const head = `loop${id}`, increment = `increment${id}`, end = `end${id}`;
			const entry = block;
			const previous = breakLabel;
			jump(head);
			label(head);
			const index = value('i32', `phi i32 [ 0, %${entry} ], [ %index${id}, %${increment} ]`);
			breakLabel = { label: end, scope };
			scoped(() => { drive(stages, index, yieldValue); });
			breakLabel = previous;
			jump(increment);
			label(increment);
			instruction(`%index${id} = add i32 ${index.operand}, 1`);
			jump(head);
			label(end);
		}

		function finishCompletion(): void {
			const end = completion?.label;
			if (end) {
				jump(end);
				label(end);
			}
		}

		function streamBody(statements: readonly Node[], yieldValue: (input: Value) => void): void {
			const previous = completion;
			completion = { scope };
			try {
				for (const statement of statements) {
					if (statement.kind === 'def') emitStatement(statement);
					else statementScope(statement, () => emitValues(statement, yieldValue));
					if (statement.kind === 'done') break;
				}
				finishCompletion();
			} finally {
				completion = previous;
			}
		}

		function emitStream(
			target: Function<Context>,
			args: readonly Value[],
			yieldValue: (input: Value) => void,
			node: Node,
		): void {
			if (activeStreams.has(target)) {
				if (target.stream !== 'many') return unsupported(node);
				streamEffects.add(target);
				call(target, args, node);
				return;
			}
			const caller = { locals, facts, dollar, completion };
			const concrete: Value[] = [];
			for (const [index, [, shape]] of target.parameters.entries()) {
				if (!shape) continue;
				const arg = args[index];
				if (!arg) return unsupported(node);
				concrete[index] = unpack(shape, pack(arg, shape, node));
			}
			activeStreams.add(target);
			try {
				inScope(target, concrete, () => streamBody(target.body, input => {
					const callee = { locals, facts, dollar, completion };
					({ locals, facts, dollar, completion } = caller);
					try {
						yieldValue(input);
					} finally {
						({ locals, facts, dollar, completion } = callee);
					}
				}));
			} finally {
				activeStreams.delete(target);
			}
		}

		function emitValues(node: Node, yieldValue: (input: Value) => void): void {
			switch (node.kind) {
				case 'fn':
					streamBody(node.statements ?? [], yieldValue);
					return;
				case ',':
					for (const child of node.children) emitValues(child, yieldValue);
					return;
				case '(':
					emitValues(node.children[0], yieldValue);
					return;
				case 'next':
					if (node.children?.[0]) emitValues(node.children[0], yieldValue);
					return;
				case '?': {
					const [condition, yes, no] = node.children;
					branches(operand(expr(condition), 'i1', condition), () => emitValues(yes, yieldValue), () => {
						if (no) emitValues(no, yieldValue);
					});
					return;
				}
				case '>>':
					pipe(node, yieldValue);
					return;
				case 'def':
					emitStatement(node);
					return;
				case 'call': {
					const bound = facts?.calls.get(node);
					const input = bound ? emitBound(bound, node, undefined, yieldValue) : directCall(node);
					if (input) yieldValue(input);
					return;
				}
				case '->': {
					const input = thread(node, yieldValue);
					if (input) yieldValue(input);
					return;
				}
				case '??': {
					const [left, right] = node.children;
					const { present, read } = optionalValue(left);
					branches(present, () => yieldValue(read()), () => emitValues(right, yieldValue));
					return;
				}
				case 'break': return exit(breakLabel, node);
				case 'done':
					if (!completion) return unsupported(node);
					return exit({ label: completion.label ??= `done${nextBlock++}`, scope: completion.scope }, node);
				case 'comment': return;
				default: {
					const input = evaluate(node);
					if (input) yieldValue(input);
				}
			}
		}

		function thread(node: Nodes['->'], yieldValue?: (input: Value) => void): Value | undefined {
			const plan = facts?.threads.get(node);
			if (!plan) return unsupported(node);
			for (const operation of plan.operations) {
				if (operation.kind === 'bind') {
					if (operation.reference.kind !== 'ident') return unsupported(operation.reference);
					locals.set(operation.reference.symbol, expr(operation.expression));
				} else evaluate(operation.call);
			}
			if (yieldValue) emitValues(plan.result, yieldValue);
			else return evaluate(plan.result);
		}

		function optionalValue(left: Node) {
			if (left.kind !== 'call') return unsupported(left);
			const bound = facts?.calls.get(left);
			const target = bound?.target === undefined ? undefined : prepared?.[bound.target];
			if (!bound || target?.stream !== 'optional' || target.result === 'void') return unsupported(left);
			const type = target.result;
			const abi = abiType(type);
			const slot = storage(abi);
			const owned = hasHeap(type) ? referenceSlot() : undefined;
			const present = storage('i1');
			instruction(`store i1 false, ptr ${present}`);
			emitBound(bound, left, undefined, input => {
				const packed = pack(input, type, left);
				if (owned) replaceReference(owned, unpack(type, packed));
				instruction(`store ${abi} ${packed}, ptr ${slot}`);
				instruction(`store i1 true, ptr ${present}`);
			});
			return { present: register(`load i1, ptr ${present}`), read: () => unpack(type, register(`load ${abi}, ptr ${slot}`)) };
		}

		function evaluate(node: Node): Value | undefined {
			switch (node.kind) {
				case 'call': return directCall(node);
				case '>>': return pipe(node);
				case '->': return thread(node);
				case 'ident':
					return node.symbol.type?.family === 'void' ? undefined : expr(node);
				default: return expr(node);
			}
		}

		function expr(node: Node): Value {
			switch (node.kind) {
				case 'number':
					return numberLiteral(node);
				case 'string': case 'interp':
					return stringLiteral(node);
				case 'data':
					return record(node);
				case '.':
					return member(node);
				case 'ident': {
					const local = locals.get(node.symbol);
					if (local) return local;
					if (node.symbol.kind === 'literal' && typeof node.symbol.value === 'string')
						return constantString(node.symbol.value);
					if (node.symbol.kind === 'literal' && typeof node.symbol.value === 'boolean')
						return { type: 'i1', operand: String(node.symbol.value) };
					if (node.symbol.kind === 'literal' && typeof node.symbol.value === 'number' &&
						isFloat(scalar(node.symbol.type) ?? 'i1'))
						return { type: 'double', operand: floatConstant(node.symbol.value) };
					return unsupported(node);
				}
				case '$':
					return dollar ?? unsupported(node);
				case '(':
					return expr(node.children[0]);
				case 'negate':
				case '~': {
					const [child] = node.children;
					const input = expr(child);
					if (node.kind === 'negate' && isFloat(input.type) && input.tag === undefined)
						return value(input.type, `fneg ${input.type} ${input.operand}`);
					const type = irType(integer(input, child));
					return value(type, node.kind === 'negate'
						? `sub ${type} 0, ${input.operand}` : `xor ${type} ${input.operand}, -1`);
				}
				case '!': {
					const [child] = node.children;
					return value('i1', `xor i1 ${operand(expr(child), 'i1', child)}, true`);
				}
				case '+': case '-': case '*': case '/': case '%':
					return arithmeticValue(node);
				case '&': case '|': case '^': case '<:': case ':>':
					return bitwiseValue(node);
				case '==': case '!=': case '<': case '>': case '<=': case '>=':
					return compare(node);
				case '&&':
				case '||': {
					const [left, right] = node.children;
					const test = operand(expr(left), 'i1', left);
					const evaluate = (): Value => ({ type: 'i1', operand: operand(expr(right), 'i1', right) });
					const onTrue = (): Value => ({ type: 'i1', operand: 'true' });
					const onFalse = (): Value => ({ type: 'i1', operand: 'false' });
					return node.kind === '&&'
						? branch(test, evaluate, onFalse, node)
						: branch(test, onTrue, evaluate, node);
				}
				case '?': {
					const [condition, yes, no] = node.children;
					if (!no) return unsupported(node);
					return branch(operand(expr(condition), 'i1', condition), () => expr(yes), () => expr(no), node);
				}
				case 'call':
					return directCall(node) ?? unsupported(node);
				case '>>':
					return pipe(node) ?? unsupported(node);
				case '->':
					return thread(node) ?? unsupported(node);
				case '??':
					{
						const { present, read } = optionalValue(node.children[0]);
						return branch(present, read, () => expr(node.children[1]), node);
					}
				default:
					return unsupported(node);
			}
		}

		function emitStatement(node: Node): void {
			switch (node.kind) {
				case 'def': {
					if (!facts && node.symbol.flags & Flags.Variable) return unsupported(node);
					const target = shape(facts?.types.get(node.symbol) ?? node.symbol.type, node);
					const owner = scope;
					statementScope(node, () => {
						const input = unpack(target, pack(expr(node.value), target, node, true));
						locals.set(node.symbol, track(input, owner, node.symbol));
					});
					return;
				}
				case 'call': case '>>': case '->': case ',': case '?':
					statementScope(node, () => emitValues(node, () => { unsupported(node); }));
					return;
				default:
					return unsupported(node);
			}
		}

		function emitReturn(node: Node, result: Shape): void {
			if (node.kind === '?' && node.children[2]) {
				const [condition, yes, no] = node.children;
				const id = nextBlock++;
				const truthy = `return.true${id}`, falsy = `return.false${id}`;
				const test = operand(expr(condition), 'i1', condition);
				instruction(`br i1 ${test}, label %${truthy}, label %${falsy}`);
				label(truthy);
				emitReturn(yes, result);
				label(falsy);
				emitReturn(no, result);
			} else {
				if (node.kind === 'call') {
					const bound = facts?.calls.get(node);
					if (bound?.target !== undefined && prepared?.[bound.target] === fn &&
						fn.parameters.every(([, shape], index) => !shape || !hasHeap(shape) || fn.ownedParameters?.[index])) {
						call(fn, argumentsFor(bound, fn, node), node, true);
						return;
					}
				}
				const returned = pack(expr(node), result, node, true);
				cleanup();
				instruction(`ret ${abiType(result)} ${returned}`);
			}
		}

		const body = fn.body.filter(node => node.kind !== 'comment');
		if (fn.stream) {
			activeStreams.add(fn);
			streamBody(body, () => {});
			cleanup();
			instruction('ret void');
		} else if (isMain || fn.result === 'void') {
			completion = isMain ? undefined : { scope };
			for (const statement of body) {
				if (statement.kind === 'next' || statement.kind === 'done')
					statementScope(statement, () => emitValues(statement, () => {}));
				else emitStatement(statement);
				if (statement.kind === 'done') break;
			}
			finishCompletion();
			cleanup();
			instruction(isMain ? 'ret i32 0' : 'ret void');
		} else {
			const tail = body.findIndex(node => node.kind === 'next');
			const end = tail < 0 ? body.length - 1 : tail;
			for (const statement of body.slice(0, end)) emitStatement(statement);
			const statement = body[end];
			const result = statement?.kind === 'next' ? statement.children?.[0] : statement;
			if (!result) return unsupported(statement ?? root);
			emitReturn(result, fn.result);
		}
		lines.splice(2, 0, ...allocations);
		lines.push('}');
		return lines.join('\n');
	}

	const bodies = [...definitions, ...(prepared ?? [])].filter(fn => !fn.stream).map(fn => emitBody(fn));
	bodies.push(emitBody({ name: 'main', result: { type: 'i32' }, parameters: [], body: main.statements, facts: root.checked?.main }, true));
	for (const fn of streamEffects) bodies.push(emitBody(fn));
	const heapPrelude = runtime.delete(referenceRuntime) ? [referenceRuntime] : [];
	return [...heapPrelude, ...runtime, ...bodies, ''].join('\n');
}
const floatOutput = String.raw`declare i32 @snprintf(ptr, i64, ptr, ...)
declare double @strtod(ptr, ptr)
declare i32 @atoi(ptr)
declare i64 @strtoull(ptr, ptr, i32)
@.float.scientific = private unnamed_addr constant [5 x i8] c"%.*e\00"
@.float.candidate = private unnamed_addr constant [8 x i8] c"%llue%d\00"
@.float.integer = private unnamed_addr constant [5 x i8] c"%llu\00"
@.float.fraction = private unnamed_addr constant [4 x i8] c".%s\00"
@.float.exponent = private unnamed_addr constant [5 x i8] c"e%+d\00"
@.float.nan = private unnamed_addr constant [4 x i8] c"NaN\00"
@.float.infinity = private unnamed_addr constant [9 x i8] c"Infinity\00"
define internal void @gb.format.byte(ptr %output, ptr %length, i32 %character) {
entry:
  %index = load i32, ptr %length
  %address = getelementptr i8, ptr %output, i32 %index
  %byte = trunc i32 %character to i8
  store i8 %byte, ptr %address
  %next = add i32 %index, 1
  store i32 %next, ptr %length
  ret void
}
define internal void @gb.format.text(ptr %output, ptr %length, ptr %format, ptr %text) {
entry:
  %index = load i32, ptr %length
  %address = getelementptr i8, ptr %output, i32 %index
  %count = call i32 (ptr, i64, ptr, ...) @snprintf(ptr %address, i64 24, ptr %format, ptr %text)
  %next = add i32 %index, %count
  store i32 %next, ptr %length
  ret void
}
define internal i32 @gb.format.float(double %number, ptr %output) {
entry:
  %length = alloca i32
  store i32 0, ptr %length
  %buffer = alloca [32 x i8], align 1
  %nan = fcmp uno double %number, %number
  br i1 %nan, label %print.nan, label %ordered

print.nan:
  %nan.length = call i32 (ptr, i64, ptr, ...) @snprintf(ptr %output, i64 32, ptr @.float.nan)
  ret i32 %nan.length

ordered:
  %zero = fcmp oeq double %number, 0.0
  br i1 %zero, label %print.zero, label %nonzero

print.zero:
  store i8 48, ptr %output
  ret i32 1

nonzero:
  %negative = fcmp olt double %number, 0.0
  br i1 %negative, label %sign, label %magnitude

sign:
  %negated = fneg double %number
  call void @gb.format.byte(ptr %output, ptr %length, i32 45)
  br label %magnitude

magnitude:
  %absolute = phi double [ %number, %nonzero ], [ %negated, %sign ]
  %infinite = fcmp oeq double %absolute, 0x7FF0000000000000
  %bits = bitcast double %absolute to i64
  %fraction.bits = and i64 %bits, 4503599627370495
  %asymmetric.interval = icmp eq i64 %fraction.bits, 0
  br i1 %infinite, label %print.infinity, label %digits

print.infinity:
  call void @gb.format.text(ptr %output, ptr %length, ptr @.float.infinity, ptr null)
  br label %finish

digits:
  %precision = phi i32 [ 0, %magnitude ], [ %more, %next.precision ]
  %power = phi i64 [ 1, %magnitude ], [ %next.power, %next.precision ]
  call i32 (ptr, i64, ptr, ...) @snprintf(ptr %buffer, i64 32, ptr @.float.scientific, i32 %precision, double %absolute)
  %parsed = call double @strtod(ptr %buffer, ptr null)
  %matches = fcmp oeq double %absolute, %parsed
  %more = add i32 %precision, 1
  %use.digits = or i1 %matches, %asymmetric.interval
  br i1 %use.digits, label %prepare.digits, label %next.precision

prepare.digits:
  %point = icmp ne i32 %precision, 0
  %prefix = select i1 %point, i32 2, i32 1
  %offset = add i32 %precision, %prefix
  %exponent.mark = getelementptr i8, ptr %buffer, i32 %offset
  %exponent.text = getelementptr i8, ptr %exponent.mark, i32 1
  %exponent = call i32 @atoi(ptr %exponent.text)
  store i8 0, ptr %exponent.mark
  %head = load i8, ptr %buffer
  %dot = getelementptr i8, ptr %buffer, i32 1
  %significand = select i1 %point, ptr %dot, ptr %buffer
  store i8 %head, ptr %significand
  br i1 %matches, label %format, label %neighbor

neighbor:
  %digits.int = call i64 @strtoull(ptr %significand, ptr null, i32 10)
  %too.high = fcmp ogt double %parsed, %absolute
  %at.decade = icmp eq i64 %digits.int, %power
  %cross.decade = and i1 %at.decade, %too.high
  %scaled = mul i64 %digits.int, 10
  %base = select i1 %cross.decade, i64 %scaled, i64 %digits.int
  %step = select i1 %too.high, i64 -1, i64 1
  %adjacent = add i64 %base, %step
  %scale = sub i32 %exponent, %precision
  %scale.adjustment = zext i1 %cross.decade to i32
  %neighbor.scale = sub i32 %scale, %scale.adjustment
  call i32 (ptr, i64, ptr, ...) @snprintf(ptr %buffer, i64 32, ptr @.float.candidate, i64 %adjacent, i32 %neighbor.scale)
  %neighbor.number = call double @strtod(ptr %buffer, ptr null)
  %neighbor.matches = fcmp oeq double %absolute, %neighbor.number
  br i1 %neighbor.matches, label %neighbor.digits, label %next.precision

next.precision:
  %next.power = mul i64 %power, 10
  br label %digits

neighbor.digits:
  %neighbor.count = call i32 (ptr, i64, ptr, ...) @snprintf(ptr %buffer, i64 32, ptr @.float.integer, i64 %adjacent)
  %neighbor.place = add i32 %neighbor.scale, %neighbor.count
  %neighbor.exponent = sub i32 %neighbor.place, 1
  br label %format

format:
  %text = phi ptr [ %significand, %prepare.digits ], [ %buffer, %neighbor.digits ]
  %count = phi i32 [ %more, %prepare.digits ], [ %neighbor.count, %neighbor.digits ]
  %place = phi i32 [ %exponent, %prepare.digits ], [ %neighbor.exponent, %neighbor.digits ]
  %small = icmp slt i32 %place, -6
  %large = icmp sge i32 %place, 21
  %scientific = or i1 %small, %large
  br i1 %scientific, label %print.scientific, label %print.fixed

print.scientific:
  %first = load i8, ptr %text
  %digit = zext i8 %first to i32
  call void @gb.format.byte(ptr %output, ptr %length, i32 %digit)
  %fraction = icmp ugt i32 %count, 1
  br i1 %fraction, label %print.fraction, label %print.exponent

print.fraction:
  %tail = getelementptr i8, ptr %text, i32 1
  call void @gb.format.text(ptr %output, ptr %length, ptr @.float.fraction, ptr %tail)
  br label %print.exponent

print.exponent:
  %written = load i32, ptr %length
  %suffix = getelementptr i8, ptr %output, i32 %written
  %digits.length = call i32 (ptr, i64, ptr, ...) @snprintf(ptr %suffix, i64 8, ptr @.float.exponent, i32 %place)
  %total = add i32 %written, %digits.length
  ret i32 %total

print.fixed:
  %before.point = icmp sgt i32 %place, 0
  %start = select i1 %before.point, i32 %place, i32 0
  %one.past.last = sub i32 %place, %count
  %after.point = icmp slt i32 %one.past.last, -1
  %end = select i1 %after.point, i32 %one.past.last, i32 -1
  br label %fixed.digits

fixed.digits:
  %position = phi i32 [ %start, %print.fixed ], [ %next, %fixed.continue ]
  %index = sub i32 %place, %position
  %in.range = icmp ult i32 %index, %count
  br i1 %in.range, label %fixed.load, label %fixed.digit

fixed.load:
  %address = getelementptr i8, ptr %text, i32 %index
  %byte = load i8, ptr %address
  %character = zext i8 %byte to i32
  br label %fixed.digit

fixed.digit:
  %ch = phi i32 [ 48, %fixed.digits ], [ %character, %fixed.load ]
  call void @gb.format.byte(ptr %output, ptr %length, i32 %ch)
  %next = sub i32 %position, 1
  %done = icmp eq i32 %next, %end
  br i1 %done, label %fixed.end, label %fixed.check.point

fixed.check.point:
  %decimal.point = icmp eq i32 %position, 0
  br i1 %decimal.point, label %fixed.point, label %fixed.continue

fixed.point:
  call void @gb.format.byte(ptr %output, ptr %length, i32 46)
  br label %fixed.continue

fixed.continue:
  br label %fixed.digits

fixed.end:
  br label %finish

finish:
  %output.length = load i32, ptr %length
  ret i32 %output.length
}`;
