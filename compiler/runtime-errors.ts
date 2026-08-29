import { BaseTypes, type ResolvedType, type Type } from './symbol-table.js';

export type RuntimeErrorName =
	| 'IndexOutOfBounds'
	| 'InvalidCapacity'
	| 'NumericOverflow'
	| 'OutOfMemory';

let types: Partial<Record<RuntimeErrorName, Type>> = {};

export function setRuntimeErrorTypes(
	value: Partial<Record<RuntimeErrorName, Type>>,
): void {
	types = value;
}

export function runtimeErrorType(name: RuntimeErrorName): Type | undefined {
	return types[name];
}

export function runtimeResultType(
	success: Type,
	name: RuntimeErrorName,
): Type {
	const error = runtimeErrorType(name);
	if (!error || success.kind !== 'type' || error.kind !== 'type') return success;
	const members: ResolvedType[] =
		success.family === 'union'
			? success.members.filter(
					(member): member is ResolvedType => member.kind === 'type',
				)
			: [success];
	if (!members.some(member => member.name === error.name)) members.push(error);
	const hasPayload =
		error.family === 'data' &&
		Object.keys(error.members).some(member => member !== '__trace');
	const oom =
		name === 'OutOfMemory' || !hasPayload
			? undefined
			: runtimeErrorType('OutOfMemory');
	if (
		oom?.kind === 'type' &&
		!members.some(member => member.name === oom.name)
	)
		members.push(oom);
	return {
		kind: 'type',
		flags: 0,
		name: members.map(member => member.name).join(' | '),
		family: 'union',
		size: Math.max(BaseTypes.Int32.size, ...members.map(member => member.size)),
		members,
	} satisfies ResolvedType;
}
