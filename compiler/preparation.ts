import { CompilerError, text } from '@cxl/gbc.sdk';
import { createOwnershipAnalysis } from './ownership.js';
import { childNodes } from './node.js';
import type { Node, NodeMap } from './node.js';
import { createSemanticContext, dataItems, dispatchArgType, itemValue, literalType, mergeValueTypes } from './semantic.js';
import { createSpecializationEnvironment, specializeType } from './specialization.js';
import type { SpecializationEnvironment } from './specialization.js';
import { BaseTypes, classifyEmission, fixedEmissionType, isFloatType, isInt64Type } from './symbol-table.js';
import type { ResolvedType, Symbol, SymbolMap, Type } from './symbol-table.js';

export type BackendNodeMap = {
	[K in keyof NodeMap]: NodeMap[K] extends { symbol: infer S } ? Omit<Readonly<NodeMap[K]>, 'symbol'> & { readonly symbol: Readonly<S> } : Readonly<NodeMap[K]>;
};
export type BackendNode = BackendNodeMap[keyof BackendNodeMap];

type ResolutionContext = Pick<ReturnType<typeof createSemanticContext>,
	| 'reduceType' | 'selectOverload'
	| 'scalarCtorType' | 'bufferCtorType' | 'resolveMemberType'
	| 'numericValueType' | 'resolveCallReturn' | 'callArgumentTypes'
	| 'pipeArgumentTypes' | 'threadCall' | 'fallbackResultType'
	| 'callTypeBindings' | 'functionTypeParameters' | 'resolver' | 'selectCallFunction'
>;

export interface ExpressionContext {
	readonly environment: SpecializationEnvironment;
	readonly inputType?: Type;
	readonly symbols?: ReadonlyMap<Symbol, Type>;
	readonly templates?: ReadonlyMap<Symbol, NodeMap['fn']>;
}

export interface PreparedProgram {
	readonly root: Readonly<Node>;
	readonly linkedRoot: Readonly<Node>;
	readonly createContext: () => ReturnType<typeof createPreparationContext>;
}

export type ProgramInput = { root: Node; prepared?: never } | { root?: never; prepared: PreparedProgram };

export function preparedInput(input: ProgramInput): PreparedProgram {
	return input.prepared ?? prepareProgram(input.root);
}

export type ThreadResolution = {
	readonly target: Readonly<SymbolMap['function']>;
	readonly output: Type;
	readonly classification: ReturnType<typeof classifyEmission>;
};

type ThreadOperation =
	| { readonly kind: 'bind'; readonly expression: Node; readonly reference: NodeMap['ident']; readonly type: Type }
	| { readonly kind: 'call'; readonly call: NodeMap['call'] };

export interface ThreadPlan {
	readonly operations: readonly ThreadOperation[];
	readonly result: Node;
	readonly type: Type;
}

export function prepareProgram(root: Node, definitions: readonly Node[] = []): PreparedProgram {
	const linkedRoot = root.kind === 'root' && definitions.length ? { ...root, children: [...definitions, ...root.children] } : root;
	return { root, linkedRoot, createContext: createPreparationContext };
}

