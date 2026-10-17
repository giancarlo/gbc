import { childNodes } from '@cxl/gbc.sdk';
import { spec, type TestApi } from '@cxl/spec';
import { analyze, type Node, type NodeMap } from './index.js';
import { parseProgram } from './parser.js';
function nodes(node: Node): Node[] {
	return [node, ...(childNodes(node)?.flatMap(child => child ? nodes(child) : []) ?? [])];
}
export default spec('semantic analysis', a => {
	function parse(source: string): NodeMap['root'] {
		const parsed = parseProgram(source);
		a.equalValues(parsed.errors.map(error => error.message), []);
		if (parsed.node?.kind !== 'root')
			throw new Error('Expected root');
		return parsed.node;
	}
	a.test('preserves explicit types, fields and defaults', a => {
		const root = parse('DEFINT A-C\nDIM amount AS INTEGER, title AS STRING * 12\nDECLARE FUNCTION total(x AS DOUBLE) AS DOUBLE\nTYPE Point\nx AS SINGLE\nEND TYPE');
		const annotations = nodes(root).flatMap(node => (node.kind === 'variable' || node.kind === 'parameter' || node.kind === 'procedure' || node.kind === 'declare' || node.kind === 'field') && node.annotation ? [node.annotation] : []);
		a.equalValues(annotations, [{ name: 'INTEGER' }, { name: 'STRING', length: 12 }, { name: 'DOUBLE' }, { name: 'DOUBLE' }, { name: 'SINGLE' }]);
		const directive = root.children[0];
		a.equalValues(directive?.kind === 'defaulttype' && directive.ranges, [['A', 'C']]);
	});
	a.test('empty analysis and independent calls', a => {
		const first = analyze(parse(''));
		a.equalValues([first.symbols, first.data, first.errors], [[], [], []]);
		a.equal(first.scopes.length, 1);
		const second = analyze(parse('x = 1'));
		a.equal(second.symbols[0]?.id, 0);
		a.equal(first.symbols.length, 0);
	});
	a.test('forward declarations and case-insensitive references', a => {
		const root = parse('PRINT Count\nDIM count AS INTEGER\nCOUNT = 2');
		const result = analyze(root);
		a.equalValues(result.errors, []);
		const value = result.symbols[0];
		a.equal(value?.type?.name, 'integer');
		a.equal(value?.references?.length, 2);
		for (const node of nodes(root).filter(node => node.kind === 'ident'))
			a.equal(node.resolved, value);
		a.equal(value?.definition, root.children[1]);
	});
	a.test('suffixes, defaults and implicit arrays', a => {
		const result = analyze(parse('DEFINT A-C\na = 1\nb$ = "x"\nz = 2\nDEFDBL Z\nz2 = 3\nitems(1) = 4'));
		a.equalValues(result.errors, []);
		a.equalValues(result.symbols.map(value => [value.name, value.type?.name, value.array]), [['a', 'integer', false], ['b$', 'string', false], ['z', 'single', false], ['z2', 'double', false], ['items', 'single', true]]);
	});
	a.test('procedure locals, shared module variables and shadowing', a => {
		const root = parse('DIM hidden AS INTEGER\nDIM SHARED visible AS INTEGER\nSUB worker(hidden AS DOUBLE)\nhidden = 2\nvisible = 3\nprivate = 4\nEND SUB\nhidden = 1');
		const result = analyze(root);
		a.equalValues(result.errors, []);
		const hidden = result.symbols.filter(value => value.name === 'hidden');
		a.equal(hidden.length, 2);
		a.equalValues(hidden.map(value => value.references?.length), [1, 1]);
		a.equal(result.symbols.find(value => value.name === 'visible')?.references?.length, 1);
		a.equal(result.symbols.find(value => value.name === 'private')?.scopeId, 1);
	});
	a.test('unshared module variables are not visible inside procedures', a => {
		const result = analyze(parse('DIM x AS INTEGER\nSUB worker()\nx = 2\nEND SUB\nx = 1'));
		a.equalValues(result.errors, []);
		a.equalValues(result.symbols.filter(value => value.name === 'x').map(value => [value.scopeId, value.type?.name]), [[0, 'integer'], [1, 'single']]);
	});
	a.test('forward calls, signatures, array indexing and function results', a => {
		const root = parse('CALL work(1)\nPRINT total(2)\nDIM values(3) AS INTEGER\nvalues(1) = 2\nDECLARE SUB work(x AS INTEGER)\nSUB work(x AS INTEGER)\nPRINT x\nEND SUB\nFUNCTION total(n AS INTEGER) AS INTEGER\ntotal = n\nEND FUNCTION');
		const result = analyze(root);
		a.equalValues(result.errors.map(error => error.message), []);
		const calls = nodes(root).filter(node => node.kind === 'call');
		a.equalValues(calls.map(node => node.resolved?.role), ['procedure', 'procedure', 'variable']);
		const proc = result.symbols.find(value => value.name === 'work');
		a.equal(proc?.declarations.length, 2);
		a.equal(proc?.definition?.kind, 'procedure');
		const output = result.symbols.find(value => value.role === 'result');
		a.equal(output?.references?.length, 1);
		a.equal(output?.type?.name, 'integer');
	});
	a.test('scoped labels and DATA RESTORE positions', a => {
		const root = parse('GOTO done\nfirst: DATA 1, 2\ndone: DATA 3\nRESTORE first\nRESTORE 100\n100 DATA 4\nSUB worker()\ndone: PRINT 1\nGOTO done\nEND SUB\nRESTORE');
		const result = analyze(root);
		a.equalValues(result.errors, []);
		a.equal(result.data.length, 4);
		a.equalValues(nodes(root).filter(node => node.kind === 'restore').map(node => node.dataOffset), [0, 3, 0]);
		a.equalValues(result.symbols.filter(value => value.name === 'done').map(value => value.references?.length), [1, 1]);
	});
	a.test('forward types and direct field links', a => {
		const root = parse('DIM p AS Point\np.x = 2\nTYPE Point\nx AS DOUBLE\nEND TYPE');
		const result = analyze(root);
		a.equalValues(result.errors, []);
		const member = nodes(root).find(node => node.kind === 'member');
		const field = result.symbols.find(value => value.role === 'field');
		a.equal(member?.resolved, field);
		a.equal(field?.type?.name, 'double');
		a.equal(result.symbols[0]?.type?.symbol, result.symbols.find(value => value.role === 'type'));
	});
	a.test('deterministic IDs and stale-link cleanup on reanalysis', a => {
		const source = 'DIM x AS INTEGER\nx = 1\nSUB worker()\ny = 2\nEND SUB';
		const root = parse(source);
		const first = analyze(root);
		const snapshot = first.symbols.map(value => [value.id, value.scopeId, value.name, value.references?.length]);
		const second = analyze(root);
		a.equalValues(second.symbols.map(value => [value.id, value.scopeId, value.name, value.references?.length]), snapshot);
		a.equalValues(analyze(parse(source)).symbols.map(value => [value.id, value.scopeId, value.name, value.references?.length]), snapshot);
		a.ok(second.symbols[0] !== first.symbols[0]);
		root.children.splice(0, 1);
		const third = analyze(root);
		a.equal(third.symbols.find(value => value.name === 'x')?.type?.name, 'single');
		for (const node of nodes(root))
			if (node.resolved)
				a.ok(third.symbols.includes(node.resolved));
	});
	a.test('local SHARED aliases forward module declarations without exporting them', a => {
		const result = analyze(parse('SUB first()\nSHARED value AS INTEGER\nvalue = 2\nEND SUB\nSUB second()\nvalue = 3\nEND SUB\nDIM value AS INTEGER\nvalue = 1'));
		a.equalValues(result.errors, []);
		const values = result.symbols.filter(value => value.name === 'value');
		a.equal(values.length, 2);
		const global = values.find(value => value.scopeId === 0);
		a.equal(global?.references?.length, 2);
		a.equal(result.scopes[1]?.symbols.get('value'), global);
	});
	a.test('procedure-local defaults do not change module defaults', a => {
		const result = analyze(parse('SUB worker()\nDEFINT A-Z\nx = 1\nEND SUB\nx = 2'));
		a.equalValues(result.errors, []);
		a.equalValues(result.symbols.filter(value => value.name === 'x').map(value => value.type?.name), ['integer', 'single']);
	});
	a.test('array parameters, recursive functions and scalar shadowing', a => {
		const result = analyze(parse('DIM items(3) AS INTEGER\nCALL worker(items())\nSUB worker(values() AS INTEGER)\nvalues(1) = 2\nEND SUB\nFUNCTION total(n AS INTEGER) AS INTEGER\ntotal = total(n - 1)\nEND FUNCTION\nSUB shadow()\nDIM total(3)\ntotal(1) = 2\nEND SUB'));
		a.equalValues(result.errors, []);
		a.equal(result.symbols.find(value => value.name === 'total' && value.role === 'procedure')?.references?.length, 1);
	});
	a.test('constants retain inferred string types', a => {
		const result = analyze(parse('CONST title = "hello"\nPRINT title'));
		a.equalValues(result.errors, []);
		a.equal(result.symbols[0]?.type?.name, 'string');
	});
	a.test('failed analysis can be corrected and retried', (a: TestApi) => {
		const root = parse('DIM x AS Missing\nPRINT x');
		const first = analyze(root);
		a.ok(first.errors.length);
		const declaration = root.children[0];
		a.assert(declaration?.kind === 'variable' && declaration.annotation);
		declaration.annotation.name = 'INTEGER';
		const second = analyze(root);
		a.equalValues(second.errors, []);
		a.equal(second.symbols[0]?.type?.name, 'integer');
		a.equal(second.symbols[0]?.references?.length, 1);
	});
	a.test('statement calls and error-handler labels resolve through public parsing', a => {
		const root = parse('worker\nworker(1)\nON ERROR GOTO handler\nRESUME handler\nhandler: PRINT 1\nSUB worker(x AS INTEGER)\nEND SUB');
		const result = analyze(root);
		a.equalValues(result.errors.map(error => error.message), ['Argument count mismatch for worker']);
		a.equal(result.symbols.find(value => value.name === 'handler')?.references?.length, 2);
		a.equalValues(root.children.slice(0, 4).map(node => node.resolved?.role), ['procedure', 'procedure', 'label', 'label']);
	});
	a.test('ANY declarations match concrete definitions and array elements are scalar', a => {
		const result = analyze(parse('DECLARE SUB worker(values() AS ANY)\nDIM items(3) AS INTEGER\nCALL worker(items())\nCALL scalar(items(1))\nSUB worker(values() AS INTEGER)\nEND SUB\nSUB scalar(x AS INTEGER)\nEND SUB'));
		a.equalValues(result.errors, []);
	});
	a.test('module constants are typed before resolving procedure bodies', a => {
		const result = analyze(parse('SUB worker()\nDIM text AS STRING\ntext = title\nEND SUB\nCONST title = "hello"'));
		a.equalValues(result.errors, []);
	});
	a.test('module constant dependencies cannot bind to procedure parameters', a => {
		const root = parse('CONST seed = "hello"\nCONST title = seed\nSUB worker(seed AS INTEGER)\nDIM text AS STRING\ntext = title\nEND SUB');
		const result = analyze(root);
		a.equalValues(result.errors, []);
		const moduleSeed = result.symbols.find(value => value.name === 'seed' && value.role === 'constant');
		a.equal(moduleSeed?.references?.length, 1);
		a.equal(result.symbols.find(value => value.name === 'seed' && value.role === 'parameter')?.references?.length, 0);
		a.equal(result.symbols.find(value => value.name === 'title')?.type?.name, 'string');
	});
	a.test('diagnoses invalid declarations, references and assignments', a => {
		const cases: [
			string,
			string
		][] = [
				['DIM x\nDIM X', 'Duplicate'],
				['SUB demo(x, X)\nEND SUB', 'Duplicate parameter'],
				['here:\nhere:', 'Duplicate label'],
				['TYPE Point\nx AS INTEGER\nx AS DOUBLE\nEND TYPE', 'Duplicate field'],
				['TYPE Point\nx AS INTEGER\nEND TYPE\nTYPE Point\ny AS INTEGER\nEND TYPE', 'Duplicate type'],
				['DECLARE SUB demo(x AS INTEGER)\nSUB demo(x AS DOUBLE)\nEND SUB', 'Incompatible declaration'],
				['DIM x$ AS INTEGER', 'Incompatible type suffix'],
				['DIM x AS Missing', 'Unknown type'],
				['GOTO absent', 'Unknown label'],
				['SUB demo()\nGOTO outside\nEND SUB\noutside:', 'Unknown label'],
				['CALL absent()', 'Unknown procedure'],
				['DIM x\nx.y = 1', 'Unknown field'],
				['CONST x = 1\nx = 2', 'Invalid assignment'],
				['DIM x\nx(1) = 2', 'Expected array'],
				['FUNCTION demo()\nEND FUNCTION\ndemo(1) = 2', 'Invalid function call'],
				['CALL demo(1)\nSUB demo()\nEND SUB', 'Argument count mismatch'],
				['DEFINT Z-A', 'Invalid default type range'],
				['DIM x AS INTEGER\nx = "text"', 'Incompatible assignment'],
				['DIM text AS STRING\ntext = 1', 'Incompatible assignment'],
				['CALL demo("text")\nSUB demo(x AS INTEGER)\nEND SUB', 'Incompatible argument'],
				['SHARED x', 'SHARED outside procedure'],
				['SUB demo()\nSHARED x AS DOUBLE\nEND SUB\nDIM x AS INTEGER', 'Incompatible shared'],
				['SUB demo()\nEND SUB\nSUB demo()\nEND SUB', 'Duplicate procedure'],
				['DIM items(2)\nCALL demo(items())\nSUB demo(x)\nEND SUB', 'Expected scalar argument'],
				['CALL demo(1)\nSUB demo(x())\nEND SUB', 'Expected array argument'],
				['DIM items(2)\nitems = 1', 'Invalid assignment'],
			['READ "literal"', 'Invalid assignment'],
			['DIM items(2)\nitems() = 1', 'Invalid assignment'],
			['DIM items(2)\nCALL demo(items(1))\nSUB demo(x())\nEND SUB', 'Expected array argument'],
				['FUNCTION demo()\nEND FUNCTION\ndemo = 1', 'Invalid assignment'],
			];
		for (const [source, message] of cases) {
			const result = analyze(parse(source));
			a.ok(result.errors.some(error => error.message.includes(message)), source + ': ' + result.errors.map(error => error.message).join(', '));
		}
	});
});
