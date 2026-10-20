import assert from 'node:assert/strict';

const cases = {
 javascript: 'const value = 1;\n', typescript: 'const value: number = 1;\n',
 json: '{"value":1},\n', compiler: 'const value = 1\n',
 html: '<div>value</div>\n', markdown: '# Heading\n\nvalue\n\n',
 basic: 'PRINT 1\n', cmd: 'echo value\n',
};
function drain(iterator) {
 const tokens = [];
 for (;;) {
  const next = iterator.next();
  if (next.done) return { tokens, checkpoint: next.value };
  tokens.push(next.value);
 }
}
function snapshot(text, id = {}, version = 1) {
 return { id, version, length: text.length, read: (start, end) => text.slice(start, end), text: () => text };
}
function plain(tokens) {
 return tokens.map(({kind, highlight, start, end, line, foldStart, foldEnd}) => ({kind, highlight, start, end, line, foldStart, foldEnd}));
}
for (const [mode, unit] of Object.entries(cases)) {
 const { highlight } = await import(`../dist/${mode}/package/highlight.js`);
 const value = unit.repeat(100);
 const source = snapshot(value);
 const checkpoints = [];
 let current;
 const tokens = [];
 for (let end = unit.length; end < value.length; end += unit.length) {
  const result = drain(highlight.resume({ source, end }, current));
  tokens.push(...result.tokens);
  current = result.checkpoint;
  checkpoints.push(current);
 }
 tokens.push(...drain(highlight.resume({ source }, current)).tokens);
 assert.deepEqual(plain(tokens), plain(drain(highlight.resume({source})).tokens), `${mode}: chunking`);
 const inserted = unit.replace('1', '2').replace('value', 'other');
 const changed = snapshot(inserted + value, source.id, 2);
 let fresh = drain(highlight.resume({ source: changed, end: inserted.length })).checkpoint;
 let match;
 for (let index = 0; index < 12; index++) {
  fresh = drain(highlight.resume({source: changed, end: inserted.length + checkpoints[index].offset}, fresh)).checkpoint;
  if (highlight.equivalent(fresh, checkpoints[index])) { match = index; break; }
 }
 assert.notEqual(match, undefined, `${mode}: bounded convergence`);
 const old = checkpoints[match + 2];
 const shifted = highlight.rebase(old, changed, inserted.length, inserted.split('\n').length - 1);
 const suffix = drain(highlight.resume({source: changed}, shifted)).tokens;
 const expected = drain(highlight.resume({source: changed})).tokens.filter(token => token.start >= shifted.committed);
 assert.deepEqual(plain(suffix), plain(expected), `${mode}: relocated suffix`);
 assert.equal(suffix[0]?.source, changed.text());
 assert.doesNotThrow(() => structuredClone(suffix));
 assert.equal(highlight.equivalent(old, {...old}), false);
 assert.throws(() => highlight.rebase(old, snapshot(value), 0, 0));
 console.log(`${mode}: chunking, convergence, relocation, serialization pass`);
}

const { createMarkdownHighlighter } = await import('../dist/markdown/package/highlight.js');
const languages = Object.fromEntries(await Promise.all(Object.keys(cases).filter(mode => mode !== 'markdown').map(async mode =>
 [mode, (await import(`../dist/${mode}/package/highlight.js`)).highlight],
)));
const embedded = createMarkdownHighlighter(mode => mode === 'markdown' ? embedded : languages[mode]);
for (const [mode, unit] of Object.entries(cases)) {
 const value = `# Outer\n~~~~${mode}\n${unit.repeat(10)}~~~~\nafter`;
 const source = snapshot(value);
 const expected = drain(embedded.resume({ source })).tokens;
 const tokens = [];
 let checkpoint;
 for (let end = 0; end < value.length; end += 7) {
  const result = drain(embedded.resume({ source, end }, checkpoint));
  tokens.push(...result.tokens);
  checkpoint = result.checkpoint;
 }
 tokens.push(...drain(embedded.resume({ source }, checkpoint)).tokens);
 assert.deepEqual(plain(tokens), plain(expected), `${mode}: embedded chunking`);
 for (const token of tokens) {
  assert.equal(token.source, value);
  assert.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
 }
 const bodyStart = value.indexOf('\n', value.indexOf('~~~~')) + 1;
 const end = bodyStart + unit.length * 5;
 const old = drain(embedded.resume({ source, end })).checkpoint;
 const changed = snapshot(value.slice(0, bodyStart) + unit + value.slice(bodyStart), source.id, 2);
 const fresh = drain(embedded.resume({ source: changed, end: end + unit.length })).checkpoint;
 assert.equal(embedded.equivalent(old, fresh), true, `${mode}: embedded convergence`);
 const shifted = embedded.rebase(old, changed, unit.length, unit.split('\n').length - 1);
 const suffix = drain(embedded.resume({ source: changed }, shifted)).tokens;
 const expectedSuffix = drain(embedded.resume({ source: changed })).tokens.filter(token => token.start >= shifted.committed);
 assert.deepEqual(plain(suffix), plain(expectedSuffix), `${mode}: embedded rebase after body edit`);
 console.log(`${mode}: embedded streaming, positions, convergence and rebase pass`);
}

for (const [mode, body] of [
 ['javascript', 'const text = `first\n${1 +\n2}\nlast`;\n/* multi\nline */\n'],
 ['json', '{\n"bad": "unterminated\n}\n'],
]) {
 const value = `# Outer\n~~~${mode}\n${body}~~~\n`;
 const source = snapshot(value);
 const expected = drain(embedded.resume({ source })).tokens;
 let result = drain(embedded.resume({ source, end: 0 }));
 const tokens = [...result.tokens];
 for (let end = 1; end <= value.length; end++) {
  result = drain(embedded.resume({ source, end }, result.checkpoint));
  tokens.push(...result.tokens);
 }
 assert.deepEqual(tokens, expected, `${mode}: multiline syntax across every boundary`);
 if (mode === 'json') assert.ok(tokens.some(token => token.error));
 for (const token of tokens.filter(token => token.error)) {
  assert.equal(token.error.position.source, value);
  assert.equal(token.error.position.line, value.slice(0, token.error.position.start).split('\n').length - 1);
 }
 console.log(`${mode}: embedded multiline context and relocated diagnostics pass`);
}
