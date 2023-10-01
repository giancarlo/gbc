import { TestApi, spec } from '@cxl/spec';
import { Scanner, Token, eof, eol, each, regexRule, Parser } from './index.js';

export default spec('compiler', s => {
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
