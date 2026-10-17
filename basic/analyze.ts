import {
	CompilerError,
	Flags,
	ReferenceSymbolTable,
	childNodes,
	type Symbol,
} from '@cxl/gbc.sdk';
import type { Node, NodeMap, TypeAnnotation } from './index.js';

export interface BasicType {
	kind: 'type' | 'function';
	name: string;
	symbol?: BasicSymbol;
	length?: number;
}

export interface BasicSymbol extends Symbol<Node, BasicType> {
	id: number;
	scopeId: number;
	name: string;
	role: 'variable' | 'constant' | 'parameter' | 'procedure' | 'result' | 'label' | 'type' | 'field';
	array: boolean;
	shared: boolean;
	parameters?: BasicSymbol[];
	procedureKind?: 'sub' | 'function';
	declarations: Node[];
	fields?: Map<string, BasicSymbol>;
	dataOffset?: number;
}

export interface Scope {
	id: number;
	node: Node;
	symbols: Map<string, BasicSymbol>;
	labels: Map<string, BasicSymbol>;
}

export interface Analysis {
	root: NodeMap['root'];
	symbols: BasicSymbol[];
	scopes: Scope[];
	data: Node[];
	errors: CompilerError[];
}

const canonical = (name: string) => name.toLowerCase();
const suffixes: Record<string, string> = {
	'%': 'integer',
	'&': 'long',
	'!': 'single',
	'#': 'double',
	'$': 'string',
	'@': 'currency',
};
const defaults: Record<string, string> = {
	int: 'integer',
	lng: 'long',
	sng: 'single',
	dbl: 'double',
	str: 'string',
};
const builtins = new Set([...Object.values(suffixes), 'any']);
function children(node: Node): Node[] {
	const values: readonly (Node | undefined)[] = childNodes(node) ?? [];
	return values.filter((child): child is Node => child !== undefined);
}

function annotated(node: Node): TypeAnnotation | undefined {
	return node.kind === 'variable' ||
		node.kind === 'parameter' ||
		node.kind === 'declare' ||
		node.kind === 'procedure' ||
		node.kind === 'field'
		? node.annotation
		: undefined;
}

function linked(node: Node): node is NodeMap[
	'ident' | 'label' | 'variable' | 'constant' | 'parameter' | 'declare' | 'procedure' | 'type' | 'field'
] {
	return node.kind === 'ident' ||
		node.kind === 'label' ||
		node.kind === 'variable' ||
		node.kind === 'constant' ||
		node.kind === 'parameter' ||
		node.kind === 'declare' ||
		node.kind === 'procedure' ||
		node.kind === 'type' ||
		node.kind === 'field';
}

