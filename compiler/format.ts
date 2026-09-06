import {
	formatting,
	type FormatDocument,
	type FormatOptions,
} from '../sdk/index.js';

import { childNodes, type Node, type NodeMap } from './node.js';

function conditionals(node: Node, source: string): NodeMap['?'][] {
	const result: NodeMap['?'][] = [];
	for (const child of childNodes(node)) {
		if (!child || child.source !== source) continue;
		if (child.kind === '?') result.push(child);
		else result.push(...conditionals(child, source));
	}
	return outermost(result);
}

function outermost(nodes: readonly NodeMap['?'][]): NodeMap['?'][] {
	const sorted = [...nodes].sort((a, b) => a.start - b.start || b.end - a.end);
	const result: NodeMap['?'][] = [];
	for (const node of sorted) {
		const previous = result[result.length - 1];
		if (previous && node.start >= previous.start && node.end <= previous.end)
			continue;
		if (previous && node.start < previous.end) continue;
		result.push(node);
	}
	return result;
}

function sourceDocument(node: Node): FormatDocument {
	if (node.kind === '?') return conditionalDocument(node);
	const nested = conditionals(node, node.source);
	if (!nested.length) return node.source.slice(node.start, node.end);
	const documents: FormatDocument[] = [];
	let offset = node.start;
	for (const conditional of nested) {
		documents.push(node.source.slice(offset, conditional.start));
		documents.push(conditionalDocument(conditional));
		offset = conditional.end;
	}
	documents.push(node.source.slice(offset, node.end));
	return formatting.concat(documents);
}

function armDocument(
	condition: FormatDocument,
	truthy: FormatDocument,
): FormatDocument {
	return formatting.group(
		formatting.concat([
			condition,
			' ?',
			formatting.indent(formatting.concat([formatting.line, truthy])),
		]),
	);
}

function conditionalParts(node: NodeMap['?']) {
	const [condition, truthy, falsy] = node.children;
	const questionGap = node.source.slice(condition.end, truthy.start);
	const question = questionGap.indexOf('?');
	const truthyPrefix = questionGap.slice(question + 1).trim();
	if (!falsy)
		return {
			condition: sourceDocument(condition),
			truthy: formatting.concat([truthyPrefix, sourceDocument(truthy)]),
		};
	const colonGap = node.source.slice(truthy.end, falsy.start);
	const colon = colonGap.lastIndexOf(':');
	return {
		condition: sourceDocument(condition),
		truthy: formatting.concat([
			truthyPrefix,
			sourceDocument(truthy),
			colonGap.slice(0, colon).trim(),
		]),
		falsy: formatting.concat([
			colonGap.slice(colon + 1).trim(),
			sourceDocument(falsy),
		]),
		falsyNode: falsy,
		falsyPrefix: colonGap.slice(colon + 1).trim(),
	};
}

function conditionalBody(node: NodeMap['?']): FormatDocument {
	const parts = conditionalParts(node);
	if (!parts.falsy) return armDocument(parts.condition, parts.truthy);
	if (parts.falsyNode.kind !== '?' || parts.falsyPrefix)
		return formatting.group(
			formatting.concat([
				parts.condition,
				' ?',
				formatting.indent(formatting.concat([formatting.line, parts.truthy])),
				formatting.line,
				': ',
				parts.falsy,
			]),
		);

	const documents: FormatDocument[] = [
		armDocument(parts.condition, parts.truthy),
	];
	let current: NodeMap['?'] = parts.falsyNode;
	for (;;) {
		const next = conditionalParts(current);
		documents.push(formatting.hardline, ': ');
		documents.push(armDocument(next.condition, next.truthy));
		if (!next.falsy) break;
		if (next.falsyNode.kind !== '?' || next.falsyPrefix) {
			documents.push(formatting.hardline, ': ', next.falsy);
			break;
		}
		current = next.falsyNode;
	}
	return formatting.concat(documents);
}

function conditionalDocument(node: NodeMap['?']): FormatDocument {
	const [condition, truthy, falsy] = node.children;
	const last = falsy ?? truthy;
	return formatting.concat([
		node.source.slice(node.start, condition.start),
		conditionalBody(node),
		node.source.slice(last.end, node.end),
	]);
}

function leadingIndent(source: string, start: number): string {
	const lineStart = source.lastIndexOf('\n', start - 1) + 1;
	return source.slice(lineStart, start).match(/^[\t ]*/)?.[0] ?? '';
}

function initialColumn(source: string, start: number): number {
	return start - (source.lastIndexOf('\n', start - 1) + 1);
}

function newline(source: string): string {
	return source.match(/\r\n|\n|\r/)?.[0] ?? '\n';
}

export function formatGb(
	source: string,
	root: NodeMap['root'],
	options: FormatOptions = {},
): string {
	const nodes = outermost(
		root.children.flatMap(node =>
			node.kind === '?' ? [node] : conditionals(node, source),
		),
	);
	if (!nodes.length) return source;
	let result = '';
	let offset = 0;
	for (const node of nodes) {
		result += source.slice(offset, node.start);
		result += formatting.render(conditionalDocument(node), {
			...options,
			newline: options.newline ?? newline(source),
			initialIndent: leadingIndent(source, node.start),
			initialColumn: initialColumn(source, node.start),
		});
		offset = node.end;
	}
	return result + source.slice(offset);
}
