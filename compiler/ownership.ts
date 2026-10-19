import { text } from '@cxl/gbc.sdk';
import { childNodes } from './node.js';
import type { Node, NodeMap } from './node.js';
import type { ExpressionContext, ThreadResolution } from './preparation.js';
import type { SpecializationEnvironment } from './specialization.js';
import { argumentNodes as argListFromCall, composes, dataItems, dispatchArms, itemValue, resolveArgNodes } from './semantic.js';
import { BaseTypes, BufferSymbol, Flags, StackIntrinsic, isCollection, isHeapType, isIntType } from './symbol-table.js';
import type { OwnershipMode, ResolvedType, Symbol, SymbolMap, Type } from './symbol-table.js';

type EmissionType = Extract<ResolvedType, { family: 'emission' }>;

interface OwnershipResolution {
	typeOf(symbol: Symbol, environment: SpecializationEnvironment): Type;
	expressionType(node: Node, context: ExpressionContext): Type;
	emissionType(symbol: SymbolMap['function'], bindings: Map<string, Type>): EmissionType | undefined;
	nominalOf(node: NodeMap['data'], environment: SpecializationEnvironment): ResolvedType | undefined;
	threadCall(stage: NodeMap['call'], carrier: Node, first: boolean): NodeMap['call'];
	threadResolution(call: NodeMap['call'], context: ExpressionContext): ThreadResolution | undefined;
	staticMemberFunction(node: Node, environment: SpecializationEnvironment): SymbolMap['function'] | undefined;
	resolveOverload(arms: SymbolMap['function'][], args: Type[], templates?: ExpressionContext['templates']): SymbolMap['function'] | undefined;
}

