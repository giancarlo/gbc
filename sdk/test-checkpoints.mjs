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
