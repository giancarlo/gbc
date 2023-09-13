const identFirst = regexRule(/[a-zA-Z_]/);
const ident = regexRule(/[\w_]/);
const notIdent = regexRule(/[^\w_]/);

function token<Kind extends string>(
	kind: Kind,
	start = index,
	end = index,
): Token<Kind> {
	return { kind, start, end, source };
}

const scanner = Scanner({
	rules: {
		...keywords(notIdent, 'main', 'next', 'var'),
		...operators(
			'>>',
			'{',
			'}',
			'.',
			'==',
			'!=',
			'=',
			',',
			'?',
			':',
			'||',
			'&&',
			'|',
			'&',
			'+',
			'-',
			'*',
			'/',
			'>',
			'<',
			'>=',
			'<=',
			'~',
			'!',
			'(',
			')',
		),
		string: s =>
			s.matchString("'") &&
			s.matchWithEscape("'", '\\') &&
			s.matchString("'"),
		eof,
		root: '',
		ident: s => s.match(identFirst) && s.matchWhile(ident),
		comment: s => s.matchString('#') && s.matchUntil(eol),
		number: s => {
			const first = s.char();
			let consumed = 0;

			if (first === '0') {
				const la = s.char(1);
				if (la === 'x') {
					s.consume(2);
					return s.matchWhileRegex(/[\da-fA-F_]/);
				} else if (la === 'b') {
					s.consume(2);
					return s.matchWhileRegex(/[01_]/);
				}
				consumed = s.matchWhileRegex(/[\d_]/);
			} else if (/\d/.test(first)) {
				consumed = s.matchWhileRegex(/[\d_]/);
			}

			if (consumed && s.char() === '.') {
				s.skip(1);
				const decimals = s.matchWhileRegex(/[\d_]/);
				if (!decimals) throw s.error('Expected digit');
				consumed = decimals;
			}

			return consumed;
		},
	},
});