function createPreparationContext() {
	const semantic: ResolutionContext = createSemanticContext(true);
	const { threadCall, fallbackResultType, reduceType, callTypeBindings, resolveCallReturn } = semantic;

	function typeOf(symbol: Readonly<Symbol>, environment: SpecializationEnvironment): Type {
		if (!environment.parent) return environment.types.get(symbol) ?? symbol.type ?? BaseTypes.Unknown;
		for (let scope: SpecializationEnvironment | undefined = environment; scope; scope = scope.parent) {
			const type = scope.types.get(symbol);
			if (type) return type;
		}
		return specializeType(symbol.type ?? BaseTypes.Unknown, environment.typeArguments, reduceType);
	}

	function emissionType(fn: Readonly<SymbolMap['function']>, bindings: Map<string, Type>) {
		const emission = fn.emissionType;
		if (emission?.family !== 'emission') return;
		if (!bindings.size) return emission;
		return {
			...emission,
			elements: emission.elements.map(type => specializeType(type, bindings, reduceType)),
			rest: emission.rest ? specializeType(emission.rest, bindings, reduceType) : undefined,
		};
	}

	function concreteType(value: Type, bindings: Map<string, Type>): Type {
		let type = specializeType(value, bindings, reduceType);
		if (type.kind === 'type' && (type.application || type.family === 'unknown')) {
			const reduced = reduceType(type, bindings);
			if (reduced.kind === 'type' && reduced.family !== 'unknown') type = reduced;
		}
		return type;
	}

	function functionResult(fn: Readonly<SymbolMap['function']>, bindings: Map<string, Type>) {
		return { type: concreteType(fn.returnType ?? BaseTypes.Unknown, bindings), emission: emissionType(fn, bindings) };
	}

	function resolveThreadCall(
		call: NodeMap['call'],
		resolveFunction: (node: Node) => SymbolMap['function'] | undefined,
		resolveType: (node: Node) => Type,
		select: ResolutionContext['selectOverload'],
		environment: SpecializationEnvironment,
	): ThreadResolution | undefined {
		const declared = resolveFunction(call.children[0]);
		if (!declared) return;
		const target = semantic.selectCallFunction(declared, call.children[1], resolveType, select) ?? declared;
		const argTypes = semantic.callArgumentTypes(target, call.children[1], resolveType);
		const specialized = emissionType(target, callTypeBindings(target, argTypes));
		const inferred = resolveCallReturn(target, argTypes, select, target.typeParams) ?? target.returnType ?? BaseTypes.Void;
		const output = inferred.kind === 'type' && inferred.family === 'unknown' ? reduceType(inferred, environment.typeArguments) : inferred;
		const emission = specialized ?? (output.kind === 'type' && output.family === 'void' ? fixedEmissionType([]) : fixedEmissionType([output]));
		return { target, classification: classifyEmission(emission), output: specialized?.elements[0] ?? output };
	}

	function prepareThread(
		node: NodeMap['->'],
		resolveType: (node: Node) => Type,
		resolveCall: (call: NodeMap['call']) => ThreadResolution | undefined,
	): ThreadPlan {
		const operations: ThreadOperation[] = [];
		let carrier: Node = node.children[0];
		let type = carrier.kind === ',' ? undefined : resolveType(carrier);
		let materialized = false;
		for (let i = 1; i < node.children.length; i++) {
			const stage = node.children[i];
			if (!stage || stage.kind !== 'call') continue;
			let call = threadCall(stage, carrier, i === 1);
			const resolved = resolveCall(call);
			if (!resolved) throw new CompilerError('Unable to resolve `->` stage', stage);
			const { cardinality, mayEmitVoid } = resolved.classification;
			if (cardinality === 'many') throw new CompilerError('`->` stage emits many values; use `>>` for a stream', stage);
			if (cardinality === 'zero' && !type) throw new CompilerError('`->` cannot retain an argument pack', stage);
			if (type && (cardinality === 'zero' || mayEmitVoid) && !materialized) {
				const reference: NodeMap['ident'] = {
					...carrier, kind: 'ident',
					symbol: { kind: 'variable', name: '__thread_carrier', flags: 0, type, ownership: 'own' },
				};
				operations.push({ kind: 'bind', expression: carrier, reference, type });
				carrier = reference;
				materialized = true;
				call = threadCall(stage, carrier, false);
			}
			if (cardinality === 'zero') {
				operations.push({ kind: 'call', call });
				continue;
			}
			carrier = mayEmitVoid && type ? { ...stage, kind: '??', children: [call, carrier] } : call;
			type = mayEmitVoid && type ? fallbackResultType(resolved.output, type) : resolved.output;
			materialized = false;
		}
		return { operations, result: carrier, type: type ?? BaseTypes.Unknown };
	}

	function functionTypeOf(symbol: Readonly<Symbol>, environment: SpecializationEnvironment): SymbolMap['function'] | undefined {
		if (symbol.kind === 'function') return symbol;
		const type = typeOf(symbol, environment);
		return type.kind === 'function' ? type : undefined;
	}

	function functionArgument(node: Node, environment: SpecializationEnvironment): SymbolMap['function'] | undefined {
		if (node.kind !== 'ident') return;
		const symbol = node.symbol;
		if (symbol.kind === 'function') return symbol;
		const bound = environment.bindings.get(symbol);
		if (bound) return bound;
		const type = functionTypeOf(symbol, environment);
		if (type) return type;
		const definition = symbol.definition;
		if (definition?.kind === 'def' && definition.value.kind === 'fn') return definition.value.symbol;
	}

	function staticMemberFunction(callee: Node, environment: SpecializationEnvironment): SymbolMap['function'] | undefined {
		if (callee.kind !== '.') return;
		const [receiver, field] = callee.children;
		if (receiver.kind !== 'ident' || field.kind !== 'ident') return;
		const type = typeOf(receiver.symbol, environment);
		if (type.kind !== 'type' || type.family !== 'data') return;
		const member = type.members[field.symbol.name ?? '']?.type;
		return member?.kind === 'function' ? member : undefined;
	}

	function resolveOverload(arms: SymbolMap['function'][], args: Type[], templates?: ExpressionContext['templates'], argumentsFor?: (fn: SymbolMap['function']) => Type[]) {
		return semantic.selectOverload(arms, args.map(dispatchArgType), arm => {
			if (arm.parameters?.length !== 1) return false;
			const template = templates?.get(arm);
			if (template) return !template.parameters?.[0]?.type;
			const parameter = arm.parameters[0]?.type;
			return !parameter || (parameter.kind === 'type' && parameter.family === 'unknown');
		}, argumentsFor ? candidate => argumentsFor(candidate).map(dispatchArgType) : undefined);
	}

	function stageInputType(stage: Node, environment: SpecializationEnvironment): ResolvedType | undefined {
		if (stage.kind !== 'fn' || stage.parameters?.length !== 1) return;
		const parameter = stage.parameters[0];
		if (!parameter) return;
		let type = typeOf(parameter.symbol, environment);
		if (type.kind !== 'type' && parameter.type?.kind === 'typeident') type = typeOf(parameter.type.symbol, environment);
		if (type.kind !== 'type') return;
		if (type.family === 'literal' || (type.family === 'data' && type.name !== '__data') ||
			type.family === 'int' || type.family === 'uint' || type.family === 'float' ||
			type.family === 'bool' || type.family === 'string' || type.family === 'vector') return type;
	}

	function flattenPipe(children: Node[]): Node[] {
		return children.flatMap(child => child.kind === '>>' ? flattenPipe(child.children) : [child]);
	}

	function valueFallbackType(left: Type, right: Type): Type {
		return semantic.fallbackResultType(left, right, true);
	}

	function threadResolution(call: NodeMap['call'], context: ExpressionContext) {
		return resolveThreadCall(call, callee => callee.kind === '.' ? staticMemberFunction(callee, context.environment) :
			functionArgument(callee, context.environment),
			child => expressionType(child, context), (arms, args, _catchAll, argumentsFor) => resolveOverload(arms, args, context.templates, argumentsFor), context.environment);
	}

	function inferIdentType(node: NodeMap['ident'], context: ExpressionContext): Type {
		const sym = node.symbol;
		if (sym.kind === 'literal') return typeOf(sym, context.environment);
		if (sym.kind === 'variable' || sym.kind === 'function')
			return context.symbols?.get(sym) ?? typeOf(sym, context.environment);
		return BaseTypes.Unknown;
	}

	function inferTypeConstructorCall(node: NodeMap['call'], context: ExpressionContext): Type {
		const callee = node.children[0];
		if (callee.kind !== 'typeident') return BaseTypes.Unknown;
		return semantic.bufferCtorType(node) ?? semantic.scalarCtorType(node, child => expressionType(child, context)) ?? typeOf(callee.symbol, context.environment);
	}

	function inferCallType(node: NodeMap['call'], context: ExpressionContext): Type {
		const callee = node.children[0];
		if (callee.kind === '.') {
			const sfn = staticMemberFunction(callee, context.environment);
			return sfn
				? inferFunctionReturn(
						sfn,
						semantic.callArgumentTypes(sfn, node.children[1], child => expressionType(child, context)),
						context,
					)
				: BaseTypes.Unknown;
		}
		if (callee.kind === 'typeident') return inferTypeConstructorCall(node, context);
		if (callee.kind !== 'ident') return BaseTypes.Unknown;
		const sym = callee.symbol;
		const bound = context.environment.bindings.get(sym);
		if (bound) return bound.returnType ?? BaseTypes.Void;
		const fnSym = functionTypeOf(sym, context.environment);
		if (!fnSym) return BaseTypes.Unknown;
		const template = context.templates?.get(sym);
		if (!template && !semantic.functionTypeParameters(fnSym).length && !fnSym.overloads?.length && fnSym.returnType)
			return inferFunctionReturn(fnSym, [], context);
		return inferFunctionReturn(
			fnSym,
			semantic.callArgumentTypes(fnSym, node.children[1], child => expressionType(child, context)),
			context,
			template?.typeParameters
				?.map(p => p.symbol.type)
				.filter((t): t is Type => !!t),
		);
	}

	function inferFunctionReturn(
		fnSym: SymbolMap['function'],
		args: Type[],
		context: ExpressionContext,
		templateTypeParams?: Type[],
	): Type {
		const result = resolveCallReturn(fnSym, args, (arms, types) => resolveOverload(arms, types, context.templates), templateTypeParams) ?? BaseTypes.Void;
		return result.kind === 'type' && result.family === 'unknown' ? reduceType(result, context.environment.typeArguments) : result;
	}

	function stageReturn(stage: Node, input: Type, context: ExpressionContext): Type {
		if (stage.kind === '|') return inferDispatchReturn(stage, input, context);
		if (stage.kind === '.') {
			const fnSym = staticMemberFunction(stage, context.environment);
			if (fnSym)
				return inferFunctionReturn(
					fnSym,
					semantic.pipeArgumentTypes(input, fnSym),
					context,
				);
		}
		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			const fnSym = functionTypeOf(sym, context.environment);
			if (fnSym)
				return inferFunctionReturn(
					fnSym,
					semantic.pipeArgumentTypes(input, fnSym),
					context,
					context.templates?.get(sym)
						?.typeParameters?.map(p => p.symbol.type)
						.filter((t): t is Type => !!t),
				);
		}
		if (stage.kind === 'fn') return stage.symbol.returnType ?? BaseTypes.Unknown;
		return BaseTypes.Unknown;
	}

	function inferDispatchReturn(stage: NodeMap['|'], input: Type, context: ExpressionContext): Type {
		let result: Type | undefined;
		const walk = (arm: Node): void => {
			if (arm.kind === '|') {
				walk(arm.children[0]);
				walk(arm.children[1]);
				return;
			}
			const armInput = stageInputType(arm, context.environment) ?? input;
			const armResult = stageReturn(arm, armInput, context);
			result = result ? mergeValueTypes(result, armResult) : armResult;
		};
		walk(stage);
		return result ?? BaseTypes.Unknown;
	}

	function inferPipeType(node: NodeMap['>>'], context: ExpressionContext): Type {
		const flat = flattenPipe(node.children);
		const first = flat[0];
		if (!first) return BaseTypes.Unknown;
		let output = expressionType(first, context);
		for (let i = 1; i < flat.length; i++) {
			const stage = flat[i];
			if (stage) output = stageReturn(stage, output, context);
		}
		return output;
	}

	function expressionType(node: Node, context: ExpressionContext): Type {
		const literal = literalType(node);
		if (literal) return dispatchArgType(literal);
		switch (node.kind) {
			case '$':
				return context.inputType ?? BaseTypes.Int32;
			case 'ident':
				return inferIdentType(node, context);
			case '+':
			case '-':
			case '*':
			case '/':
			case '%':
				return semantic.numericValueType(expressionType(node.children[0], context), expressionType(node.children[1], context));
			case '|':
			case '&':
			case '^':
			case '<:':
			case ':>':
			case '~': {
				const lt = expressionType(node.children[0], context);
				const c1 = node.children[1];
				const rt = c1 ? expressionType(c1, context) : lt;
				return isInt64Type(lt) || isInt64Type(rt)
					? BaseTypes.Int64
					: BaseTypes.Int32;
			}
			case '!':
				return BaseTypes.Bool;
			case 'negate': {
				const t = expressionType(node.children[0], context);
				return isFloatType(t) ? BaseTypes.Float64 : BaseTypes.Int32;
			}
			case '==':
			case '!=':
			case '<':
			case '>':
			case '<=':
			case '>=':
				return BaseTypes.Bool;
			case '||':
			case '&&':
				return expressionType(node.children[0], context);
			case '?':
				return expressionType(node.children[1], context);
			case '??':
				return valueFallbackType(
					expressionType(node.children[0], context),
					expressionType(node.children[1], context),
				);
			case '>>':
				return inferPipeType(node, context);
			case '->':
				return prepareThread(node, child => expressionType(child, context), call => threadResolution(call, context)).type;
			case 'call':
				return inferCallType(node, context);
			case '.': {
				const type = semantic.resolveMemberType(node, child => expressionType(child, context), false);
				return type === BaseTypes.Unknown ? BaseTypes.Int32 : type;
			}
			case 'data': {
				const nominal = nominalOf(node, context.environment);
				if (isTraceComposed(nominal)) return nominal;
				const items = dataItems(node).filter(it => {
					const value = itemValue(it);
					return !(value.kind === 'ident' && value.symbol.kind === 'function');
				});
				const first = items[0];
				if (
					items.length === 1 &&
					first &&
					!(first.kind === 'propdef' && first.label)
				)
					return expressionType(itemValue(first), context);
				const members: Record<string, Symbol> = {};
				items.forEach((it, i) => {
					const key =
						it.kind === 'propdef' && it.label ? text(it.label) : String(i);
					members[key] = {
						kind: 'variable',
						name: key,
						flags: 0,
						type: expressionType(itemValue(it), context),
					};
				});
				return {
					kind: 'type',
					flags: 0,
					name: '__data',
					family: 'data',
					size: 0,
					members,
				};
			}
			case 'next': {
				const v = node.children?.[0];
				return v ? expressionType(v, context) : BaseTypes.Void;
			}
			case 'break':
				return BaseTypes.Void;
			default:
				return BaseTypes.Unknown;
		}
	}

	function stampErrorData(node: Node | undefined, expected: Type | undefined, environment: SpecializationEnvironment, originFn?: string): void {
		if (!node || expected?.kind !== 'type') return;
		if (expected.family === 'union') {
			const member = expected.members.find(isTraceComposed);
			if (member) stampErrorData(node, member, environment, originFn);
		} else if (node.kind === 'data' && isTraceComposed(expected)) {
			(environment.annotations ??= new WeakMap()).set(node, { nominal: expected, originFn: originFn ?? originOf(node, environment) });
		} else if (node.kind === 'call') {
			const callee = node.children[0];
			if (callee.kind === 'typeident' && isTraceComposed(typeOf(callee.symbol, environment)) && originFn)
				(environment.annotations ??= new WeakMap()).set(node, { originFn });
		} else if (node.kind === 'next' || node.kind === '?') {
			for (const child of node.kind === '?' ? node.children.slice(1) : childNodes(node))
				stampErrorData(child, expected, environment, originFn);
		}
	}

	function composesTrace(type: Type): boolean {
		return type === BaseTypes.Trace || !!type.components?.some(composesTrace);
	}

	function isTraceComposed(type: Type | undefined): type is Extract<ResolvedType, { family: 'data' }> {
		return type?.kind === 'type' && type.family === 'data' && composesTrace(type);
	}

	function annotation(node: Node, environment: SpecializationEnvironment) {
		for (let scope: SpecializationEnvironment | undefined = environment; scope; scope = scope.parent) {
			const value = scope.annotations?.get(node);
			if (value) return value;
		}
		return undefined;
	}

	function nominalOf(node: NodeMap['data'], environment: SpecializationEnvironment): ResolvedType | undefined {
		return annotation(node, environment)?.nominal ?? node.nominal;
	}

	function originOf(node: NodeMap['call' | 'data'], environment: SpecializationEnvironment): string | undefined {
		return annotation(node, environment)?.originFn ?? node.originFn;
	}

	return {
		createOwnership: (root: Node, externalExports = false) => createOwnershipAnalysis(root, {
			typeOf, expressionType, emissionType, nominalOf, threadCall,
			threadResolution, staticMemberFunction, resolveOverload,
		}, externalExports),
		semantic, createEnvironment: createSpecializationEnvironment, typeOf,
		functionResult, concreteType, expressionType, stageReturn, stageInputType, functionTypeOf, functionArgument, staticMemberFunction, resolveOverload, threadResolution, valueFallbackType,
		emissionType, threadCall, resolveThreadCall, prepareThread,
		stampErrorData, nominalOf, originOf,
	};
}
