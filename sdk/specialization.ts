export function createSpecializationKey<Symbol extends object, Type>(typeKey: (type: Type) => string) {
	const ids = new Map<Symbol, number>();
	function idOf(symbol: Symbol): number {
		const existing = ids.get(symbol);
		if (existing !== undefined) return existing;
		const id = ids.size;
		ids.set(symbol, id);
		return id;
	}

	return (symbol: Symbol, types: readonly Type[], bindings: ReadonlyMap<Symbol, Symbol>): string => {
		const bound = [...bindings].map(([parameter, target]) => `${idOf(parameter)}:${idOf(target)}`).join(',');
		return `${idOf(symbol)}|${types.map(typeKey).join(',')}|${bound}`;
	};
}

export function createSpecializations<Signature, Body>() {
	type Prepared = { readonly signature: Signature; readonly body: Body };
	const instances = new Map<string, { id: number; prepared?: Prepared }>();

	function instantiate(key: string, prepare: () => Prepared): number {
		const existing = instances.get(key);
		if (existing) return existing.id;
		const id = instances.size;
		const instance: { id: number; prepared?: Prepared } = { id };
		instances.set(key, instance);
		try {
			instance.prepared = prepare();
			return id;
		} catch (error) {
			for (const [identity, created] of instances)
				if (created.id >= id) instances.delete(identity);
			throw error;
		}
	}

	function finish(): readonly Prepared[] {
		return [...instances.values()].map(({ prepared }) => {
			if (!prepared) throw new Error('Incomplete specialization');
			return prepared;
		});
	}

	return { instantiate, finish };
}
