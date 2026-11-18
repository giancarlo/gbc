function isHexDigit(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	return (
		(ch >= '0' && ch <= '9') ||
		(ch >= 'a' && ch <= 'f') ||
		(ch >= 'A' && ch <= 'F')
	);
}

const simple = new Map([
	['n', '\n'],
	['r', '\r'],
	['t', '\t'],
	['\\', '\\'],
	["'", "'"],
	['"', '"'],
	['$', '$'],
]);

export function decodeEscapes(s: string): string {
	s = s.replace(/\r\n?/g, '\n');
	let out = '';
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (ch !== '\\') {
			out += ch;
			i++;
			continue;
		}
		const next = s[i + 1];
		const escaped = next === undefined ? undefined : simple.get(next);
		if (escaped !== undefined) {
			out += escaped;
			i += 2;
		} else if (next === 'u' && s[i + 2] === '{') {
			const end = s.indexOf('}', i + 3);
			if (end < 0) throw new Error('Invalid `\\u{...}` escape');
			out += String.fromCodePoint(parseInt(s.slice(i + 3, end), 16));
			i = end + 1;
		} else if (isHexDigit(next) && isHexDigit(s[i + 2])) {
			out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
			i += 3;
		} else throw new Error(`Invalid string escape "\\${next ?? ''}"`);
	}
	return out;
}
