export type FormatDocument =
	| string
	| { kind: 'concat'; documents: readonly FormatDocument[] }
	| { kind: 'group'; document: FormatDocument }
	| { kind: 'indent'; document: FormatDocument }
	| { kind: 'line'; hard: boolean };

export interface FormatOptions {
	lineWidth?: number;
	indent?: string;
	newline?: string;
	initialIndent?: string;
	initialColumn?: number;
}

type Mode = 'flat' | 'break';
type Command = {
	depth: number;
	mode: Mode;
	document: FormatDocument;
};

const line: FormatDocument = { kind: 'line', hard: false };
const hardline: FormatDocument = { kind: 'line', hard: true };

function concat(documents: readonly FormatDocument[]): FormatDocument {
	return { kind: 'concat', documents };
}

function group(document: FormatDocument): FormatDocument {
	return { kind: 'group', document };
}

function indent(document: FormatDocument): FormatDocument {
	return { kind: 'indent', document };
}

function hasHardline(document: FormatDocument): boolean {
	if (typeof document === 'string') return document.includes('\n');
	if (document.kind === 'line') return document.hard;
	if (document.kind === 'concat') return document.documents.some(hasHardline);
	return hasHardline(document.document);
}

function fits(remaining: number, commands: readonly Command[]): boolean {
	const pending = [...commands];
	while (remaining >= 0) {
		const command = pending.pop();
		if (!command) return true;
		const { depth, document } = command;
		if (typeof document === 'string') {
			if (document.includes('\n')) return false;
			remaining -= document.length;
			continue;
		}
		switch (document.kind) {
			case 'concat':
				for (let i = document.documents.length - 1; i >= 0; i--)
					pending.push({
						depth,
						mode: command.mode,
						document: document.documents[i] ?? '',
					});
				break;
			case 'group':
				pending.push({ depth, mode: 'flat', document: document.document });
				break;
			case 'indent':
				pending.push({
					depth: depth + 1,
					mode: command.mode,
					document: document.document,
				});
				break;
			case 'line':
				if (document.hard || command.mode === 'break') return true;
				remaining--;
		}
	}
	return false;
}

export function renderFormat(
	document: FormatDocument,
	options: FormatOptions = {},
): string {
	const lineWidth = options.lineWidth ?? 80;
	const indentText = options.indent ?? '\t';
	const newlineText = options.newline ?? '\n';
	const initialIndent = options.initialIndent ?? '';
	let column = options.initialColumn ?? 0;
	let result = '';
	const commands: Command[] = [{ depth: 0, mode: 'break', document }];

	while (commands.length) {
		const command = commands.pop();
		if (!command) break;
		const { depth, document: current } = command;
		if (typeof current === 'string') {
			result += current;
			const newline = current.lastIndexOf('\n');
			column =
				newline === -1 ? column + current.length : current.length - newline - 1;
			continue;
		}
		switch (current.kind) {
			case 'concat':
				for (let i = current.documents.length - 1; i >= 0; i--)
					commands.push({
						depth,
						mode: command.mode,
						document: current.documents[i] ?? '',
					});
				break;
			case 'group': {
				const flat = {
					depth,
					mode: 'flat' as const,
					document: current.document,
				};
				commands.push(
					!hasHardline(current.document) &&
						fits(lineWidth - column, [...commands, flat])
						? flat
						: { ...flat, mode: 'break' },
				);
				break;
			}
			case 'indent':
				commands.push({
					depth: depth + 1,
					mode: command.mode,
					document: current.document,
				});
				break;
			case 'line':
				if (!current.hard && command.mode === 'flat') {
					result += ' ';
					column++;
				} else {
					const prefix = initialIndent + indentText.repeat(depth);
					result += newlineText + prefix;
					column = prefix.length;
				}
		}
	}

	return result;
}

export const formatting = {
	concat,
	group,
	hardline,
	indent,
	line,
	render: renderFormat,
} as const;