export function createOwnershipAnalysis(root: Node, resolution: OwnershipResolution, externalExports: boolean) {
	const { typeOf, expressionType, emissionType, nominalOf, threadCall, threadResolution, staticMemberFunction, resolveOverload } = resolution;
	function resolvedEmissionType(symbol: SymbolMap['function'], context: ExpressionContext) {
		return emissionType(symbol, context.environment.typeArguments);
	}
	function identifierName(node: NodeMap['ident']): string {
		return node.symbol.name ?? text(node);
	}
	function directEmissionOwnership(
		sym: SymbolMap['function'],
		context: ExpressionContext,
	): OwnershipMode | undefined {
		const emission = resolvedEmissionType(sym, context);
		if (!emission || emission.rest || emission.elements.length !== 1)
			return undefined;
		return emission.ownerships[0];
	}

	function computeDeclaredOwnedInParams(rootNode: Node, context: ExpressionContext) {
		const ownedInParams = context.environment.ownedInputs;
		if (rootNode.kind !== 'root') return;
		ownedInParams.clear();
		context.environment.returnsOwned.clear();
		const definitions: {
			definition: NodeMap['def'];
			fn: NodeMap['fn'];
		}[] = [];
		for (const child of rootNode.children)
			if (child.kind === 'def' && child.value.kind === 'fn')
				definitions.push({ definition: child, fn: child.value });
		if (
			definitions.some(({ fn }) =>
				(fn.parameters ?? []).some(
					p => p.symbol.ownership === undefined,
				),
			)
		)
			computeInferredOwnedInParams(rootNode, context);
		for (const { definition, fn } of definitions) {
			const explicit = (fn.parameters ?? []).every(
				p => p.symbol.ownership !== undefined,
			);
			if (!explicit) continue;
			const flags = (fn.parameters ?? []).map(
				p => p.symbol.ownership === 'own',
			);
			ownedInParams.set(definition.symbol, flags);
			ownedInParams.set(fn.symbol, flags);
		}
	}

	function computeInferredOwnedInParams(rootNode: Node, context: ExpressionContext) {
		const ownedInParams = context.environment.ownedInputs;
		if (rootNode.kind !== 'root') return;
		interface Info {
			defSym: Symbol;
			fnNode: NodeMap['fn'];
			sites: NodeMap['call'][];
			nonCall: boolean;
			selfSites: Set<NodeMap['call']>;
		}
		const infos = new Map<Symbol, Info>();
		for (const child of rootNode.children) {
			if (child.kind !== 'def' || child.value.kind !== 'fn') continue;
			const fnNode = child.value;
			const params = fnNode.parameters ?? [];
			if (!params.length) continue;

			const hasUnionParam = params.some(p => {
				const t = typeOf(p.symbol, context.environment);
				return t.kind === 'type' && t.family === 'union';
			});
			if (hasUnionParam) continue;
			if (externalExports && child.symbol.flags & Flags.Export) continue;
			infos.set(child.symbol, {
				defSym: child.symbol,
				fnNode,
				sites: [],
				nonCall: false,
				selfSites: new Set(),
			});
		}
		if (!infos.size) return;
		const calleeIdents = new Set<Node>();
		const fnStack: NodeMap['fn'][] = [];
		const visit = (n: Node | undefined): void => {
			if (!n) return;
			const isFn = n.kind === 'fn';
			if (isFn) fnStack.push(n);
			if (n.kind === 'call') {
				const callee = n.children[0];
				if (callee.kind === 'ident') {
					calleeIdents.add(callee);
					const info = infos.get(callee.symbol);
					if (info) {
						info.sites.push(n);
						if (fnStack.includes(info.fnNode))
							info.selfSites.add(n);
					}
				}
			} else if (n.kind === 'ident') {
				const info = infos.get(n.symbol);
				if (info && !calleeIdents.has(n)) info.nonCall = true;
			}
			for (const child of childNodes(n)) visit(child);
			if (n.kind === 'def' || n.kind === 'propdef') visit(n.value);
			if (isFn) fnStack.pop();
		};
		visit(rootNode);
		const tailCallsOf = (fnNode: NodeMap['fn']): Set<Node> => {
			const tails = new Set<Node>();
			const visitTail = (n: Node | undefined): void => {
				if (!n) return;
				if (n.kind === 'next') return visitTail(n.children?.[0]);
				if (n.kind === '?') {
					visitTail(n.children[1]);
					visitTail(n.children[2]);
					return;
				}
				if (n.kind === 'call') tails.add(n);
			};
			const stmts = fnNode.statements ?? [];
			visitTail(stmts[stmts.length - 1]);
			return tails;
		};

		const paramOwner = new Map<Symbol, { info: Info; idx: number }>();
		for (const info of infos.values())
			(info.fnNode.parameters ?? []).forEach((p, i) =>
				paramOwner.set(p.symbol, { info, idx: i }),
			);

		const paramFlowsInto = (
			fnNode: NodeMap['fn'],
			sym: Symbol,
		): boolean => {
			const flowsAtCall = (n: NodeMap['call']): boolean => {
				const callee = n.children[0];
				if (callee.kind !== 'ident') return false;
				const fn =
					callee.symbol.kind === 'function'
						? callee.symbol
						: callee.symbol.type?.kind === 'function'
							? callee.symbol.type
							: undefined;
				if (!fn) return false;
				const a = n.children[1];
				const args = a?.kind === ',' ? a.children : a ? [a] : [];
				for (let k = 0; k < args.length; k++) {
					const ak = args[k];
					if (
						ak?.kind === 'ident' &&
						ak.symbol === sym &&
						fn.parameters?.[k]?.ownership === 'own'
					)
						return true;
				}
				return false;
			};
			let hit = false;
			const walk = (n: Node | undefined): void => {
				if (!n || hit) return;
				if (n.kind === 'call' && flowsAtCall(n)) hit = true;
				for (const child of childNodes(n)) walk(child);
				if (n.kind === 'def' || n.kind === 'propdef') walk(n.value);
			};
			(fnNode.statements ?? []).forEach(walk);
			return hit;
		};
		const flagsOf = new Map<Info, boolean[]>();
		const meta = new Map<Info, { paramSyms: Symbol[]; tails: Set<Node> }>();
		const isOwnedInParam = (sym: Symbol): boolean => {
			const o = paramOwner.get(sym);
			return !!o && !!flagsOf.get(o.info)?.[o.idx];
		};

		const argMovableIn = (a: Node): boolean => {
			if (a.kind === 'string') return true;
			if (ownableExpr(a, context)) return true;
			if (a.kind === 'ident') {
				if (isOwnedInParam(a.symbol)) return true;
				const def = a.symbol.definition;
				if (def?.kind === 'def' && ownableExpr(def.value, context)) return true;
			}

			if (a.kind === 'call') {
				const callee = a.children[0];
				if (callee.kind === 'ident' && callee.symbol.type?.kind === 'function')
					return true;
			}
			return false;
		};
		const typedHeap = (sym: Symbol): boolean => {
			return isHeapType(sym.type);
		};

		const okSites = (
			info: Info,
			i: number,
			paramSyms: Symbol[],
			tails: Set<Node>,
			accum: boolean,
		): boolean =>
			info.sites.every(site => {
				const a = resolveArgNodes(
					paramSyms,
					argListFromCall(site.children[1]),
				)[i];
				if (!a) return false;
				if (accum && a.kind === 'string') return true;
				if (
					a.kind === 'ident' &&
					a.symbol === paramSyms[i] &&
					info.selfSites.has(site) &&
					tails.has(site)
				)
					return true;
				return accum ? ownableExpr(a, context) : argMovableIn(a);
			});
		const qualifies = (
			info: Info,
			i: number,
			paramSyms: Symbol[],
			tails: Set<Node>,
		): boolean => {
			const sym = paramSyms[i];
			if (!sym) return false;
			const heap = typedHeap(sym);

			const embed = paramFlowsInto(info.fnNode, sym);
			if (!heap && !embed) return false;
			if (
				heap &&
				info.selfSites.size > 0 &&
				okSites(info, i, paramSyms, tails, true)
			)
				return true;
			return embed && okSites(info, i, paramSyms, tails, false);
		};

		for (const info of infos.values()) {
			if (info.nonCall || !info.sites.length) continue;
			const paramSyms = (info.fnNode.parameters ?? []).map(p => p.symbol);
			const tails = tailCallsOf(info.fnNode);
			meta.set(info, { paramSyms, tails });
			flagsOf.set(
				info,
				paramSyms.map(
					sym =>
						(typedHeap(sym) && info.selfSites.size > 0) ||
						paramFlowsInto(info.fnNode, sym),
				),
			);
		}

		const publish = () => {
			ownedInParams.clear();
			context.environment.returnsOwned.clear();
			for (const [info, flags] of flagsOf)
				if (flags.some(Boolean)) {
					ownedInParams.set(info.defSym, flags);
					ownedInParams.set(info.fnNode.symbol, flags);
				}
		};
		let changed = true;
		while (changed) {
			changed = false;
			publish();
			for (const [info, { paramSyms, tails }] of meta) {
				const cur = flagsOf.get(info);
				if (!cur) continue;
				const next = cur.map(
					(on, i) => on && qualifies(info, i, paramSyms, tails),
				);
				if (next.some((v, i) => v !== cur[i])) {
					changed = true;
					flagsOf.set(info, next);
				}
			}
		}
		publish();
	}
	function forwardedArgument(node: NodeMap['call']): Node | undefined {
		const callee = node.children[0];
		if (callee.kind !== 'ident' || callee.symbol.kind !== 'function')
			return;
		const origin = callee.symbol.returnBorrowOrigins?.[0];
		if (origin === undefined) return;
		const args = node.children[1];
		return args?.kind === ','
			? args.children[origin]
			: origin === 0
				? args
				: undefined;
	}

	function ctorAllocsFresh(t: Type, context: ExpressionContext): boolean {
		if (t.kind !== 'type') return false;
		if (
			t.family !== 'int' &&
			t.family !== 'uint' &&
			t.family !== 'float' &&
			t.family !== 'bool' &&
			t.family !== 'char'
		)
			return false;
		const arm = findCtorArm('String', t, context);
		if (arm) return fnReturnsOwned(arm, context);
		return true;
	}

	function isScalarValue(vt: Type): boolean {
		return (
			vt.kind === 'type' &&
			(vt.family === 'int' ||
				vt.family === 'uint' ||
				vt.family === 'float' ||
				vt.family === 'vector' ||
				vt.family === 'bool' ||
				vt.family === 'char' ||
				vt.family === 'void')
		);
	}

	function typeidentOwnable(
		callee: NodeMap['typeident'],
		args: Node | undefined,
		context: ExpressionContext,
	): boolean {
		if (
			callee.symbol === BufferSymbol ||
			isCollection(typeOf(callee.symbol, context.environment))
		)
			return true;
		const type = typeOf(callee.symbol, context.environment);
		if (type.kind !== 'type' || type.family !== 'string') return false;
		if (!args || args.kind === ',') return false;
		return ctorAllocsFresh(expressionType(args, context), context);
	}

	function callableOwnable(
		def: NodeMap['def'],
		args: Node | undefined,
		context: ExpressionContext,
	): boolean {
		if (def.value.kind === 'fn') return fnReturnsOwned(def.value, context);
		const armNodes = dispatchArms(def.value);
		if (!armNodes) return false;
		const overloads: SymbolMap['function'][] = [];
		for (const a of armNodes) {
			if (a.kind !== 'fn') return false;
			overloads.push(a.symbol);
		}
		const argList = args ? (args.kind === ',' ? args.children : [args]) : [];
		const arm = resolveOverload(
			overloads,
			argList.map(a => expressionType(a, context)),
			context.templates,
		);
		const armNode = armNodes.find(a => a.kind === 'fn' && a.symbol === arm);
		return armNode?.kind === 'fn' ? fnReturnsOwned(armNode, context) : false;
	}

	function ownableCall(node: NodeMap['call'], context: ExpressionContext): boolean {
		const callee = node.children[0];
		const args = node.children[1];
		if (callee.kind === '.') {
			const sfn = staticMemberFunction(callee, context.environment);
			if (sfn === StackIntrinsic) return true;
			const target = threadResolution(node, context)?.target;
			return !!target &&
				(directEmissionOwnership(target, context) === 'own' ||
					target.returnOwnership === 'own');
		}
		if (callee.kind === 'typeident')
			return typeidentOwnable(callee, args, context);
		if (callee.kind !== 'ident') return false;
		if (
			callee.symbol.kind === 'function' &&
			(directEmissionOwnership(callee.symbol, context) === 'own' ||
				callee.symbol.returnOwnership === 'own')
		)
			return true;
		if (
			callee.symbol.kind === 'function' &&
			callee.symbol.flags & Flags.Intrinsic
		)
			return false;
		const def = callee.symbol.definition;
		return def?.kind === 'def' ? callableOwnable(def, args, context) : false;
	}

	function ownableExpr(node: Node, context: ExpressionContext): boolean {
		if (node.kind === 'interp') return true;
		const vt = expressionType(node, context);
		if (isScalarValue(vt)) return true;
		if (node.kind === 'data') {
			const items = dataItems(node);
			const hasLabels = items.some(
				it => it.kind === 'propdef' && it.label,
			);
			const first = items[0];
			if (items.length === 1 && !hasLabels && first && !nominalOf(node, context.environment))
				return ownableExpr(itemValue(first), context);
			return true;
		}
		if (node.kind === '?')
			return (
				!!node.children[2] &&
				ownableExpr(node.children[1], context) &&
				ownableExpr(node.children[2], context)
			);
		if (node.kind === '->') {
			let carrier: Node = node.children[0];
			for (let i = 1; i < node.children.length; i++) {
				const stage = node.children[i];
				if (!stage || stage.kind !== 'call') continue;
				const call = threadCall(stage, carrier, i === 1);
				const resolved = threadResolution(call, context);
				if (!resolved) return false;
				if (resolved.classification.cardinality === 'zero') continue;
				if (
					resolved.classification.mayEmitVoid &&
					(!ownableExpr(carrier, context) || !ownableCall(call, context))
				)
					return false;
				carrier = call;
			}
			return ownableExpr(carrier, context);
		}
		if (node.kind === 'call') return ownableCall(node, context);
		return false;
	}

	const definitionOwners = new Map<NodeMap['def'], NodeMap['fn']>();
	{
		const seen = new Set<Node>();
		const visit = (node: Node | undefined, owner?: NodeMap['fn']): void => {
			if (!node || seen.has(node)) return;
			seen.add(node);
			const nextOwner = node.kind === 'fn' ? node : owner;
			if (node.kind === 'def' && owner) definitionOwners.set(node, owner);
			for (const child of childNodes(node)) visit(child, nextOwner);
		};
		visit(root);
	}

	function fnReturnsOwned(fnNode: NodeMap['fn'], context: ExpressionContext): boolean {
		const emissionOwnership = directEmissionOwnership(fnNode.symbol, context);
		if (emissionOwnership) return emissionOwnership === 'own';
		if (fnNode.symbol.returnOwnership)
			return fnNode.symbol.returnOwnership === 'own';
		const memo = context.environment.returnsOwned.get(fnNode);
		if (memo !== undefined) return memo;
		context.environment.returnsOwned.set(fnNode, true);
		const stmts = fnNode.statements ?? [];
		let result = stmts.length > 0;
		for (let i = 0; i < stmts.length - 1; i++)
			if (stmts[i]?.kind === 'next') result = false;
		const last = stmts[stmts.length - 1];
		if (result && last) result = returnPathOwned(last, fnNode, context);
		context.environment.returnsOwned.set(fnNode, result);
		return result;
	}

	function returnIdentOwned(
		node: NodeMap['ident'],
		fnNode: NodeMap['fn'],
		context: ExpressionContext,
	): boolean {
		if (node.symbol.ownership === 'own') return true;
		const def = node.symbol.definition;
		return (
			def?.kind === 'def' &&
			definitionOwners.get(def) === fnNode &&
			ownableExpr(def.value, context)
		);
	}

	function returnPathOwned(node: Node, fnNode: NodeMap['fn'], context: ExpressionContext): boolean {
		if (node.kind === 'next')
			return node.children?.[0]
				? returnPathOwned(node.children[0], fnNode, context)
				: false;
		if (node.kind === 'string') return true;
		if (isScalarValue(expressionType(node, context))) return true;
		if (node.kind === '?')
			return node.children[2]
				? returnPathOwned(node.children[1], fnNode, context) &&
						returnPathOwned(node.children[2], fnNode, context)
				: false;
		if (node.kind === 'ident') return returnIdentOwned(node, fnNode, context);
		if (node.kind === 'call') {
			const returned = forwardedArgument(node);
			if (returned) return returnPathOwned(returned, fnNode, context);
		}
		return ownableExpr(node, context);
	}

	const typeCtorArms = new Map<string, NodeMap['fn'][]>();
	if (root.kind === 'root')
		for (const c of root.children)
			if (
				c.kind === 'extend' &&
				c.children[0].symbol.kind !== 'function'
			) {
				const nm = identifierName(c.children[0]);
				const arms = typeCtorArms.get(nm) ?? [];
				arms.push(c.children[1]);
				typeCtorArms.set(nm, arms);
			}

	function findCtorArm(
		typeName: string,
		at: Type,
		context: ExpressionContext,
	): NodeMap['fn'] | undefined {
		const arms = typeCtorArms.get(typeName);
		if (!arms || at.kind !== 'type') return undefined;
		const paramType = (arm: NodeMap['fn']) => {
			const p = arm.parameters?.[0];
			return p ? typeOf(p.symbol, context.environment) : BaseTypes.Unknown;
		};
		for (const arm of arms) {
			const pt = paramType(arm);
			if (
				pt.kind === 'type' &&
				pt.family === at.family &&
				pt.name === at.name
			)
				return arm;
		}
		for (const arm of arms) {
			const pt = paramType(arm);
			if (isIntType(pt) && isIntType(at) && pt.kind === 'type' && pt.size >= at.size)
				return arm;
		}

		for (const arm of arms) {
			const pt = paramType(arm);
			if (pt.kind === 'type' && composes(at, pt)) return arm;
		}
		return undefined;
	}

	function returnedBorrowArguments(call: NodeMap['call'], context: ExpressionContext): readonly (Node | undefined)[] | undefined {
		const target = threadResolution(call, context)?.target;
		if (!target?.returnBorrowOrigins) return;
		const args = resolveArgNodes(target.parameters ?? [], argListFromCall(call.children[1]));
		return target.returnBorrowOrigins.map(origin => args[origin]);
	}

	function ownedParameters(symbol: Symbol, environment: SpecializationEnvironment): readonly boolean[] | undefined {
		for (let scope: SpecializationEnvironment | undefined = environment; scope; scope = scope.parent) {
			const flags = scope.ownedInputs.get(symbol);
			if (flags) return flags;
		}
	}
	return { initialize: (context: ExpressionContext) => computeDeclaredOwnedInParams(root, context), ownedParameters, ownableExpr, fnReturnsOwned, forwardedArgument, returnedBorrowArguments, ctorAllocsFresh, findCtorArm };
}
