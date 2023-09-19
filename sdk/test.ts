import { TestApi, spec } from '@cxl/spec';
import { Scanner, Token, eof, eol, each, regexRule, Parser } from './index.js';

export default spec('compiler', s => {
	function testToken<T extends Token<string>>(
		a: TestApi,
		t1: T,
		t2: Partial<T>,
		src?: string,
	) {
		if (t1 === t2) return true;

		for (const key in t2) a.equal(t1[key], t2[key]);
		if (src !== undefined) a.equal(t1.source.slice(t1.start, t1.end), src);

		return false;
	}

	s.test('scanner', it => {
		const scanner = Scanner({
			rules: {
				eof,
				$: '$',
				comment: s => s.matchString(';;') && s.matchUntil(eol),
				'(': '(',
				')': ')',
			},
		});

		it.should('skip whitespace', a => {
			const next = scanner('   \t$   \r');
			const t = next();
			a.ok(t);
			a.equal(t.kind, '$');
			const eol = next();
			a.equal(eol.kind, 'eof');
		});

		it.should('tokenize line comment', a => {
			const next = scanner(';; Comment\n;; Comment2\n\t;; Comment 3');
			testToken(
				a,
				next(),
				{
					kind: 'comment',
					start: 0,
					end: 10,
				},
				';; Comment',
			);
			testToken(
				a,
				next(),
				{
					kind: 'comment',
					start: 11,
					end: 22,
				},
				';; Comment2',
			);
			testToken(a, next(), { kind: 'comment' }, ';; Comment 3');
			testToken(a, next(), { kind: 'eof' });
		});

		it.should('tokenize parens', a => {
			const next = scanner(' ( )');
			testToken(a, next(), { kind: '(' });
			testToken(a, next(), { kind: ')' });
		});

		it.should('work as an iterator', a => {
			let len = 0;
			for (const s of each(scanner(' (  ) '))) {
				len++;
				a.ok(s);
			}
			a.equal(len, 2);
		});

		/*it.test('matchEnclosed', a => {
			const s = scanner.scan('"string"');
			a.equal(s.matchEnclosed('"', '"'), 8);

			const s2 = scanner.scan('   "string" ()\n');
			s2.skipWhitespace();
			a.equal(s2.matchEnclosed('"', '"'), 8);
		});*/
	});

	s.test('parser', it => {
		const sample1 = `
(module
  (table 2 funcref)
  (func $f1 (result i32)
    i32.const 42)
  (func $f2 (result i32)
    i32.const 13)
  (elem (i32.const 0) $f1 $f2)
  (type $return_i32 (func (result i32)))
  (func (export "callByIndex") (param $i i32) (result i32)
    local.get $i
    call_indirect (type $return_i32)))`;

		const identChar = regexRule(/[\w$.]/);
		const scanner = Scanner({
			rules: {
				eof,
				program: '',
				comment: s => s.matchString(';;') && s.matchUntil(eol),
				'(': '(',
				')': ')',
				ident: s => s.matchWhile(identChar),
				string: s =>
					s.matchString('"') &&
					s.matchWithEscape('"', '\\') &&
					s.matchString('"'),
			},
		});

		const parse = Parser(
			scanner,
			({ expect, next, enclosed, current, parseUntilKind, node }) => {
				function ident(): ReturnType<typeof current> {
					const tk = current();
					if (tk.kind === '(') return enclosed('(', group, ')');
					else next();
					return tk;
				}

				function group() {
					return {
						...expect('ident'),
						children: parseUntilKind(ident, ')'),
					};
				}

				return {
					...node('program'),
					children: [enclosed('(', group, ')')],
				};
			},
		);

		it.should('parse s-expression', a => {
			const result = parse(sample1);
			a.equal(result.errors.length, 0);
			a.equal(result.root?.children?.length, 1);
			const mod = result.root?.children?.[0];
			a.equal(mod?.children?.length, 6);
		});
	});
});
