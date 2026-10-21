import { CompilerError, type Position, text } from '@cxl/gbc.sdk';

import { childNodes } from './node.js';
import type { InfixNode, Node, NodeMap } from './node.js';
import {
	BaseTypes as BT,
	BufferSymbol,
	Flags,
	classifyEmission,
	isFloatType,
	isHeapType,
	isIntType,
	isNumericType,
	isVectorType,
} from './symbol-table.js';
import type {
	OwnershipMode,
	ResolvedType,
	Symbol,
	SymbolMap,
	Type,
} from './symbol-table.js';

import { argumentNodes, bindCallArguments, createSemanticContext, type BorrowOrigin } from './semantic.js';
export { setDivByZero, reduceType, isKnownNonZeroNumber } from './semantic.js';

/**
 * Perform semantic analysis
 */
export function checker({
	root,
	errors,
}: {
	root: Node;
	errors: CompilerError[];
}) {
	const {
		borrowOrigins,
		setNodeType,
		isInvalidType,
		literalFits,
		branchesFit,
		typeToStr,
		effectiveCallFunction,
		resolveFunctionStageReturn,
		callEmissionType,
		specializedCallEmission,
		threadCall,
		inferFnEmission,
		inferFnElementReturn,
		setFnForwarding,
		resolveFnType,
		dispatchArms,
		isConstCondition,
		resolveType,
		resolveMemberType,
		resolver,
		annotateDollar,
		isTypeParam,
		refsAny,
		canAssign,
		sameType,
		isVectorArithmetic,
		valueType,
		isUnusedValue,
		unusedValueMessage,
		unionOf,
		fallbackResultType,
		reduceType,
		callArgumentTypes,
		selectCallFunction,
		callTypeBindings,
	} = createSemanticContext();
	const outputOwnershipChecked = new Set<SymbolMap['function']>();
	const ownershipBlocks = new Set<NodeMap['fn' | 'main' | 'test']>();

	function checkEach(node: Node[]) {
		node.forEach(check);
	}

	function error(message: string, position: Position) {
		errors.push({ message, position });
	}

	function numberBinaryOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		check(left);
		check(right);
		const lt = resolver(left);
		const rt = resolver(right);
		if (isInvalidType(lt) || isInvalidType(rt)) return;
		if (isTypeParam(lt) || isTypeParam(rt)) return;
		if (isVectorType(lt) || isVectorType(rt)) {
			if (isVectorArithmetic(node.kind, lt, rt)) return;
			error(
				`Operator "${node.kind}" cannot be applied to types "${typeToStr(lt)}" and "${typeToStr(rt)}".`,
				left,
			);
			return;
		}
		if (!(isNumericType(lt) && isNumericType(rt))) {
			errors.push({
				message: `Operator "${
					node.kind
				}" cannot be applied to types "${typeToStr(
					lt,
				)}" and "${typeToStr(rt)}".`,
				position: left,
			});
		}
		if (node.kind === '%' && (isFloatType(lt) || isFloatType(rt)))
			error('modulo requires integer operands', left);
		if (
			(node.kind === '/' || node.kind === '%') &&
			right.kind === 'number' &&
			right.value === 0
		)
			error(
				`${node.kind === '%' ? 'modulo' : 'division'} by zero`,
				right,
			);
	}

	function bitwiseOperator(node: InfixNode) {
		const left = node.children[0];
		const right = node.children[1];
		const lt = resolver(left);
		const rt = resolver(right);
		if (isTypeParam(lt) || isTypeParam(rt)) return;
		const bad = (t: Type) =>
			t.kind === 'type' && t.family !== 'unknown' && !isIntType(t);
		if (bad(lt) || bad(rt))
			error(`Operator "${node.kind}" requires integer operands`, left);
	}

	/**
	 * The `check` function performs semantic analysis on a node by exploring its structure and applying various checks
	 * based on its kind. Each case handles a specific node kind, ensuring that the proper validation and type-resolution
	 * operations are performed. Depending on the node kind, it might resolve types, validate parameters, and enforce
	 * correct usage of operations and calls.
	 */
	function checkNext(node: NodeMap['next']) {
		const val = node.children?.[0];
		if (val) {
			if (val.kind === ',') for (const c of val.children) check(c);
			else check(val);
		}
	}

	function checkCallArgs(
		chosen: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
		argNodes: readonly (Node | undefined)[],
	) {
		const params = chosen.parameters;
		if (!params?.length) return;
		const bindings = callTypeBindings(chosen, argTypes);

		for (let i = 0; i < argTypes.length; i++) {
			const typeA = argTypes[i];
			const parameterType = params[i]?.type;
			if (!typeA || !parameterType) continue;
			const typeB = reduceType(parameterType, bindings);
			if (literalFits(argNodes[i], typeB)) continue;
			if (!canAssign(typeB, typeA))
				error(
					`Argument of type "${typeToStr(
						typeA,
					)}" is not assignable to parameter of type "${typeToStr(
						typeB,
					)}".`,
					node,
				);
		}
	}

	function contextualFunctionType(
		type: SymbolMap['function'],
		bindings: Map<string, Type>,
	): SymbolMap['function'] {
		const emissionType = type.emissionType
			? reduceType(type.emissionType, bindings)
			: undefined;
		return {
			...type,
			parameters: type.parameters?.map(parameter => ({
				...parameter,
				type: parameter.type
					? reduceType(parameter.type, bindings)
					: undefined,
			})),
			returnType: type.returnType
				? reduceType(type.returnType, bindings)
				: undefined,
			emissionType:
				emissionType?.kind === 'type' ? emissionType : undefined,
			returnTypes: type.returnTypes?.map(returnType =>
				reduceType(returnType, bindings),
			),
			returnVariants: type.returnVariants?.map(variant =>
				variant.map(returnType => reduceType(returnType, bindings)),
			),
		};
	}

	function contextualizeCallBlocks(
		fn: SymbolMap['function'],
		args: readonly (Node | undefined)[],
	): void {
		if (fn.overloads) return;
		const provisional = args.map(arg =>
			!arg || arg.kind === 'fn' ? BT.Unknown : resolver(arg),
		);
		const bindings = callTypeBindings(fn, provisional);
		args.forEach((arg, index) => {
			if (!arg || arg.kind !== 'fn' || arg.parameters?.length) return;
			const expected = fn.parameters?.[index]?.type;
			if (expected?.kind !== 'function') return;
			const context = contextualFunctionType(expected, bindings);
			if (context.parameters?.length !== 1) return;
			const expectedParameter = context.parameters[0];
			if (!expectedParameter?.type) return;
			const symbol: SymbolMap['variable'] = {
				kind: 'variable',
				name: '',
				flags: 0,
				type: expectedParameter.type,
				ownership: expectedParameter.ownership,
			};
			const parameter: NodeMap['parameter'] = {
				...arg,
				kind: 'parameter',
				children: [undefined, undefined, undefined],
				symbol,
			};
			arg.parameters = [parameter];
			arg.children.unshift(parameter);
			arg.symbol.parameters = [symbol];
			arg.symbol.returnOwnership = context.returnOwnership;
			for (const statement of arg.statements ?? [])
				annotateDollar(statement, expectedParameter.type);
			if (
				!arg.returnType &&
				!arg.returnTypes &&
				!arg.returnRestType &&
				!arg.returnVariants
			) {
				arg.symbol.returnType = undefined;
				arg.symbol.returnTypes = undefined;
				arg.symbol.returnOwnerships = undefined;
				arg.symbol.emissionType = undefined;
			}
			resolver(arg);
		});
	}

	/** Default ctor: `T(x)` where `x` is T's own structural value; field-less
	 * errors take Void (`T()`), field-less plain types have no value at all. */
	function checkDataCtorArg(
		target: ResolvedType & { family: 'data' },
		node: NodeMap['call'],
	) {
		const visible = Object.keys(target.members).filter(
			k => k !== '__trace',
		);
		const args = node.children[1];
		if (visible.length === 0) {
			if (args)
				error(
					`"${target.name}" has no fields — its constructor takes no value`,
					node,
				);
			return;
		}
		if (!args) {
			error(
				`"${target.name}(…)" requires its structural value: [ ${visible[0]} = … ]`,
				node,
			);
			return;
		}
		const at = resolver(args);
		if (
			at.kind === 'type' &&
			at.family !== 'unknown' &&
			!canAssign(target, at)
		)
			error(
				`Type "${typeToStr(at)}" is not assignable to "${target.name}"`,
				node,
			);
	}

	function checkBufferCtorArg(
		node: NodeMap['call'],
	) {
		const args = node.children[1];
		if (!args || args.kind === ',') {
			error(`Buffer<T>(capacity) takes a single Int32 capacity`, node);
			return;
		}
		const at = resolver(args);
		if (at.kind === 'type' && at.family !== 'unknown' && !isIntType(at))
			error(`Buffer capacity must be an Int32`, node);
	}

	function validateVectorType(type: Type, node: Node): void {
		if (type.kind === 'function') {
			for (const parameter of type.parameters ?? [])
				if (parameter.type) validateVectorType(parameter.type, node);
			if (type.returnType) validateVectorType(type.returnType, node);
			return;
		}
		if (type.family === 'buffer') {
			validateVectorType(type.elem, node);
			return;
		}
		if (type.family === 'data') {
			for (const member of Object.values(type.members))
				if (member.type) validateVectorType(member.type, node);
			return;
		}
		if (type.family === 'union') {
			for (const member of type.members) validateVectorType(member, node);
			return;
		}
		if (!isVectorType(type)) return;
		if (!sameType(type.elem, BT.Float32))
			error(
				`Type argument "${typeToStr(type.elem)}" does not satisfy Vector element constraint "Float32"`,
				node,
			);
	}

	function checkVectorCtorArg(
		target: Extract<ResolvedType, { family: 'vector' }>,
		node: NodeMap['call'],
	): void {
		validateVectorType(target, node.children[0]);
		const raw = node.children[1];
		const args = raw?.kind === ',' ? raw.children : raw ? [raw] : [];
		for (const arg of args) check(arg);
		if (args.length === 1) {
			const argument = args[0];
			const actual = argument ? resolver(argument) : BT.Unknown;
			if (!isNumericType(actual))
				error(
					`Vector<${typeToStr(target.elem)}> splat requires a numeric scalar`,
					argument ?? node,
				);
			return;
		}
		if (args.length === 2) {
			const buffer = args[0];
			const index = args[1];
			const bufferType = buffer ? resolver(buffer) : BT.Unknown;
			const indexType = index ? resolver(index) : BT.Unknown;
			if (
				bufferType.kind !== 'type' ||
				bufferType.family !== 'buffer' ||
				!sameType(bufferType.elem, target.elem)
			)
				error(
					`Vector<${typeToStr(target.elem)}> load requires Buffer<${typeToStr(target.elem)}>`,
					buffer ?? node,
				);
			if (!isIntType(indexType))
				error('Vector load index must be an Int32', index ?? node);
			return;
		}
		error(
			`Vector<${typeToStr(target.elem)}>(…) requires one scalar or a buffer and index`,
			node,
		);
	}

	function checkScalarCtorArg(target: Type, node: NodeMap['call']) {
		if (target.kind !== 'type' || !isNumericType(target)) return;
		const args = node.children[1];
		if (!args) {
			error(`"${target.name}" requires a numeric argument`, node);
			return;
		}
		if (args.kind === ',') {
			error(`"${target.name}" takes a single numeric value`, node);
			return;
		}
		const at = resolver(args);
		if (at.kind === 'type' && at.family !== 'unknown' && !isNumericType(at))
			error(
				`Cannot convert "${typeToStr(at)}" to "${target.name}"`,
				node,
			);
	}

	function checkRedundantCtor(
		target: ResolvedType,
		node: NodeMap['call'],
	): void {
		if (target.family === 'buffer') return;
		const args = node.children[1];
		if (!args || args.kind === ',') return;
		const argument = resolver(args);
		if (argument !== target) return;
		error(
			`Redundant type constructor \`${target.name}\`; the argument is already \`${target.name}\`.`,
			node,
		);
	}

	type CheckedCall = {
		fn: SymbolMap['function'];
		chosen: SymbolMap['function'];
		argTypes: Type[];
	};

	function checkArgumentCalls(node: Node): void {
		if (node.kind === 'call' && node.children[0].kind !== 'typeident') {
			checkCall(node);
			return;
		}
		if (node.kind === 'fn') return;
		for (const child of childNodes(node))
			if (child) checkArgumentCalls(child);
	}

	function checkCall(
		node: NodeMap['call'],
		threadArgCount = 0,
	): CheckedCall | undefined {
		const calleeNode = node.children[0];
		const fn = resolveType(calleeNode);
		if (calleeNode.kind === 'typeident') {
			if (fn?.kind === 'type' && fn.family !== 'fn') {
				checkRedundantCtor(fn, node);
				if (calleeNode.symbol === BufferSymbol) {
					error(
						`Buffer requires a type argument: Buffer<T>(capacity)`,
						node,
					);
				} else if (fn.family === 'buffer') checkBufferCtorArg(node);
				else if (fn.family === 'vector') checkVectorCtorArg(fn, node);
				else if (fn.family === 'data') checkDataCtorArg(fn, node);
				else checkScalarCtorArg(fn, node);
				return;
			}
			error(`This expression is not callable`, node);
			return;
		}
		if (fn?.kind !== 'function') {
			error(`This expression is not callable`, node);
			return;
		}

		const args = node.children[1];
		const chosen = selectCallFunction(fn, args);
		if (!chosen) {
			error(`No matching overload for ${fn.name ?? '?'}(${argumentNodes(args).map(arg => typeToStr(resolver(arg))).join(', ')})`, node);
			return;
		}
		const bound = bindCallArguments(chosen.parameters ?? [], argumentNodes(args));
		for (const diagnostic of bound.errors) error(diagnostic.message, diagnostic.position ?? node);
		if (bound.errors.length) return;
		contextualizeCallBlocks(chosen, bound.arguments);
		for (const arg of bound.arguments.slice(threadArgCount))
			if (arg) checkArgumentCalls(arg);
		const argTypes = callArgumentTypes(chosen, args);
		if (argTypes.some(isTypeParam)) return;
		checkTypeArgConstraints(chosen, argTypes, node);
		checkCallArgs(chosen, argTypes, node, bound.arguments);
		checkMutableCallArgs(chosen, node, bound.arguments, threadArgCount);
		return { fn, chosen, argTypes };
	}

	function checkThread(node: NodeMap['->']): void {
		let carrier: Node = node.children[0];
		check(carrier);
		let carrierType: Type | undefined =
			carrier.kind === ',' ? undefined : resolver(carrier);
		for (let i = 1; i < node.children.length; i++) {
			const stage = node.children[i];
			if (!stage || stage.kind !== 'call') continue;
			const spreadCarrier = i === 1;
			const call = threadCall(stage, carrier, spreadCarrier);
			const threadArgCount =
				spreadCarrier && carrier.kind === ',' ? carrier.children.length : 1;
			const resolved = checkCall(call, threadArgCount);
			if (!resolved) continue;
			const emission = specializedCallEmission(
				resolved.chosen,
				resolved.argTypes,
			);
			if (!emission) continue;
			const classification = classifyEmission(emission);
			if (classification.cardinality === 'many') {
				error('`->` stage emits many values; use `>>` for a stream', stage);
				continue;
			}
			if (classification.cardinality === 'zero') {
				if (!carrierType) {
					error('`->` cannot retain a comma-separated argument pack', stage);
					continue;
				}
				if (
					(resolved.chosen.parameters ?? [])
						.slice(0, threadArgCount)
						.some(parameter => parameter.ownership === 'own')
				)
					error('an `own` thread stage cannot retain a consumed carrier', stage);
				continue;
			}
			const output = emission.elements[0] ?? BT.Unknown;
			carrierType =
				classification.mayEmitVoid && carrierType
					? fallbackResultType(output, carrierType)
					: output;
			carrier = call;
			setNodeType(carrier, carrierType);
		}
	}

	function referencesSymbol(node: Node, symbol: Symbol): boolean {
		if (node.kind === 'ident') return bindingRoot(node.symbol) === symbol;
		return childNodes(node).some(
			child => !!child && referencesSymbol(child, symbol),
		);
	}

	function bindingRoot(symbol: Symbol): Symbol {
		const definition = symbol.definition;
		return definition?.kind === 'def' && definition.value.kind === 'ident'
			? bindingRoot(definition.value.symbol)
			: symbol;
	}

	function mutableSymbol(symbol: SymbolMap['variable']): boolean {
		return (
			symbol.ownership === 'var' ||
			symbol.ownership === 'own' ||
			(symbol.definition?.kind === 'def' && ownedHere(symbol.definition))
		);
	}

	function mutableArgRoot(arg: Node | undefined, node: Node): Symbol | undefined {
		const position = arg;
		while (arg?.kind === '.') arg = arg.children[0];
		if (!arg || arg.kind !== 'ident' || arg.symbol.kind !== 'variable') {
			error('a `var` parameter requires a mutable binding', position ?? node);
			return;
		}
		if (mutableSymbol(arg.symbol)) return arg.symbol;
		error(`cannot mutably borrow shared binding "${arg.symbol.name}"`, arg);
	}

	function checkThreadMutableArg(arg: Node | undefined, node: Node): void {
		const mode = arg ? expressionOwnership(arg) : undefined;
		if (mode !== 'own' && mode !== 'var')
			error('a `var` thread stage requires a mutable carrier', arg ?? node);
	}

	function checkMutableCallArgs(
		fn: SymbolMap['function'],
		node: NodeMap['call'],
		args: readonly (Node | undefined)[],
		threadArgCount = 0,
	): void {
		const roots = new Map<Symbol, number>();
		for (let i = 0; i < args.length; i++) {
			if (fn.parameters?.[i]?.ownership !== 'var') continue;
			const arg = args[i];
			if (i < threadArgCount) {
				checkThreadMutableArg(arg, node);
				continue;
			}
			const root = mutableArgRoot(arg, node);
			if (!root) continue;
			const previous = roots.get(root);
			if (previous !== undefined)
				error(
					`mutable borrow of "${root.name ?? ''}" overlaps another argument`,
					arg ?? node,
				);
			else roots.set(root, i);
		}
		for (const [symbol, mutableIndex] of roots)
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				if (
					i !== mutableIndex &&
					arg &&
					!isCopyType(resolver(arg)) &&
					referencesSymbol(arg, symbol)
				)
					error(
						`mutable borrow of "${symbol.name ?? ''}" overlaps argument ${i + 1}`,
						arg,
					);
			}
	}

	function checkTypeArgConstraints(
		chosen: SymbolMap['function'],
		argTypes: Type[],
		node: NodeMap['call'],
	) {
		const fnNode =
			chosen.definition?.kind === 'fn' ? chosen.definition : undefined;
		const tparams = fnNode?.typeParameters;
		if (!tparams?.length) return;
		const subst = callTypeBindings(chosen, argTypes);
		for (const tp of tparams) {
			if (!tp.type) continue;
			const constraint = resolveType(tp.type);
			const bound = tp.symbol.name ? subst.get(tp.symbol.name) : undefined;
			if (constraint && bound && !canAssign(constraint, bound))
				error(
					`Type argument "${typeToStr(
						bound,
					)}" does not satisfy constraint "${typeToStr(
						constraint,
					)}" for type parameter "${tp.symbol.name}"`,
					node,
				);
		}
	}

	function checkDispatch(
		dt: SymbolMap['function'] | undefined,
		node: Node,
	): void {
		if (!dt?.overloads) return;
		const ovs = dt.overloads;
		const rts = ovs.map(o => o.returnType ?? BT.Void);
		const first = rts[0];
		const uniformOrVoidMutator =
			first &&
			ovs.every((arm, i) => {
				const result = rts[i];
				return !!result && (
					(arm.parameters?.[0]?.ownership === 'var' &&
						result.kind === 'type' &&
						result.family === 'void') ||
					isTypeParam(first) ||
					isTypeParam(result) ||
					(canAssign(first, result) && canAssign(result, first))
				);
			});
		const widthPreserving = ovs.every(arm => {
			const input = arm.parameters?.[0]?.type;
			const output = arm.returnType;
			return (
				input &&
				output &&
				canAssign(input, output) &&
				canAssign(output, input)
			);
		});
		if (!uniformOrVoidMutator && !widthPreserving) {
			error('overload arms must return the same type', node);
			return;
		}
		const ins = ovs.map(o => o.parameters?.[0]?.type);
		for (let i = 0; i < ins.length; i++)
			for (let j = 0; j < i; j++) {
				const a = ins[j];
				const b = ins[i];
				if (a && b && canAssign(a, b)) {
					error(
						'ambiguous overload: two arms accept the same input type',
						node,
					);
					return;
				}
			}
	}

	function checkDispatchDef(node: Node): void {
		const dt = resolveType(node);
		checkDispatch(dt?.kind === 'function' ? dt : undefined, node);
	}

	function checkDef(node: NodeMap['def']) {
		const sym = node.symbol;
		resolver(node);
		if (node.value.kind === '|') checkDispatchDef(node.value);
		if (node.type) {
			const declared = resolveType(node.type);
			const vt = valueType(node.value);
			if (
				!(sym.flags & Flags.Variable) &&
				declared &&
				vt &&
				sameType(declared, vt)
			)
				error(
					`Redundant type annotation \`${typeToStr(declared)}\`; the initializer is already \`${typeToStr(vt)}\`.`,
					node.type,
				);
			if (
				declared &&
				vt &&
				!canAssign(declared, vt) &&
				!literalFits(node.value, declared)
			)
				error(
					`Type "${typeToStr(vt)}" is not assignable to declared type "${typeToStr(declared)}"`,
					node,
				);
		}
		const usedExternally = sym.references?.some(
			r => r.start < node.start || r.start >= node.end,
		);
		if (!usedExternally && !(sym.flags & Flags.Export))
			error(
				`"${sym.name}" is declared but never used`,
				node.label,
			);
		check(node.value);
	}

	function checkAssign(node: NodeMap['=']) {
		const left = node.children[0];
		if (left.kind === 'ident')
			error(`Cannot reassign binding "${left.symbol.name ?? ''}"`, left);
		check(node.children[1]);
	}

	function checkReturnTypeAssignable(node: NodeMap['fn']) {
		const ret = node.symbol.returnType;
		if (node.typeParameters?.length || !ret || node.statements?.length !== 1)
			return;
		const statement = node.statements[0];
		const stmt =
			statement?.kind === 'next' ? statement.children?.[0] : statement;
		if (
			!stmt ||
			stmt.kind === 'done' ||
			stmt.kind === 'break'
		)
			return;
		const t = resolveType(stmt);
		if (
			t &&
			!isTypeParam(t) &&
			!canAssign(ret, t) &&
			!branchesFit(stmt, ret)
		)
			error(
				`Type "${typeToStr(t)}" is not assignable to return type "${typeToStr(ret)}"`,
				stmt,
			);
	}

	function checkRestEmissions(
		node: NodeMap['fn'],
		actual: Type[],
		emission: ResolvedType | undefined,
	): boolean {
		if (emission?.family !== 'emission') return false;
		const rest = emission.rest;
		if (!rest) return false;
		if (actual.length < emission.elements.length) {
			error(
				`function declares at least ${emission.elements.length} emissions but produces ${actual.length}`,
				node,
			);
			return true;
		}
		for (let i = 0; i < actual.length; i++) {
			const expected = emission.elements[i] ?? rest;
			const found = actual[i];
			if (found && !canAssign(expected, found))
				error(
					`emission ${i + 1} has type "${typeToStr(found)}", expected "${typeToStr(expected)}"`,
					node,
				);
		}
		return true;
	}

	function hasDeclaredEmissions(node: NodeMap['fn']): boolean {
		return !!(
			node.returnType ||
			node.returnTypes ||
			node.returnRestType ||
			node.returnVariants
		);
	}

	function checkDeclaredEmissions(node: NodeMap['fn']) {
		if (!hasDeclaredEmissions(node)) return;
		if (node.typeParameters?.length) return;
		if (node.statements?.some(statement => statement.kind === 'break')) return;
		const declared = node.symbol.returnTypes ?? [];
		const actualEmission = inferFnEmission(node);
		if (!actualEmission) return;
		const emission = node.symbol.emissionType;
		if (actualEmission.rest) {
			if (emission && !canAssign(emission, actualEmission))
				error(
					`function output type "${typeToStr(actualEmission)}" is not assignable to declared type "${typeToStr(emission)}"`,
					node,
				);
			return;
		}
		const actual = actualEmission.elements;
		if (checkRestEmissions(node, actual, emission)) return;
		if (node.returnVariants) {
			const matches = node.symbol.returnVariants?.some(
				variant =>
					variant.length === actual.length &&
					variant.every((type, index) => {
						const emitted = actual[index];
						return !!emitted && canAssign(type, emitted);
					}),
			);
			if (!matches)
				error('function output does not match any declared emission signature', node);
			return;
		}
		if (declared.length !== actual.length) {
			error(
				declared.length === 0
					? `function declares no emissions but produces ${actual.length}`
					: `function declares ${declared.length} emissions but produces ${actual.length}`,
				node,
			);
			return;
		}
		if (!node.returnTypes) return;
		for (let i = 0; i < declared.length; i++) {
			const expected = declared[i];
			const found = actual[i];
			if (expected && found && !canAssign(expected, found))
				error(
					`emission ${i + 1} has type "${typeToStr(found)}", expected "${typeToStr(expected)}"`,
					node,
				);
		}
	}

	function checkNoClosureCapture(node: NodeMap['fn']) {
		const bindings = new Set<Symbol>();
		node.parameters?.forEach(p => bindings.add(p.symbol));
		node.statements?.forEach(s => {
			if (s.kind === 'def') bindings.add(s.symbol);
		});
		if (!bindings.size) return;
		node.statements?.forEach(s => {
			const emitted =
				s.kind === 'fn'
					? s
					: s.kind === 'next' && s.children?.[0]?.kind === 'fn'
						? s.children[0]
						: undefined;
			if (emitted && refsAny(emitted, bindings))
				error(
					'function captures an enclosing binding; closures are not allowed',
					emitted,
				);
		});
	}

	function checkUnusedStatements(statements: Node[]) {
		for (const s of statements) {
			if (
				s.kind === 'next' ||
				s.kind === 'done' ||
				s.kind === 'break' ||
				s.kind === 'def' ||
				s.kind === '=' ||
				s.kind === 'import' ||
				s.kind === 'comment'
			)
				continue;
			const t = resolver(s);
			if (isUnusedValue(t)) error(unusedValueMessage(t), s);
		}
	}

	function nestedFunctionReferences(node: Node, symbol: Symbol): boolean {
		if (node.kind === 'fn') return referencesSymbol(node, symbol);
		return childNodes(node).some(
			child => !!child && nestedFunctionReferences(child, symbol),
		);
	}

	function isCopyType(type: Type): boolean {
		if (type.kind !== 'type') return false;
		if (type.family === 'union') return type.members.every(isCopyType);
		return (
			type.family === 'int' ||
			type.family === 'uint' ||
			type.family === 'float' ||
			type.family === 'char' ||
			type.family === 'bool' ||
			type.family === 'void' ||
			type.family === 'literal'
		);
	}

	function referencesNonCopyBinding(node: Node, ignored: Symbol): boolean {
		if (node.kind === '$') return !isCopyType(resolver(node));
		if (
			node.kind === 'ident' &&
			node.symbol !== ignored &&
			node.symbol.kind === 'variable' &&
			(node.symbol.definition?.kind === 'def' ||
				node.symbol.definition?.kind === 'parameter')
		)
			return !isCopyType(resolver(node));
		return childNodes(node).some(
			child => !!child && referencesNonCopyBinding(child, ignored),
		);
	}

	function checkRedundantIntermediates(statements: Node[]): void {
		for (let i = 0; i < statements.length - 1; i++) {
			const statement = statements[i];
			const next = statements[i + 1];
			if (
				statement?.kind !== 'def' ||
				!next ||
				statement.symbol.flags & Flags.Variable ||
				!isCopyType(resolver(statement))
			)
				continue;
			const references = statement.symbol.references ?? [];
			if (
				references.length === 0 ||
				!references.every(
					reference =>
						reference.source === next.source &&
						reference.start >= next.start &&
						reference.end <= next.end,
				) ||
				nestedFunctionReferences(next, statement.symbol) ||
				referencesNonCopyBinding(next, statement.symbol)
			)
				continue;
			error(
				`Redundant intermediate binding "${statement.symbol.name}"; pipe its initializer into the following statement.`,
				statement,
			);
		}
	}

	function checkUnusedValues(node: NodeMap['fn']) {
		if (!node.statements) return;
		for (const s of node.statements) {
			if (
				s.kind === 'next' ||
				s.kind === 'done' ||
				s.kind === 'break' ||
				s.kind === 'def' ||
				s.kind === '=' ||
				s.kind === 'comment'
			)
				continue;
			const t = resolver(s);
			if (isUnusedValue(t)) error(unusedValueMessage(t), s);
		}
	}

	// Ownership: `next` of a value created here (owned heap value) moves it;
	// use after is an error. `next` of a param/borrow emits a reference and
	// `b = a` borrows — neither moves. Scalars/interned literals are Copy.
	// Embedding an owned local in a labeled data literal moves it into the
	// record — the name stays readable as a borrow of the record until the
	// record itself moves. Records own their members, so a member may be an
	// owned local, a fresh value, or a static literal — never a borrow, and
	// never the same value twice.
	function ownedHere(def: NodeMap['def']): boolean {
		const v = def.value;
		if (v.kind === 'ident') return false;
		const mode = expressionOwnership(v);
		return mode !== 'borrow' && mode !== 'var' && isHeapType(resolver(v));
	}
	type Move = {
		position: Position;
		context: string;
	};

	function moveLocation(position: Position): string {
		const lineStart = position.source.lastIndexOf('\n', position.start - 1);
		return `line ${position.line + 1}, column ${position.start - lineStart}`;
	}

	function flagMovedUses(
		n: Node,
		moved: Map<Symbol, Move>,
		borrowed?: Map<BorrowOrigin, ReadonlySet<Symbol>>,
	): void {
		if (n.kind === 'ident') {
			const move = moved.get(n.symbol);
			if (move)
				error(
					`"${n.symbol.name ?? ''}" used after move ${move.context} at ${moveLocation(move.position)}`,
					n,
				);
			else {
				const owner = [...(borrowed?.get(n.symbol) ?? [])].find(root => moved.has(root));
				const ownerMove = owner && moved.get(owner);
				if (owner && ownerMove)
					error(
						`"${n.symbol.name ?? ''}" used after its value moved with "${owner.name ?? ''}" ${ownerMove.context} at ${moveLocation(ownerMove.position)}`,
						n,
					);
			}
			return;
		}
		if (n.kind === 'fn' || n.kind === 'main' || n.kind === 'test') return;
		for (const k of childNodes(n)) {
				if (k) flagMovedUses(k, moved, borrowed);
		}
	}
	function walkEmbeds(
		value: Node,
		seen: Set<Symbol>,
		owned: Set<Symbol>,
		borrowed: Map<BorrowOrigin, ReadonlySet<Symbol>>,
		onMove: (sym: Symbol, position: Position) => void,
	): void {
		if (value.kind !== 'data') return;
		const inner = value.children[0];
		const items = !inner
			? []
			: inner.kind === ','
				? inner.children
				: [inner];
		// A single unlabeled non-nominal block collapses to its value — an
		// alias, not a fresh record; nothing is embedded.
		if (items.length === 1 && items[0]?.kind !== 'propdef' && !value.nominal)
			return;
		for (const item of items) {
			const v = item.kind === 'propdef' ? item.value : item;
			if (!v) continue;
			if (v.kind === 'data') {
				walkEmbeds(v, seen, owned, borrowed, onMove);
				continue;
			}
			if (v.kind !== 'ident') continue;
			const t = resolver(v);
			if (!isHeapType(t)) continue;
			const name = v.symbol.name ?? '';
			if (seen.has(v.symbol)) {
				error(
					`"${name}" is embedded twice — a record member owns its value`,
					v,
				);
				continue;
			}
			seen.add(v.symbol);
			if (owned.has(v.symbol)) {
				onMove(v.symbol, v);
				continue;
			}
			error(
				`cannot embed borrowed "${name}" — record members own their values`,
				v,
			);
		}
	}

	function consumingMove(
		node: NodeMap['call'],
		fn: SymbolMap['function'],
		index: number,
		position: Position,
	): Move {
		const parameter = fn.parameters?.[index];
		const parameterName = parameter?.name
			? `"${parameter.name}"`
			: `${index + 1}`;
		const callee = node.children[0];
		const name =
			fn.name ?? (callee.kind === 'ident' ? callee.symbol.name : undefined);
		const functionName = name ? ` of "${name}"` : '';
		return {
			position,
			context: `into \`own\` parameter ${parameterName}${functionName}`,
		};
	}

	function markCallMoves(
		node: NodeMap['call'],
		owned: Set<Symbol>,
		moved: Map<Symbol, Move>,
	): void {
		const fn = effectiveCallFunction(node);
		if (!fn) return;
		const args = bindCallArguments(fn.parameters ?? [], argumentNodes(node.children[1])).arguments;
		const seenExclusive = new Set<Symbol>();
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const mode = fn.parameters?.[i]?.ownership;
			if (!arg || (arg.kind !== 'ident' && mode !== 'own')) continue;
			const type = resolver(arg);
			const heap = isHeapType(type);
			if (!heap) continue;
			if (arg.kind !== 'ident') {
				const ownership = expressionOwnership(arg);
				if (ownership === 'borrow' || ownership === 'var')
					error('cannot move borrowed result into an `own` parameter', arg);
				continue;
			}
			if (mode === 'own') {
				if (seenExclusive.has(arg.symbol))
					error(
						`"${arg.symbol.name ?? ''}" is passed to conflicting ownership slots`,
						arg,
					);
				seenExclusive.add(arg.symbol);
			}
			if (mode !== 'own') continue;
			if (!owned.has(arg.symbol))
				error(
					`cannot move borrowed "${arg.symbol.name ?? ''}" into an \`own\` parameter`,
					arg,
				);
			else moved.set(arg.symbol, consumingMove(node, fn, i, arg));
		}
	}

	function markConsumingMoves(
		n: Node,
		owned: Set<Symbol>,
		moved: Map<Symbol, Move>,
	): void {
		if (n.kind === 'fn' || n.kind === 'main' || n.kind === 'test') return;
		if (n.kind === '->') {
			let carrier: Node = n.children[0];
			markConsumingMoves(carrier, owned, moved);
			for (let i = 1; i < n.children.length; i++) {
				const stage = n.children[i];
				if (!stage || stage.kind !== 'call') continue;
				const call = threadCall(stage, carrier, i === 1);
				markCallMoves(call, owned, moved);
				const args = stage.children[1];
				if (args) markConsumingMoves(args, owned, moved);
				const emission = callEmissionType(call);
				if (!emission || classifyEmission(emission).cardinality !== 'zero')
					carrier = call;
			}
			return;
		}
		if (n.kind === 'call') markCallMoves(n, owned, moved);
		for (const k of childNodes(n)) {
				if (k) markConsumingMoves(k, owned, moved);
		}
	}
	function escapingBorrow(value: Node, owned: ReadonlySet<Symbol>): boolean {
		if (value.kind === '?') return value.children.slice(1).some(branch => !!branch && escapingBorrow(branch, owned));
		if (isCopyType(resolver(value))) return false;
		const mode = expressionOwnership(value);
		return (mode === 'borrow' || mode === 'var') && borrowOrigins(value).some(root =>
			root.kind === 'call' || root.kind === 'interp' || root.kind === 'data' || root.kind !== 'static' && owned.has(root));
	}

	function checkMoves(node: {
		parameters?: NodeMap['parameter'][];
		statements?: Node[];
		symbol?: SymbolMap['function'];
	}): void {
		if (!node.statements) return;
		const owned = new Set<Symbol>(
			node.parameters
				?.filter(p => p.symbol.ownership === 'own')
				.map(p => p.symbol) ?? [],
		);
		const moved = new Map<Symbol, Move>();
		const borrowed = new Map<BorrowOrigin, ReadonlySet<Symbol>>();
		for (const s of node.statements) {
			flagMovedUses(s, moved, borrowed);
			markConsumingMoves(s, owned, moved);
			if (s.kind === 'def') {
				walkEmbeds(s.value, new Set(), owned, borrowed, m => {
					owned.delete(m);
					borrowed.set(m, new Set([s.symbol]));
				});
				const roots = borrowOrigins(s.value);
				if (ownedHere(s)) {
					owned.add(s.symbol);
					for (const root of roots)
						if (root.kind !== 'variable' && root.kind !== 'static') borrowed.set(root, new Set([s.symbol]));
				} else if (!isCopyType(resolver(s.value))) {
					borrowed.set(s.symbol, new Set(roots.flatMap(root => [...(borrowed.get(root) ?? (root.kind === 'variable' ? [root] : []))])));
				}
			} else if (s.kind === 'next') {
				const v = s.children?.[0];
				if (!v) continue;
				if (v.kind === 'ident' && [...(borrowed.get(v.symbol) ?? [])].some(root => owned.has(root)))
					error(
						`cannot emit "${v.symbol.name ?? ''}" — it borrows a value that dies with this block`,
						v,
					);
				else if (v.kind === 'ident' && owned.has(v.symbol))
					moved.set(v.symbol, {
						position: v,
						context: 'with `next`',
					});
				else if (escapingBorrow(v, owned))
					error('cannot emit borrowed result — it borrows a value that dies with this block', v);
				else if (v.kind === 'data')
					walkEmbeds(v, new Set(), owned, borrowed, (m, position) => {
						owned.delete(m);
						moved.set(m, {
							position,
							context: 'into an emitted record',
						});
				});
			}
		}
		checkDeclaredOwnedReturn(node, owned);
	}

	function checkDeclaredOwnedReturn(
		node: {
			statements?: Node[];
			symbol?: SymbolMap['function'];
		},
		owned: Set<Symbol>,
	): void {
		const fn = node.symbol;
		if (fn?.returnOwnerships) {
			const values = (node.statements ?? []).flatMap(statement => {
				if (statement.kind !== 'next' || !statement.children?.[0]) return [];
				const value = statement.children[0];
				return value.kind === ',' ? value.children : [value];
			});
			fn.returnOwnerships.forEach((ownership, index) => {
				const value = values[index];
				if (ownership === 'own' && value)
					checkOwnedReturn(value, owned, fn);
			});
			return;
		}
		if (fn?.returnOwnership !== 'own') return;
		const statements = node.statements;
		const tail = statements?.[statements.length - 1];
		if (tail) checkOwnedReturn(tail, owned, fn);
	}

	function inferBorrowReturns(): void {
		const seen = new Set<Node>();
		const collect = (node: Node): void => {
			if (seen.has(node)) return;
			seen.add(node);
			if (node.kind === 'fn' && node.statements) {
				functionOutputOwnership(node);
				ownershipBlocks.add(node);
			}
			for (const child of childNodes(node)) if (child) collect(child);
		};
		collect(root);
		const functions = [...ownershipBlocks].filter((node): node is NodeMap['fn'] =>
			node.kind === 'fn' && !!node.statements &&
			(node.symbol.returnOwnership === 'borrow' || node.symbol.returnOwnership === 'var'));
		for (const fn of functions)
			fn.symbol.returnBorrowOrigins = [];
		let changed = true;
		while (changed) {
			changed = false;
			for (const fn of functions) {
				const roots = new Set((fn.statements ?? []).flatMap(statement =>
					statement.kind === 'next' ? borrowOrigins(statement) : []));
				const origins = (fn.parameters ?? []).flatMap((parameter, index) => roots.has(parameter.symbol) ? [index] : []);
				const previous = fn.symbol.returnBorrowOrigins;
				if (origins.length === previous?.length && origins.every((origin, index) => origin === previous[index])) continue;
				fn.symbol.returnBorrowOrigins = origins;
				changed = true;
			}
		}
		for (const fn of functions) {
			if (fn.symbol.returnOwnership !== 'var') continue;
			const roots = (fn.statements ?? []).flatMap(statement => statement.kind === 'next' ? borrowOrigins(statement) : []);
			if (!roots.length || roots.some(root => !fn.parameters?.some(parameter =>
				parameter.symbol === root && parameter.symbol.ownership === 'var')))
				error('`var` result must originate from a `var` parameter', fn);
		}
	}

	function checkOwnedThreadReturn(
		node: NodeMap['->'],
		owned: Set<Symbol>,
		fn: SymbolMap['function'],
	): void {
		let carrier: Node = node.children[0];
		for (let i = 1; i < node.children.length; i++) {
			const stage = node.children[i];
			if (!stage || stage.kind !== 'call') continue;
			const call = threadCall(stage, carrier, i === 1);
			const emission = callEmissionType(call);
			if (!emission) continue;
			const classification = classifyEmission(emission);
			if (classification.cardinality === 'zero') continue;
			if (classification.mayEmitVoid)
				checkOwnedReturn(carrier, owned, fn);
			carrier = call;
		}
		checkOwnedReturn(carrier, owned, fn);
	}

	function checkOwnedReturn(
		node: Node,
		owned: Set<Symbol>,
		fn: SymbolMap['function'],
	): void {
		if (node.kind === 'next') {
			const value = node.children?.[0];
			if (value) checkOwnedReturn(value, owned, fn);
			return;
		}
		if (node.kind === '?') {
			checkOwnedReturn(node.children[1], owned, fn);
			const alternate = node.children[2];
			if (alternate) checkOwnedReturn(alternate, owned, fn);
			return;
		}
		if (node.kind === '->') {
			checkOwnedThreadReturn(node, owned, fn);
			return;
		}
		const type = resolver(node);
		if (!isHeapType(type)) return;
		if (node.kind === 'ident' && owned.has(node.symbol)) return;
		if (['string', 'interp', 'data'].includes(node.kind))
			return;
		if (node.kind === 'call') {
			if (effectiveCallFunction(node)?.returnOwnership === 'own') return;
			if (node.children[0].kind === 'typeident') return;
		}
		error(
			`function "${fn.name ?? ''}" declares an \`own\` result but emits a borrowed value`,
			node,
		);
	}

	function checkFnDef(node: NodeMap['fn']) {
		resolver(node);
		for (const parameter of node.parameters ?? []) {
			const type = parameter.symbol.type;
			if (type) validateVectorType(type, parameter);
		}
		if (node.symbol.returnType)
			validateVectorType(node.symbol.returnType, node.returnType ?? node);
		checkOnlyStmt(node);
		checkReturnTypeAssignable(node);
		checkNoClosureCapture(node);
		checkUnusedValues(node);
		if (node.statements) {
			checkRedundantIntermediates(node.statements);
			checkEach(node.statements);
		}
		checkDeclaredEmissions(node);
		ownershipBlocks.add(node);
		functionOutputOwnership(node);
	}

	function checkOnlyStmt(c: NodeMap['fn'], i?: number) {
		const stmts = c.statements;
		if (stmts?.length !== 1) return;
		const only = stmts[0];
		if (only?.kind === 'next' && !only.implicit)
			error(
				'`next` is not allowed in a single-statement function. Use `{ X }` to emit X directly.',
				only,
			);
		else if (
			only?.kind === 'done' &&
			i === 0 &&
			!c.parameters
		)
			error(
				'`done` alone in a block is a no-op and not allowed.',
				only,
			);
		else if (
			only?.kind === 'break' &&
			i === 0 &&
			!c.parameters
		)
			error(
				'`break` alone in a source block is not allowed.',
				only,
			);
	}

	/** A multi-statement stage body must end in `next`/`done`/`break`, an
	 * assignment, or a Void expression — a dangling value would corrupt the
	 * pipe's stack (there is no implicit tail emission in stages). */
	function checkStageTail(c: NodeMap['fn']) {
		const stmts = c.statements;
		if (!stmts || stmts.length < 2) return;
		const last = stmts[stmts.length - 1];
		if (
			!last ||
			last.kind === 'next' ||
			last.kind === 'done' ||
			last.kind === 'break' ||
			last.kind === '=' ||
			last.kind === 'def' ||
			last.kind === 'comment'
		)
			return;
		const t = resolver(last);
		if (isUnusedValue(t)) error(unusedValueMessage(t), last);
	}

	function checkStageReturnType(c: NodeMap['fn']) {
		if (!c.returnType || c.statements?.length !== 1) return;
		const statement = c.statements[0];
		const stmt =
			statement?.kind === 'next' ? statement.children?.[0] : statement;
		if (
			!stmt ||
			stmt.kind === 'done' ||
			stmt.kind === 'break'
		)
			return;
		resolver(c);
		const t = resolver(stmt);
		const known = !(t.kind === 'type' && t.family === 'unknown');
		if (c.symbol.returnType && branchesFit(stmt, c.symbol.returnType))
			return;
		if (known && c.symbol.returnType && !canAssign(c.symbol.returnType, t))
			error(
				`Type "${typeToStr(t)}" is not assignable to return type "${typeToStr(c.symbol.returnType)}"`,
				stmt,
			);
	}

	function checkTypedStageBody(c: NodeMap['fn']) {
		if (!c.parameters?.length) return;
		const stmts = c.statements;
		if (!stmts?.length) {
			error('empty body in a typed block is invalid', c);
			return;
		}
		if (!c.returnType && stmts.length === 1 && stmts[0]?.kind === 'done')
			error('done-only body in a typed block is invalid', c);
	}

	function checkPipeStageFn(c: NodeMap['fn'], i: number) {
		const stmts = c.statements;
		const hasStmts = !!stmts?.length;
		if (c.parameters?.length === 0 && !hasStmts)
			error(
				'Empty `() { }` is not allowed; use `{ }` for a no-op function.',
				c,
			);
		checkTypedStageBody(c);
		checkOnlyStmt(c, i);
		if (hasStmts && !c.parameters?.length) {
			const emits = stmts.some(
				s =>
					s.kind === 'next' ||
					s.kind === 'break' ||
					s.kind === 'done',
			);
			if (!emits)
				error(
					'Statement body produces no emission; use `,` for auto-emit or add `next`.',
					c,
				);
		}
		if (
			stmts &&
			stmts.length > 1 &&
			c.parameters?.length &&
			!c.returnType &&
			stmts.every(
				s =>
					s.kind === 'next' &&
					s.children?.[0]?.kind !== ',',
			)
		)
			error(
				'Statement body is reducible to comma form `{ X1, X2 }`',
				c,
			);
		if (stmts)
			for (const s of stmts) {
				checkStageConditions(s);
				rejectAssignments(s);
			}
		checkStageReturnType(c);
		checkStageTail(c);
	}

	function rejectAssignments(node: Node): void {
		if (node.kind === '=')
			error(`Cannot reassign binding "${text(node.children[0])}"`, node.children[0]);
		for (const child of childNodes(node)) {
				if (child) rejectAssignments(child);
		}
		if (node.kind === 'fn' && node.statements)
			for (const statement of node.statements) rejectAssignments(statement);
	}

	function stageAcceptType(stage: Node): Type | undefined {
		if (stage.kind === 'fn') {
			if ((stage.parameters?.length ?? 0) > 1) return undefined;
			return paramDeclaredType(stage, 0);
		}
		if (stage.kind === '|') {
			const arms: Node[] = [];
			const collect = (n: Node): void => {
				if (n.kind === '|') {
					collect(n.children[0]);
					collect(n.children[1]);
					return;
				}
				arms.push(n);
			};
			collect(stage);
			const accepts = arms.map(stageAcceptType);
			// An arm that accepts "any" (undefined) makes the group unbounded.
			if (accepts.some(a => a === undefined)) return undefined;
			return unionOf(accepts.filter((a): a is Type => a !== undefined));
		}
		if (stage.kind === 'ident' || stage.kind === '.') {
			const fsym = pipeStageFn(stage);
			if (!fsym) return undefined;
			const cands = fsym.overloads ? [fsym, ...fsym.overloads] : [fsym];
			const parts: Type[] = [];
			for (const c of cands) {
				if ((c.parameters?.length ?? 0) !== 1) return undefined;
				const p = c.parameters?.[0]?.type;
				if (!p) return undefined;
				parts.push(p);
			}
			return unionOf(parts);
		}
		return undefined;
	}

	function stageEmitType(stage: Node, input: Type | undefined): Type {
		if (stage.kind === 'fn') {
			const ft = resolveFnType(stage);
			return ft.kind === 'function' && ft.returnType
				? ft.returnType
				: BT.Unknown;
		}
		if (stage.kind === '|') {
			const parts: Type[] = [];
			const walk = (n: Node): void => {
				if (n.kind === '|') {
					walk(n.children[0]);
					walk(n.children[1]);
					return;
				}
				parts.push(stageEmitType(n, input));
			};
			walk(stage);
			return unionOf(parts);
		}
		if (input) {
			const specialized = resolveFunctionStageReturn(stage, input);
			if (specialized) return specialized;
		}
		const fsym = pipeStageFn(stage);
		if (fsym) return fsym.returnType ?? BT.Void;
		return BT.Unknown;
	}

	function stagedLoop(children: Node[]): Node | undefined {
		for (let i = 1; i < children.length; i++)
			if (children[i]?.kind === 'loop') return children[i];
	}

	function checkPipe(node: NodeMap['>>']) {
		const kids = node.children;
		const invalidLoop = stagedLoop(kids);
		if (invalidLoop) {
			error(
				'`loop` is valid only as a pipe source; use tail recursion for loop-carried state',
				invalidLoop,
			);
			return;
		}
		inferPipeStageParams(kids);
		checkPipeStageOwnership(kids);
		for (let i = 0; i < kids.length; i++) {
			const c = kids[i];
			if (!c) continue;
			if (c.kind === 'fn') checkPipeStageFn(c, i);
			else if (c.kind === '|' && i > 0) {
				const checkArms = (n: Node): void => {
					if (n.kind === '|') {
						checkArms(n.children[0]);
						checkArms(n.children[1]);
					} else if (n.kind === 'fn') checkPipeStageFn(n, i);
					else check(n);
				};
				checkArms(c);
			} else check(c);
		}
		const litType = (v: string | number | boolean | bigint): Type => ({
			kind: 'type',
			flags: 0,
			family: 'literal',
			name: typeof v === 'string' ? `'${v}'` : String(v),
			size:
				typeof v === 'string'
					? 0
					: typeof v === 'boolean'
						? 1
						: typeof v === 'bigint'
							? 8
							: Number.isInteger(v)
								? 4
								: 8,
			value: v,
		});
		// A literal value (`5`, `'x'`, `true`) carries its literal type here, so a
		// single matching arm exhausts it; a base-typed value (`Int32`, `Bool`)
		// needs arms covering its domain.
		const emitTypeOf = (n: Node): Type => {
			if (n.kind === 'number') return litType(n.value);
			if (n.kind === 'string')
				return litType((n.value ?? text(n)).slice(1, -1));
			if (n.kind === 'ident' && n.symbol.kind === 'literal') {
				const v = n.symbol.value;
				if (
					typeof v === 'string' ||
					typeof v === 'number' ||
					typeof v === 'boolean'
				)
					return litType(v);
			}
			return resolver(n);
		};
		const covers = (accept: Type, m: Type): boolean => {
			if (canAssign(accept, m)) return true;
			if (m.kind === 'type' && m.family === 'bool')
				return (
					canAssign(accept, litType(true)) &&
					canAssign(accept, litType(false))
				);
			return false;
		};
		let emit = kids[0] ? emitTypeOf(kids[0]) : undefined;
		for (let i = 1; i < kids.length; i++) {
			const stage = kids[i];
			if (!stage) continue;
			if (
				emit?.kind === 'type' &&
				emit.family !== 'unknown' &&
				emit.family !== 'void'
			) {
				const accept = stageAcceptType(stage);
				if (accept !== undefined && !isTypeParam(accept)) {
					const members: Type[] = (
						emit.family === 'union' ? emit.members : [emit]
					).filter(
						member =>
							member.kind !== 'type' || member.family !== 'void',
					);
					const uncovered = members.find(m => !covers(accept, m));
					if (uncovered)
						error(
							`pipe stage does not consume "${typeToStr(
								uncovered,
							)}" of "${typeToStr(emit)}"`,
							stage,
						);
				}
			}
			emit = stageEmitType(stage, emit);
		}
		const terminal = kids[kids.length - 1];
		if (emit?.kind === 'function' && terminal)
			error(unusedValueMessage(emit), terminal);
	}

	function pipeFunctionNode(stage: Node): NodeMap['fn'] | undefined {
		if (stage.kind === 'fn') return stage;
		const symbol = stage.kind === 'ident' ? stage.symbol : undefined;
		const definition = symbol?.definition;
		if (definition?.kind === 'fn') return definition;
		if (definition?.kind === 'def' && definition.value.kind === 'fn')
			return definition.value;
		const fnDefinition = pipeStageFn(stage)?.definition;
		if (fnDefinition?.kind === 'fn') return fnDefinition;
		if (fnDefinition?.kind === 'def' && fnDefinition.value.kind === 'fn')
			return fnDefinition.value;
	}

	function threadOwnership(node: NodeMap['->']): OwnershipMode | undefined {
		let carrier: Node = node.children[0];
		let mode = expressionOwnership(carrier);
		for (let i = 1; i < node.children.length; i++) {
			const stage = node.children[i];
			if (!stage || stage.kind !== 'call') continue;
			const call = threadCall(stage, carrier, i === 1);
			const emission = callEmissionType(call);
			if (!emission) return mode;
			const classification = classifyEmission(emission);
			if (classification.cardinality === 'zero') continue;
			const output = expressionOwnership(call);
			mode =
				classification.mayEmitVoid && output !== mode ? 'borrow' : output;
			carrier = call;
		}
		return mode;
	}

	function bindingOwnership(symbol: Symbol): OwnershipMode | undefined {
		if (symbol.kind !== 'variable') return;
		if (symbol.ownership) return symbol.ownership;
		const definition = symbol.definition;
		return definition?.kind === 'def' && ownedHere(definition) ? 'own' : 'borrow';
	}

	function expressionOwnership(node: Node): OwnershipMode | undefined {
		if (node.kind === '.') return 'borrow';
		if (node.kind === '>>') {
			const last = node.children[node.children.length - 1];
			return last ? pipeOutputOwnership(last) : undefined;
		}
		if (node.kind === '?') {
			const modes = node.children.slice(1).map(branch => branch ? expressionOwnership(branch) : undefined);
			return modes.every(mode => mode === modes[0]) ? modes[0] : 'borrow';
		}
		if (node.kind === 'next')
			return node.children?.[0]
				? expressionOwnership(node.children[0])
				: undefined;
		if (node.kind === 'ident') return bindingOwnership(node.symbol);
		if (node.kind === 'call') {
			const callee = effectiveCallFunction(node);
			if (callee?.returnOwnership) return callee.returnOwnership;
			if (node.children[0].kind === 'typeident') return 'own';
		}
		if (node.kind === '->') return threadOwnership(node);
		if (node.kind === 'string' || node.kind === 'interp' || node.kind === 'data')
			return 'own';
	}

	function functionOutputOwnership(
		fn: NodeMap['fn'],
	): OwnershipMode | undefined {
		if (outputOwnershipChecked.has(fn.symbol))
			return fn.symbol.returnOwnership;
		outputOwnershipChecked.add(fn.symbol);
		if (fn.symbol.returnOwnership) return fn.symbol.returnOwnership;
		const statements = fn.statements ?? [];
		const emissions = statements.filter(
			(statement): statement is NodeMap['next'] => statement.kind === 'next',
		);
		let mode: OwnershipMode | undefined;
		for (const emission of emissions) {
			const current = expressionOwnership(emission);
			if (!current) continue;
			if (mode && mode !== current) {
				fn.symbol.returnOwnership = 'borrow';
				return 'borrow';
			}
			mode = current;
		}
		if (mode) fn.symbol.returnOwnership = mode;
		return mode;
	}

	function pipeOutputOwnership(node: Node): OwnershipMode | undefined {
		const fn = pipeFunctionNode(node);
		if (fn) return functionOutputOwnership(fn);
		return expressionOwnership(node);
	}

	function checkPipeStageOwnership(children: Node[]): void {
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			const parameter = pipeStageFn(stage)?.parameters?.[0];
			const expected = parameter?.ownership;
			if (expected !== 'own' && expected !== 'var') continue;
			const mode = pipeOutputOwnership(input);
			if (expected === 'var') {
				if (mode !== 'own' && mode !== 'var')
					error('a `var` stage requires mutable access from its input', stage);
				continue;
			}
			if (mode === 'var')
				error('cannot move mutable borrow into `own` stage', stage);
			else if (mode === 'borrow')
				error('cannot move shared borrow into `own` stage', stage);
		}
	}

	function requireBoolCond(cond: Node) {
		if (isConstCondition(cond)) {
			error(
				'`?:` condition is a compile-time constant; one branch is dead code',
				cond,
			);
			return;
		}
		const ct = resolver(cond);
		if (ct.kind === 'type' && ct.family !== 'bool' && ct.family !== 'unknown')
			error('`?:` condition must be `Bool`', cond);
	}

	function checkStageConditions(node: Node) {
		if (node.kind === 'fn') return;
		if (node.kind === '?') requireBoolCond(node.children[0]);
		for (const c of childNodes(node)) {
				if (c) checkStageConditions(c);
		}
	}

	function checkTernary(node: NodeMap['?']) {
		const [cond, truthy, falsy] = node.children;
		check(cond);
		check(truthy);
		if (falsy) check(falsy);
		if (
			!falsy &&
			truthy.kind !== 'break' &&
			truthy.kind !== 'done'
		)
			error(
				'`?:` requires both branches for value-only forms; use `break`/`done` for control flow.',
				node,
			);
		requireBoolCond(cond);
	}

	function checkRoot(node: NodeMap['root']): void {
		let seenMain = false;
		for (const c of node.children) {
			if (c.kind !== 'main') continue;
			if (seenMain) error('multiple `main` blocks are not allowed', c);
			seenMain = true;
		}
		checkEach(node.children);
	}

	function check(node: Node): void {
		switch (node.kind) {
			case 'root':
				return checkRoot(node);
			case 'fn':
				return checkFnDef(node);
			case 'main':
				checkRedundantIntermediates(node.statements);
				checkEach(node.statements);
				checkUnusedStatements(node.statements);
				ownershipBlocks.add(node);
				return;
			case 'test':
				checkRedundantIntermediates(node.statements);
				return checkEach(node.statements);
			case 'import':
				return;
			case 'data': {
				const inner = node.children[0];
				const items =
					inner?.kind === ',' ? inner.children : inner ? [inner] : [];
				if (items.length === 0)
					error(
						'empty data block `[]` is not a value (type-level `[]` is Void)',
						node,
					);
				return checkEach(items);
			}
			case 'extend': {
				check(node.children[1]);
				const target = node.children[0].symbol;
				if (target.kind === 'function') {
					checkDispatch(target, node);
					return;
				}
				const armSym = resolver(node.children[1]);
				const targetName = text(node.children[0]);
				const rt =
					armSym.kind === 'function' ? armSym.returnType : undefined;
				if (rt?.kind === 'type' && rt.name !== targetName)
					error(
						`constructor arm must return ${targetName}`,
						node,
					);
				return;
			}
			case 'next':
				return checkNext(node);
			case 'call':
				checkCall(node);
				return;
			case 'def':
				return checkDef(node);
			case '=':
				return checkAssign(node);
			case '<=':
			case '>=':
			case '<':
			case '>':
			case '-':
			case '+':
			case '/':
			case '*':
			case '%':
				return numberBinaryOperator(node);
			case '&':
			case '^':
			case '<:':
			case ':>':
				return bitwiseOperator(node);
			case '==':
			case '!=': {
				check(node.children[0]);
				check(node.children[1]);
				const isVoid = (n: Node) => {
					const t = resolver(n);
					return t.kind === 'type' && t.family === 'void';
				};
				if (isVoid(node.children[0]) || isVoid(node.children[1]))
					error(
						`void is not comparable; use length(x) == 0 to test for the empty terminal`,
						node,
					);
				const isBool = (n: Node) => {
					const t = resolver(n);
					return t.kind === 'type' && t.family === 'bool';
				};
				if (isBool(node.children[0]) !== isBool(node.children[1]))
					error(
						'`==`/`!=` cannot compare `Bool` with a non-`Bool` type',
						node,
					);
				return;
			}
			case '>>':
				return checkPipe(node);
			case '->':
				return checkThread(node);
			case '?':
				return checkTernary(node);
			case '|': {
				const lt = resolver(node.children[0]);
				const rt = resolver(node.children[1]);
				if (isNumericType(lt) && isNumericType(rt))
					return bitwiseOperator(node);
				if (!dispatchArms(node)) {
					if (isIntType(lt) || isIntType(rt))
						error(
							'Operator "|" requires integer operands',
							node,
						);
					for (const c of node.children) check(c);
					return;
				}
				for (const c of node.children) check(c);
				return;
			}
			case '??':
			case ',':
			case 'interp':
				for (const c of node.children) check(c);
				return;
			default:
				return;
		}
	}

	function paramDeclaredType(
		stage: Node,
		idx: number,
	): Type | undefined {
		if (stage.kind !== 'fn') return undefined;
		const pNode = stage.parameters?.[idx];
		if (!pNode?.type) return undefined;
		if (pNode.type.kind !== 'typeident') return undefined;
		const s = pNode.type.symbol;
		return s.type;
	}

	function checkStageReachable(stage: Node, input: Node) {
		const prevFn = pipeStageFn(input);
		if (!prevFn) return;
		resolver(input);
		if (
			prevFn.returnType?.kind !== 'type' ||
			prevFn.returnType.family !== 'void'
		)
			return;
		const blocked =
			stage.kind === 'fn' ||
			(stage.kind === 'ident' &&
				stage.symbol.kind !== 'function' &&
				pipeStageFn(stage));
		if (blocked)
			error('stage is unreachable: previous stage returns Void', stage);
	}

	function inferSingleParamStage(
		stage: Node,
		p: Symbol,
		inputType: ResolvedType,
	) {
		// A single slot binds the whole upstream value.
		const declared = paramDeclaredType(stage, 0) ?? p.type;
		if (
			declared?.kind === 'type' &&
			inputType.family === 'data' &&
			declared.family !== 'data' &&
			declared.family !== 'union' &&
			declared.family !== 'unknown'
		) {
			error(
				`stage parameter of type "${typeToStr(declared)}" is not assignable from data-block input`,
				stage,
			);
			return;
		}
		if (!p.type) p.type = declared ?? inputType;
	}

	// Rest slot: [] → Void; one → that type; many → data.
	function restSlotType(
		members: Record<string, Symbol>,
		keys: string[],
		start: number,
	): Type {
		const rest = keys.slice(start);
		if (rest.length === 0) return BT.Void;
		if (rest.length === 1)
			return members[rest[0] ?? '']?.type ?? BT.Unknown;
		const out: Record<string, Symbol> = {};
		rest.forEach((k, i) => {
			out[String(i)] = {
				kind: 'variable',
				name: String(i),
				flags: 0,
				type: members[k]?.type ?? BT.Unknown,
			};
		});
		return {
			kind: 'type',
			flags: 0,
			name: '__data',
			family: 'data',
			size: 0,
			members: out,
		};
	}

	function inferMultiParamStage(
		stage: Node,
		params: Symbol[],
		inputType: ResolvedType,
	) {
		// The last slot binds rest; scalar input lifts to [scalar].
		const members: Record<string, Symbol> =
			inputType.family === 'data'
				? inputType.members
				: {
						'0': {
							kind: 'variable',
							name: '0',
							flags: 0,
							type: inputType,
						},
					};
		const keys = Object.keys(members);
		if (keys.length === 0) return; // unknown arity — leave slots uninferred
		const headCount = params.length - 1;
		if (keys.length < headCount) {
			error(
				`no match: stage with ${params.length} slots needs at least ${headCount} input element(s), got ${keys.length}`,
				stage,
			);
			return;
		}
		params.forEach((p, idx) => {
			const bound =
				idx < headCount
					? (members[keys[idx] ?? '']?.type ?? BT.Unknown)
					: restSlotType(members, keys, headCount);
			const declared = paramDeclaredType(stage, idx);
			if (
				declared?.kind === 'type' &&
				declared.family !== 'unknown' &&
				!canAssign(declared, bound)
			)
				error(
					`stage parameter of type "${typeToStr(
						declared,
					)}" is not assignable from "${typeToStr(bound)}"`,
					stage,
				);
			if (!p.type) p.type = bound;
		});
	}

	function pipeStageParams(
		stage: Node,
		fnSym: SymbolMap['function'],
	): Symbol[] | undefined {
		if (fnSym.parameters) return fnSym.parameters;
		return stage.kind === 'fn'
			? stage.parameters?.map(parameter => parameter.symbol)
			: undefined;
	}

	function inferPipeStage(stage: Node, input: Node) {
		checkStageReachable(stage, input);
		const fnSym = pipeStageFn(stage);
		if (!fnSym) return;
		const inputType = resolver(input);
		const params = pipeStageParams(stage, fnSym);
		if (
			stage.kind === 'fn' &&
			stage.statements &&
			inputType.kind === 'type' &&
			inputType.family !== 'unknown'
		) {
			const p0 = params?.[0];
			const single = params?.length === 1 && !!p0 && !p0.name;
			const dollarT = single
				? (paramDeclaredType(stage, 0) ?? p0.type ?? inputType)
				: inputType;
			for (const s of stage.statements) annotateDollar(s, dollarT);
		}
		if (!params?.length) return;
		if (inputType.kind !== 'type' || inputType.family === 'unknown')
			return;
		if (params.length === 1) {
			const p = params[0];
			if (p) inferSingleParamStage(stage, p, inputType);
			return;
		}
		inferMultiParamStage(stage, params, inputType);
	}

	function inferPipeStageParams(children: Node[]) {
		if (stagedLoop(children)) return;
		for (let i = 1; i < children.length; i++) {
			const stage = children[i];
			const input = children[i - 1];
			if (!stage || !input) continue;
			if (stage.kind === '|') {
				// Each dispatch arm infers `$` from its own declared type.
				const collect = (n: Node): void => {
					if (n.kind === '|') {
						collect(n.children[0]);
						collect(n.children[1]);
					} else inferPipeStage(n, input);
				};
				collect(stage);
			} else inferPipeStage(stage, input);
		}
	}

	function pipeStageFn(stage: Node): SymbolMap['function'] | undefined {
		if (stage.kind === 'fn') return stage.symbol;
		if (stage.kind === '.') {
			const t = resolveMemberType(stage);
			return t.kind === 'function' ? t : undefined;
		}
		if (stage.kind === 'ident') {
			const sym = stage.symbol;
			if (sym.kind === 'function') return sym;
			if (sym.kind === 'variable') {
				if (sym.type?.kind === 'function') return sym.type;
				const def = sym.definition;
				if (def?.kind === 'def' && def.value.kind === 'fn')
					return def.value.symbol;
			}
		}
	}

	function walkPipes(node: Node) {
		if (node.kind === '>>') inferPipeStageParams(node.children);
		switch (node.kind) {
			case 'string':
			case 'number':
			case 'literal':
			case 'loop':
			case 'done':
			case 'break':
			case 'comment':
			case '$':
			case '@':
			case 'ident':
			case 'label':
			case 'typeident':
				return;
			default: {
				const children = node.children;
				if (children)
					for (let i = 0; i < children.length; i++) {
						const c = children[i];
						if (c && c.kind !== 'ident') walkPipes(c);
					}
				const statements =
					node.kind === 'fn' || node.kind === 'main'
						? node.statements
						: undefined;
				if (statements) for (const s of statements) walkPipes(s);
			}
		}
		if (node.kind === 'fn') resolveFnType(node);
	}

	function finalizeFnSemantics(node: Node, seen = new Set<Node>()): void {
		if (seen.has(node)) return;
		seen.add(node);
		for (const child of childNodes(node))
			if (child) finalizeFnSemantics(child, seen);
		if (node.kind === 'fn' && node.statements) {
			for (const statement of node.statements)
				finalizeFnSemantics(statement, seen);
			inferFnElementReturn(node);
			setFnForwarding(node);
		}
		if (node.kind === 'main' || node.kind === 'test')
			for (const statement of node.statements)
				finalizeFnSemantics(statement, seen);
	}

	return {
		run: () => {
			walkPipes(root);
			check(root);
			finalizeFnSemantics(root);
			inferBorrowReturns();
			for (const block of ownershipBlocks) checkMoves(block);
		},
		resolver,
	};
}
