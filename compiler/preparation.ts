import { CompilerError } from '@cxl/gbc.sdk';
import { childNodes } from './node.js';
import type { Node, NodeMap } from './node.js';
import { createSemanticContext } from './semantic.js';
import { createSpecializationEnvironment, specializeType } from './specialization.js';
import type { SpecializationEnvironment } from './specialization.js';
import { BaseTypes, classifyEmission, fixedEmissionType } from './symbol-table.js';
import type { ResolvedType, Symbol, SymbolMap, Type } from './symbol-table.js';

export type BackendNodeMap = {
	[K in keyof NodeMap]: NodeMap[K] extends { symbol: infer S } ? Omit<Readonly<NodeMap[K]>, 'symbol'> & { readonly symbol: Readonly<S> } : Readonly<NodeMap[K]>;
};
export type BackendNode = BackendNodeMap[keyof BackendNodeMap];

type ResolutionContext = Pick<ReturnType<typeof createSemanticContext>,
	| 'reduceType' | 'isKnownNonZeroNumber' | 'selectOverload'
	| 'scalarCtorType' | 'bufferCtorType' | 'resolveMemberType'
	| 'numericValueType' | 'resolveCallReturn' | 'callArgumentTypes'
	| 'pipeArgumentTypes' | 'threadCall' | 'fallbackResultType'
	| 'callTypeBindings' | 'resolver'
>;

export interface PreparedProgram {
	readonly root: Readonly<Node>;
	readonly linkedRoot: Readonly<Node>;
	readonly createContext: () => ReturnType<typeof createPreparationContext>;
}

export type ProgramInput = { root: Node; prepared?: never } | { root?: never; prepared: PreparedProgram };

export function preparedInput(input: ProgramInput): PreparedProgram {
	return input.prepared ?? prepareProgram(input.root);
}

type ThreadResolution = {
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
	const returns = new Map<SymbolMap['function'], Type>();
	const { threadCall, fallbackResultType, reduceType, callTypeBindings, resolveCallReturn } = semantic;

	function typeOf(symbol: Readonly<Symbol>, environment: SpecializationEnvironment): Type {
		if (!environment.parent) return environment.types.get(symbol) ?? symbol.type ?? BaseTypes.Unknown;
		for (let scope: SpecializationEnvironment | undefined = environment; scope; scope = scope.parent) {
			const type = scope.types.get(symbol);
			if (type) return type;
		}
		return specializeType(symbol.type ?? BaseTypes.Unknown, environment.typeArguments, reduceType);
	}

	function returnType(fn: Readonly<SymbolMap['function']>): Type | undefined {
		return returns.get(fn) ?? fn.returnType;
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

	function resolveThreadCall(
		call: NodeMap['call'],
		resolveFunction: (node: Node) => SymbolMap['function'] | undefined,
		resolveType: (node: Node) => Type,
		select: (arms: SymbolMap['function'][], args: Type[]) => SymbolMap['function'] | undefined,
		environment: SpecializationEnvironment,
	): ThreadResolution | undefined {
		const declared = resolveFunction(call.children[0]);
		if (!declared) return;
		const raw = call.children[1];
		const argTypes = (raw?.kind === ',' ? raw.children : raw ? [raw] : []).map(resolveType);
		const target = select(declared.overloads ?? [], argTypes) ?? declared;
		const specialized = emissionType(target, callTypeBindings(target, argTypes));
		const inferred = resolveCallReturn(target, argTypes, select, target.typeParams) ?? returnType(target) ?? BaseTypes.Void;
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

	function isTraceComposed(type: Type): type is Extract<ResolvedType, { family: 'data' }> {
		return type.kind === 'type' && type.family === 'data' && composesTrace(type);
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
		semantic, createEnvironment: createSpecializationEnvironment, typeOf,
		returnType, setReturnType: (fn: SymbolMap['function'], type: Type): void => { returns.set(fn, type); },
		emissionType, threadCall, resolveThreadCall, prepareThread,
		stampErrorData, nominalOf, originOf,
	};
}
