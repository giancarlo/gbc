import type { Node, NodeMap } from './node.js';
import { BaseTypes, unifyTypeParam } from './symbol-table.js';
import type { ResolvedType, Symbol as GbcSymbol, SymbolMap, Type } from './symbol-table.js';

export interface SpecializationEnvironment {
	parent?: SpecializationEnvironment;
	types: Map<GbcSymbol, Type>;
	bindings: Map<GbcSymbol, SymbolMap['function']>;
	typeArguments: Map<string, Type>;
	returnsOwned: Map<NodeMap['fn'], boolean>;
	ownedInputs: Map<GbcSymbol, boolean[]>;
	annotations?: WeakMap<Node, { nominal?: ResolvedType; originFn?: string }>;
}

export function createSpecializationEnvironment(
	parent?: SpecializationEnvironment,
	typeArguments = parent?.typeArguments ?? new Map<string, Type>(),
): SpecializationEnvironment {
	return {
		parent,
		types: new Map(),
		bindings: new Map(parent?.bindings),
		typeArguments,
		returnsOwned: new Map(),
		ownedInputs: new Map(),
	};
}

export function createSpecializationKey() {
	const ids = new Map<GbcSymbol, number>();
	function idOf(sym: GbcSymbol): number {
		let id = ids.get(sym);
		if (id === undefined) {
			id = ids.size;
			ids.set(sym, id);
		}
		return id;
	}

	function typeKey(t: Type): string {
		if (t.kind !== 'type') return 'fn';
		if (t.family === 'data')
			return (
				t.name + '[' +
				Object.keys(t.members)
					.map(k => `${k}:${typeKey(t.members[k]?.type ?? BaseTypes.Unknown)}`)
					.join(',') +
				']'
			);
		if (t.family === 'union')
			return '(' + t.members.map(typeKey).join('|') + ')';
		if (t.family === 'buffer' || t.family === 'vector')
			return `${t.name}<${typeKey(t.elem)}>`;
		return t.name;
	}

	function key(
		template: NodeMap['fn'],
		argTypes: Type[],
		bindings: Map<GbcSymbol, SymbolMap['function']>,
	): string {
		const bk = [...bindings.entries()]
			.map(([p, f]) => `${idOf(p)}:${idOf(f)}`)
			.join(',');
		return `${idOf(template.symbol)}|${argTypes
			.map(typeKey)
			.join(',')}|${bk}`;
	}

	return key;
}

export function bindTypeArguments(
	template: NodeMap['fn'],
	params: NodeMap['parameter'][],
	argTypes: Type[],
	subst: Map<string, Type>,
	bindings: Map<GbcSymbol, SymbolMap['function']>,
): void {
	const tparams = template.typeParameters ?? [];
	if (!tparams.length) return;
	const names = new Set(
		tparams.map(tp => tp.symbol.name).filter((n): n is string => !!n),
	);
	params.forEach((p, i) =>
		unifyTypeParam(p.symbol.type, bindings.get(p.symbol) ?? argTypes[i], names, subst),
	);
}

export function specializeType(type: Type, bindings: Map<string, Type>, reduce: (type: Type, bindings: Map<string, Type>) => Type): Type {
	if (type.kind !== 'type' || !bindings.size) return type;
	if (type.application) return reduce(type, bindings);
	if (type.family === 'unknown') return bindings.get(type.name) ?? type;
	if (type.family === 'buffer' || type.family === 'vector') {
		const elem = specializeType(type.elem, bindings, reduce);
		return elem === type.elem ? type : { ...type, elem };
	}
	if (type.family === 'data') {
		const members = Object.fromEntries(Object.entries(type.members).map(([key, member]) => {
			const concrete = member.type ? specializeType(member.type, bindings, reduce) : undefined;
			return [key, !concrete || concrete === member.type ? member : { ...member, type: concrete }];
		}));
		return Object.entries(type.members).every(([key, member]) => members[key] === member) ? type : { ...type, members };
	}
	if (type.family === 'union') {
		const members = type.members.map(member => specializeType(member, bindings, reduce));
		return members.every((member, index) => member === type.members[index]) ? type : { ...type, members };
	}
	return type;
}