export function analyze(root: NodeMap['root']): Analysis {
	const result: Analysis = { root, symbols: [], scopes: [], data: [], errors: [] };
	const table = ReferenceSymbolTable<BasicSymbol>();
	const procedures = new Map<string, BasicSymbol>();
	const types = new Map<string, BasicSymbol>();
	const scopes = new Map<Node, Scope>();
	const nodeTypes = new Map<Node, BasicType>();
	let defaultTypes = new Map<string, string>();
	const shared: [NodeMap['variable'], Scope][] = [];
	const error = (message: string, node: Node) => result.errors.push(new CompilerError(message, node));
	function reset(node: Node) {
		delete node.resolved;
		delete node.scopeId;
		delete node.dataOffset;
		if (linked(node))
			delete node.symbol;
		const annotation = annotated(node);
		if (annotation)
			delete annotation.symbol;
		for (const child of children(node))
			reset(child);
	}
	reset(root);
	function scope(node: Node): Scope {
		const value: Scope = { id: result.scopes.length, node, symbols: new Map(), labels: new Map() };
		result.scopes.push(value);
		scopes.set(node, value);
		return value;
	}
	const global = scope(root);
	function symbol(node: Node, owner: Scope, name: string, role: BasicSymbol['role'], type?: BasicType): BasicSymbol {
		const value: BasicSymbol = {
			id: result.symbols.length, scopeId: owner.id, name: canonical(name), role,
			kind: role === 'type' ? 'type'
				: role === 'procedure' ? 'function'
				: role === 'parameter' ? 'parameter'
				: role === 'label' ? 'data'
				: 'variable',
			flags: role === 'constant' || role === 'label' || role === 'type' || role === 'procedure'
				? Flags.None : Flags.Variable,
			definition: node, declarations: [node], references: [], type,
			array: node.kind === 'variable' ? node.array ?? node.dimensionCount > 0 : node.kind === 'parameter' && node.array,
			shared: node.kind === 'variable' && node.shared,
		};
		result.symbols.push(value);
		link(node, value);
		return value;
	}
	function link(node: Node, value: BasicSymbol) {
		node.resolved = value;
		if (linked(node))
			node.symbol = value;
	}
	function declaredType(node: Node, name: string, annotation?: TypeAnnotation): BasicType {
		const suffix = suffixes[name.slice(-1)];
		const explicit = annotation && canonical(annotation.name);
		if (suffix && explicit && suffix !== explicit)
			error(`Incompatible type suffix for ${name}`, node);
		const type: BasicType = {
			kind: 'type',
			name: explicit ?? suffix ?? defaultTypes.get(canonical(name[0] ?? '')) ?? 'single',
		};
		if (annotation?.length !== undefined)
			type.length = annotation.length;
		nodeTypes.set(node, type);
		return type;
	}
	function applyDefaults(node: NodeMap['defaulttype']) {
		for (const [first, last] of node.ranges) {
			const start = canonical(first).charCodeAt(0), end = canonical(last).charCodeAt(0);
			if (!/^[a-z]$/i.test(first) || !/^[a-z]$/i.test(last) || start > end)
				error('Invalid default type range', node);
			else
				for (let code = start; code <= end; code++)
					defaultTypes.set(String.fromCharCode(code), defaults[node.name] ?? 'single');
		}
	}
	function collectProcedure(node: NodeMap['procedure' | 'declare']) {
		const key = canonical(node.name);
		const type = declaredType(node, node.name, node.annotation);
		const previous = procedures.get(key);
		const value = previous ?? symbol(node, global, node.name, 'procedure', type);
		value.procedureKind ??= node.procedureKind;
		if (previous) {
			if (previous.declarations.some(item => item.kind === node.kind))
				error(`Duplicate procedure ${node.name}`, node);
			previous.declarations.push(node);
			link(node, value);
		}
		procedures.set(key, value);
		const local = scope(node);
		const savedDefaults = defaultTypes;
		defaultTypes = new Map(defaultTypes);
		const params = children(node).filter((child): child is NodeMap['parameter'] => child.kind === 'parameter');
		const signature = params.map(param => {
			param.scopeId = local.id;
			const item = symbol(param, local, param.name, 'parameter', declaredType(param, param.name, param.annotation));
			if (local.symbols.has(item.name))
				error(`Duplicate parameter ${param.name}`, param);
			else
				local.symbols.set(item.name, item);
			return item;
		});
		if (value.parameters && (
			value.procedureKind !== node.procedureKind ||
			value.type?.name !== type.name ||
			value.parameters.length !== signature.length ||
			value.parameters.some((param, i) =>
				(param.type?.name !== 'any' &&
					signature[i]?.type?.name !== 'any' &&
					param.type?.name !== signature[i]?.type?.name) ||
				param.array !== signature[i]?.array
			)
		))
			error(`Incompatible declaration ${node.name}`, node);
		value.parameters ??= signature;
		if (node.kind === 'procedure') {
			value.definition = node;
			if (node.procedureKind === 'function') {
				if (local.symbols.has(key))
					error(`Duplicate result ${node.name}`, node);
				else
					local.symbols.set(key, symbol(node, local, node.name, 'result', type));
				link(node, value);
			}
			const body = node.children[node.parameterCount];
			if (body)
				collect(body, local);
		}
		defaultTypes = savedDefaults;
	}

	function collectType(node: NodeMap['type'], owner: Scope) {
		const value = symbol(node, global, node.name, 'type');
		if (types.has(value.name))
			error(`Duplicate type ${node.name}`, node);
		else
			types.set(value.name, value);
		value.fields = new Map();
		for (const field of node.children) {
			field.scopeId = owner.id;
			const item = symbol(field, owner, field.name, 'field', declaredType(field, field.name, field.annotation));
			if (value.fields.has(item.name))
				error(`Duplicate field ${field.name}`, field);
			else
				value.fields.set(item.name, item);
		}
	}

	function collectVariable(node: NodeMap['variable' | 'constant'], owner: Scope) {
		const type = declaredType(node, node.name, node.kind === 'variable' ? node.annotation : undefined);
		if (node.kind === 'variable' && node.shared && owner !== global) {
			shared.push([node, owner]);
			return;
		}
		if (node.kind === 'variable' && node.sharedOnly && owner === global)
			error('SHARED outside procedure', node);
		const previous = owner.symbols.get(canonical(node.name));
		if (previous) {
			if (node.kind !== 'variable' || !node.redim || !previous.array || previous.type?.name !== type.name)
				error(`Duplicate or incompatible declaration ${node.name}`, node);
			link(node, previous);
		} else {
			const value = symbol(node, owner, node.name, node.kind === 'constant' ? 'constant' : 'variable', type);
			owner.symbols.set(value.name, value);
		}
	}

	function collect(node: Node, owner: Scope) {
		node.scopeId = owner.id;
		if (node.kind === 'defaulttype') {
			applyDefaults(node);
			return;
		}
		if (node.kind === 'procedure' || node.kind === 'declare') {
			collectProcedure(node);
			return;
		}
		if (node.kind === 'type') {
			collectType(node, owner);
			return;
		}
		if (node.kind === 'label') {
			const value = symbol(node, owner, node.name, 'label');
			value.dataOffset = result.data.length;
			if (owner.labels.has(value.name))
				error(`Duplicate label ${node.name}`, node);
			else
				owner.labels.set(value.name, value);
			return;
		}
		if (node.kind === 'data') {
			node.dataOffset = result.data.length;
			result.data.push(...node.children);
			return;
		}
		if (node.kind === 'variable' || node.kind === 'constant') {
			collectVariable(node, owner);
		}
		if (node.kind === 'ident')
			declaredType(node, node.name);
		for (const child of children(node))
			collect(child, owner);
	}
	collect(root, global);
	for (const [node, owner] of shared) {
		const key = canonical(node.name);
		const type = nodeTypes.get(node);
		let value = global.symbols.get(key);
		if (!value) {
			value = symbol(node, global, node.name, 'variable', type);
			value.shared = false;
			global.symbols.set(key, value);
		} else if (
			((node.annotation || suffixes[node.name.slice(-1)]) && value.type?.name !== type?.name) ||
			value.array !== (node.array ?? node.dimensionCount > 0) ||
			value.role !== 'variable'
		)
			error(`Incompatible shared declaration ${node.name}`, node);
		if (owner.symbols.has(key))
			error(`Duplicate declaration ${node.name}`, node);
		else
			owner.symbols.set(key, value);
		link(node, value);
	}
	for (const [node, type] of nodeTypes) {
		if (!builtins.has(type.name)) {
			const value = types.get(type.name);
			if (!value)
				error(`Unknown type ${type.name}`, node);
			else {
				type.symbol = value;
				const annotation = annotated(node);
				if (annotation)
					annotation.symbol = value;
			}
		}
	}
	function reference(node: Node, value: BasicSymbol) {
		link(node, value);
		value.references?.push(node);
		return value;
	}
	function lookup(node: NodeMap['ident'], owner: Scope, array = false): BasicSymbol {
		const key = canonical(node.name);
		let value = table.getWithReference(key, node);
		if (!value) {
			value = symbol(node, owner, node.name, 'variable', nodeTypes.get(node));
			value.array = array;
			owner.symbols.set(key, value);
			table.set(key, value);
			value.references?.push(node);
		}
		link(node, value);
		return value;
	}
	function label(node: Node, owner: Scope) {
		const name = node.kind === 'number' ? node.text : node.kind === 'ident' ? node.name : undefined;
		const value = name === undefined ? undefined : owner.labels.get(canonical(name));
		if (!value)
			error(`Unknown label ${name ?? ''}`, node);
		else
			reference(node, value);
		return value;
	}
	function arrayReference(node: Node) {
		return node.resolved?.array && (node.kind === 'ident' || (node.kind === 'call' && node.children.length === 1));
	}

	function assignable(node: Node) {
		const value = node.resolved;
		if (!value || !['variable', 'parameter', 'result', 'field'].includes(value.role) || arrayReference(node))
			error('Invalid assignment target', node);
	}
	const constantsResolved = new Set<Node>();
	const constantsResolving = new Set<Node>();
	function resolveConstant(node: NodeMap['constant'], owner: Scope) {
		if (constantsResolved.has(node))
			return;
		if (constantsResolving.has(node)) {
			error(`Circular constant ${node.name}`, node);
			return;
		}
		constantsResolving.add(node);
		resolve(node.children[0], owner);
		if (node.resolved)
			node.resolved.type = expressionType(node.children[0]);
		constantsResolving.delete(node);
		constantsResolved.add(node);
	}
	function callProcedure(node: Node, callee: Node, args: Node[], owner: Scope) {
		const value = callee.kind === 'ident' ? procedures.get(canonical(callee.name)) : undefined;
		for (const arg of args)
			resolve(arg, owner);
		if (!value)
			error('Unknown procedure', callee);
		else {
			reference(callee, value);
			link(node, value);
			if (value.procedureKind !== 'sub')
				error('Expected SUB', node);
			checkArguments(value, args, node);
		}
		return value;
	}
	function resolveProcedure(node: NodeMap['procedure' | 'declare']) {
		const local = scopes.get(node);
		if (local && node.kind === 'procedure')
			table.withScope(() => {
				for (const [key, value] of local.symbols)
					table.set(key, value);
				const body = node.children[node.parameterCount];
				if (body)
					resolve(body, local);
			});
		return node.resolved;
	}

	function resolveIdentifier(node: NodeMap['ident'], owner: Scope, target: boolean, statement: boolean) {
		if (statement && procedures.get(canonical(node.name))?.procedureKind === 'sub')
			return callProcedure(node, node, [], owner);
		const proc = procedures.get(canonical(node.name));
		const value = !table.get(canonical(node.name)) && proc ? reference(node, proc) : lookup(node, owner);
		if (value.definition?.kind === 'constant')
			resolveConstant(value.definition, result.scopes[value.scopeId] ?? owner);
		if (!target && value.role === 'procedure' && (value.procedureKind !== 'function' || value.parameters?.length))
			error(`Invalid function reference ${node.name}`, node);
		return value;
	}

	function resolveMember(node: NodeMap['member'], owner: Scope) {
		const base = resolve(node.children[0], owner);
		const field = base?.type?.symbol?.fields?.get(canonical(node.children[1].name));
		if (!field)
			error(`Unknown field ${node.children[1].name}`, node.children[1]);
		else {
			reference(node.children[1], field);
			link(node, field);
		}
		return field;
	}

	function resolveCall(node: NodeMap['call'], owner: Scope, target: boolean, statement: boolean) {
		const statementCallee = node.children[0];
		if (statement && statementCallee.kind === 'ident' &&
			procedures.get(canonical(statementCallee.name))?.procedureKind === 'sub')
			return callProcedure(node, statementCallee, node.children.slice(1), owner);
		const [callee, ...args] = node.children;
		let value: BasicSymbol | undefined;
		if (callee.kind === 'ident') {
			const local = table.get(canonical(callee.name));
			const proc = procedures.get(canonical(callee.name));
			value = proc && (!local || local.role === 'result') ? reference(callee, proc) : lookup(callee, owner, true);
		} else
			value = resolve(callee, owner);
		for (const arg of args)
			resolve(arg, owner);
		if (value) {
			link(node, value);
			if (value.role === 'procedure') {
				if (target || value.procedureKind !== 'function')
					error('Invalid function call', node);
				checkArguments(value, args, node);
			}
			else if (!value.array)
				error('Expected array or function', node);
		}
		return value;
	}

	function resolveCallStatement(node: NodeMap['callstmt'], owner: Scope) {
		const first = node.children[0]?.children[0];
		const callee = first?.kind === 'call' ? first.children[0] : first;
		if (!callee) {
			error('Unknown procedure', node);
			return undefined;
		}
		const args = first?.kind === 'call' ? first.children.slice(1) : node.children.slice(1);
		const value = callProcedure(node, callee, args, owner);
		if (value && first?.kind === 'call')
			link(first, value);
		return value;
	}

	function resolveJump(node: NodeMap['goto' | 'gosub' | 'return' | 'onerror' | 'resume'], owner: Scope) {
		const child = node.children[0];
		if (child) {
			const value = label(child, owner);
			if (value)
				link(node, value);
		}
		return node.resolved;
	}

	function resolveAssignment(node: NodeMap['assign'], owner: Scope) {
		resolve(node.children[0], owner, true);
		assignable(node.children[0]);
		resolve(node.children[1], owner);
		if (!compatible(node.children[0].resolved?.type, expressionType(node.children[1])))
			error('Incompatible assignment', node);
		return undefined;
	}

	function resolveFor(node: NodeMap['for'], owner: Scope) {
		resolve(node.children[0], owner, true);
		assignable(node.children[0]);
		for (const child of node.children.slice(1))
			if (child)
				resolve(child, owner);
		return undefined;
	}

	function resolveInput(node: NodeMap['read' | 'input' | 'lineinput'], owner: Scope) {
		for (const arg of node.children) {
			const child = arg.children[0];
			if (child) {
				resolve(child, owner, true);
				if (node.kind === 'read' || child.kind !== 'string')
					assignable(child);
			}
		}
		return undefined;
	}

	function resolve(node: Node, owner: Scope, target = false, statement = false): BasicSymbol | undefined {
		switch (node.kind) {
			case 'constant':
				resolveConstant(node, owner);
				return node.resolved;
			case 'block':
				for (const child of node.children) resolve(child, owner, false, true);
				return undefined;
			case 'procedure':
			case 'declare': return resolveProcedure(node);
			case 'type':
			case 'defaulttype':
			case 'data':
			case 'label': return node.resolved;
			case 'ident': return resolveIdentifier(node, owner, target, statement);
			case 'member': return resolveMember(node, owner);
			case 'call': return resolveCall(node, owner, target, statement);
			case 'callstmt': return resolveCallStatement(node, owner);
			case 'goto':
			case 'gosub':
			case 'return':
			case 'onerror':
			case 'resume': return resolveJump(node, owner);
			case 'restore': {
				const child = node.children[0]?.children[0];
				node.dataOffset = child ? label(child, owner)?.dataOffset : 0;
				return undefined;
			}
			case 'assign': return resolveAssignment(node, owner);
			case 'for': return resolveFor(node, owner);
			case 'read':
			case 'input':
			case 'lineinput': return resolveInput(node, owner);
			default:
				for (const child of children(node)) resolve(child, owner);
				return node.resolved;
		}
	}
	function expressionType(node: Node): BasicType | undefined {
		if (node.resolved)
			return node.resolved.type;
		if (node.kind === 'string')
			return { kind: 'type', name: 'string' };
		if (node.kind === 'number')
			return { kind: 'type', name: suffixes[node.text.slice(-1)] ?? 'single' };
		if (node.kind === 'group' || node.kind === 'positive' ||
			node.kind === 'negate' || node.kind === '+' || node.kind === '-')
			return expressionType(node.children[0]);
		return undefined;
	}
	function compatible(expected: BasicType | undefined, actual: BasicType | undefined) {
		if (!expected || !actual || expected.name === 'any' || actual.name === 'any')
			return true;
		if (expected.symbol || actual.symbol)
			return expected.symbol === actual.symbol;
		return (expected.name === 'string') === (actual.name === 'string');
	}
	function checkArguments(value: BasicSymbol, args: Node[], node: Node) {
		if (value.parameters?.length !== args.length)
			error(`Argument count mismatch for ${value.name}`, node);
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const expression = arg?.kind === 'argument' ? arg.children[0] : arg;
			const parameter = value.parameters?.[i];
			if (!expression)
				error('Missing argument', arg ?? node);
			else if (parameter?.array && !arrayReference(expression))
				error('Expected array argument', expression);
			else if (!parameter?.array && arrayReference(expression))
				error('Expected scalar argument', expression);
			else if (!compatible(parameter?.type, expressionType(expression)))
				error('Incompatible argument', expression);
		}
	}
	for (const [key, value] of global.symbols)
		if (value.shared || value.role === 'constant')
			table.set(key, value);
	table.withScope(() => {
		for (const [key, value] of global.symbols) table.set(key, value);
		for (const value of global.symbols.values())
			if (value.definition?.kind === 'constant') resolveConstant(value.definition, global);
	});

	for (const node of root.children) {
		if (node.kind === 'procedure' || node.kind === 'declare')
			resolve(node, global);
	}
	table.withScope(() => {
		for (const [key, value] of global.symbols)
			table.set(key, value);
		for (const node of root.children)
			if (node.kind !== 'procedure' && node.kind !== 'declare')
				resolve(node, global, false, true);
	});
	return result;
}
