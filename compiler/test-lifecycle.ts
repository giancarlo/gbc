import { spec } from './test-api.js';
import type { SpecApi } from './test-api.js';
import {
	RUNTIME_COMPLETION,
	RUNTIME_RECORD,
	RUNTIME_STATE,
	RUNTIME_STATUS,
	type RuntimeExports,
} from '@cxl/gbc.sdk';
import { Program } from './program.js';
import { bufferView, instantiateWasm } from './host.js';

const SOURCE = `staging = Buffer<Int32>(1024);
ast = Buffer<Int32>(1024);
slots = Buffer<Int32>(64);
vm = Buffer<Int32>(6);
commands = Buffer<Uint8>(256);
events = Buffer<Uint8>(256);
word = (target: var Buffer<Uint8>, offset: Int32, value: Int32) {
	set(target, offset, Uint8(value & 255));
	set(target, offset + 1, Uint8((value :> 8) & 255));
	set(target, offset + 2, Uint8((value :> 16) & 255));
	set(target, offset + 3, Uint8((value :> 24) & 255))
};
event = (kind: Int32, value: Int32) {
	offset = get(vm, 4);
	word(events, offset, kind);
	word(events, offset + 4, 12);
	word(events, offset + 8, value);
	set(vm, 4, offset + 12)
};
setState = (state: Int32): Int32 {
	set(vm, 0, state);
	event(1, state);
	next 0
};
transition = (state: Int32): Int32 {
	get(vm, 4) > 244 ? -3 : setState(state)
};
complete = (reason: Int32): Int32 {
	offset = get(vm, 4);
	word(events, offset, 5);
	word(events, offset + 4, 16);
	word(events, offset + 8, reason);
	word(events, offset + 12, 0);
	set(vm, 4, offset + 16);
	set(vm, 0, 5);
	next 0
};
finish = (reason: Int32): Int32 {
	get(vm, 4) > 240 ? -3 : complete(reason)
};
fail = (code: Int32): Int32 {
	set(vm, 5, code);
	set(vm, 0, 6);
	event(6, code);
	next code
};
export inputStorage = (): Buffer<Int32> { staging };
export stateBuffer = (): Buffer<Int32> { vm };
export commandBuffer = (): Buffer<Uint8> { commands };
export read = (): Buffer<Uint8> { events };
export acknowledge = () { set(vm, 3, 0); set(vm, 4, 0) };
initialize = (): Int32 {
	loop >> (i: Int32) { i >= 6 ? break; set(vm, i, 0) };
	next transition(1)
};
export init = (): Int32 {
	get(vm, 0) != 0 && get(vm, 0) != 7 ? -4 : initialize()
};
valueLink = (index: Int32, pc: Int32): Bool {
	index < 0 || index >= pc ? false : get(staging, 2 + index * 4) >= 1 && get(staging, 2 + index * 4) <= 5
};
validateNodes = (count: Int32, words: Int32): Int32 {
	validity = Buffer<Int32>(1);
	set(validity, 0, 1);
	loop >> (i: Int32) {
		i >= count ? break;
		offset = 2 + i * 4;
		kind = get(staging, offset);
		a = get(staging, offset + 1);
		b = get(staging, offset + 2);
		set(validity, 0, get(validity, 0) == 1 && kind >= 1 && kind <= 9 && get(staging, offset + 3) == 0 ? 1 : 0);
		set(validity, 0, get(validity, 0) == 1 && (kind >= 2 && kind <= 5 ? valueLink(a, i) && valueLink(b, i) : true) ? 1 : 0);
		set(validity, 0, get(validity, 0) == 1 && (kind == 6 ? valueLink(a, i) : true) ? 1 : 0);
		set(validity, 0, get(validity, 0) == 1 && (kind == 9 ? a >= 2 + count * 4 && b >= 0 && b <= 248 && a <= words - b : true) ? 1 : 0);
		loop >> (j: Int32) {
			j >= (kind == 9 && get(validity, 0) == 1 ? b : 0) ? break;
			set(validity, 0, get(validity, 0) == 1 && get(staging, a + j) >= 0 && get(staging, a + j) <= 255 ? 1 : 0);
		}
	};
	next get(staging, 2 + (count - 1) * 4) != 8 || get(validity, 0) == 0 ? -1 : 0
};
validate = (words: Int32): Int32 {
	words < 2 || words > 1024 ? -1 :
	get(staging, 0) != 1 ? -2 :
	get(staging, 1) < 1 || get(staging, 1) > 64 || 2 + get(staging, 1) * 4 > words ? -1 :
	validateNodes(get(staging, 1), words)
};
commitLoad = (words: Int32): Int32 {
	loop >> (i: Int32) { i >= words ? break; set(ast, i, get(staging, i)) };
	set(vm, 1, get(ast, 1));
	set(vm, 2, 0);
	set(vm, 5, 0);
	next 0
};
loadValidated = (words: Int32): Int32 {
	result: var = validate(words);
	next result != 0 ? result : commitLoad(words)
};
export load = (words: Int32): Int32 {
	get(vm, 0) != 1 ? -4 : loadValidated(words)
};
export start = (): Int32 { get(vm, 0) != 1 || get(vm, 1) == 0 ? -4 : transition(2) };
export pause = (): Int32 { get(vm, 0) != 2 ? -4 : transition(3) };
export resume = (): Int32 { get(vm, 0) != 3 ? -4 : transition(2) };
export stop = (): Int32 { get(vm, 0) != 2 && get(vm, 0) != 3 ? -4 : finish(2) };
cleanup = (): Int32 {
	loop >> (i: Int32) { i >= 1024 ? break; set(ast, i, 0); set(staging, i, 0) };
	loop >> (i: Int32) { i >= 64 ? break; set(slots, i, 0) };
	loop >> (i: Int32) { i >= 256 ? break; set(commands, i, Uint8(0)) };
	set(vm, 0, 7);
	set(vm, 1, 0);
	set(vm, 2, 0);
	set(vm, 3, 0);
	set(vm, 5, 0);
	event(7, 0);
	next 0
};
export dispose = (): Int32 { get(vm, 0) == 7 ? 0 : get(vm, 4) > 244 ? -3 : cleanup() };
export input = (inputId: Int32, pointer: Int32, byteLength: Int32): Int32 { -2 };
export cancel = (commandId: Int32): Int32 { -2 };
export growMemory = (bytes: Int32): Int32 { bytes < 0 || bytes > 1048576 ? -6 : length(Buffer<Uint8>(bytes)) };
constant = (pc: Int32, value: Int32): Int32 { set(slots, pc, value); next 0 };
divide = (pc: Int32, left: Int32, right: Int32): Int32 {
	left / right >> Int32 { constant(pc, $) } | Error { fail(-6) }
};
calculate = (pc: Int32, kind: Int32, left: Int32, right: Int32): Int32 {
	kind == 5 ? divide(pc, left, right) :
	constant(pc, kind == 2 ? left + right : kind == 3 ? left - right : left * right)
};
copyText = (offset: Int32, a: Int32, b: Int32) {
	loop >> (j: Int32) { j >= b ? break; set(commands, offset + 8 + j, Uint8(get(ast, a + j))) }
};
writeOutput = (kind: Int32, a: Int32, b: Int32, size: Int32): Int32 {
	offset = get(vm, 3);
	word(commands, offset, kind == 6 ? 1 : 2);
	word(commands, offset + 4, size);
	kind == 6 ? word(commands, offset + 8, get(slots, a)) : copyText(offset, a, b);
	set(vm, 3, offset + size);
	next 0
};
backpressure = (): Int32 { transition(3) >> Int32 { -3 } };
output = (kind: Int32, a: Int32, b: Int32): Int32 {
	size: var = kind == 6 ? 12 : 8 + b;
	next get(vm, 3) > 256 - size ? backpressure() : writeOutput(kind, a, b, size)
};
execute = (pc: Int32): Int32 {
	offset = 2 + pc * 4;
	kind = get(ast, offset);
	a = get(ast, offset + 1);
	b = get(ast, offset + 2);
	next kind == 1 ? constant(pc, a) :
	kind >= 2 && kind <= 5 ? calculate(pc, kind, get(slots, a), get(slots, b)) :
	kind == 6 || kind == 9 ? output(kind, a, b) :
	kind == 7 ? transition(3) : finish(1)
};
export advance = (budget: Int32) {
	loop >> (step: Int32) {
		step >= budget || get(vm, 0) != 2 || get(vm, 4) > 240 ? break;
		pc = get(vm, 2);
		result = execute(pc);
		result != 0 ? break;
		set(vm, 2, pc + 1)
	}
}`;

type Node = readonly [kind: number, a?: number, b?: number, reserved?: number];

function encode(nodes: readonly Node[], text = ''): Int32Array {
	const bytes = new TextEncoder().encode(text);
	return Int32Array.from([
		1,
		nodes.length,
		...nodes.flatMap(([kind, a = 0, b = 0, reserved = 0]) => [kind, a, b, reserved]),
		...bytes,
	]);
}

interface ProofExports extends RuntimeExports {
	inputStorage(): number;
	stateBuffer(): number;
	load(words: number): number;
	acknowledge(): void;
	growMemory(bytes: number): number;
}

function host(bytes: Uint8Array, runId = 'proof-1') {
	const instance = instantiateWasm(bytes);
	const functions = ['init', 'start', 'pause', 'resume', 'stop', 'dispose', 'advance', 'input', 'cancel', 'commandBuffer', 'read', 'inputStorage', 'stateBuffer', 'load', 'acknowledge', 'growMemory'] as const;
	for (const name of functions)
		if (typeof instance.exports[name] !== 'function') throw new Error(`Missing export ${name}`);
	const api = instance.exports as unknown as ProofExports;
	const state = () => bufferView(instance, api.stateBuffer(), Int32Array).slice();
	const records = (pointer: number, length: number) => {
		const bytes = bufferView(instance, pointer, Uint8Array).slice(0, length);
		const data = new DataView(bytes.buffer);
		const result: { kind: number; payload: Uint8Array }[] = [];
		for (let offset = 0; offset < length;) {
			if (offset + 8 > length) throw new Error('Truncated record');
			const size = data.getUint32(offset + 4, true);
			if (size < 8 || offset + size > length) throw new Error('Invalid record length');
			result.push({ kind: data.getUint32(offset, true), payload: bytes.slice(offset + 8, offset + size) });
			offset += size;
		}
		return result;
	};
	return {
		runId,
		api,
		instance,
		state,
		load(program: Int32Array) {
			if (program.length > 1024) throw new RangeError('Input capacity exceeded');
			bufferView(instance, api.inputStorage(), Int32Array).set(program);
			return api.load(program.length);
		},
		commands() { return records(api.commandBuffer(), state()[3] ?? 0); },
		events() { return records(api.read(), state()[4] ?? 0); },
	};
}

function integer(payload: Uint8Array, offset = 0): number {
	return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getInt32(offset, true);
}

export default spec('GB Wasm interpreter lifecycle', s => {
	const compiled = Program({ sys: { readFile: () => SOURCE, readBytes: () => new Uint8Array() } }).compileFile('lifecycle.gb');
	s.test('compiles the proof to a real Wasm module', (a: SpecApi) => {
		a.equalValues(compiled.errors.map(error => error.message), []);
		a.assert(compiled.bytes);
		instantiateWasm(compiled.bytes);
	});
	const create = () => {
		if (!compiled.bytes) throw new Error(compiled.errors.map(error => error.message).join('\n'));
		return host(compiled.bytes);
	};
	s.test('copies serialized AST input, bounds execution, yields, resumes and halts', (a: SpecApi) => {
		const h = create();
		a.equal(h.api.start(), RUNTIME_STATUS.invalidState);
		a.equal(h.api.init(), RUNTIME_STATUS.applied);
		a.equal(h.api.init(), RUNTIME_STATUS.invalidState);
		a.equal(h.api.start(), RUNTIME_STATUS.invalidState);
		a.equal(h.load(encode([[1, 6], [1, 7], [4, 0, 1], [6, 2], [7], [1, -2], [2, 2, 5], [6, 6], [8]])), 0);
		bufferView(h.instance, h.api.inputStorage(), Int32Array).fill(0);
		a.equal(h.api.start(), 0);
		a.equal(h.api.start(), -4);
		h.api.advance(0);
		h.api.advance(-1);
		a.equal(h.state()[2], 0);
		h.api.advance(3);
		a.equal(h.state()[2], 3);
		a.equal(h.state()[0], RUNTIME_STATE.running);
		a.equal(h.api.pause(), 0);
		h.api.advance(99);
		a.equal(h.state()[2], 3);
		a.equal(h.api.pause(), -4);
		a.equal(h.api.resume(), 0);
		h.api.advance(99);
		a.equal(h.state()[0], RUNTIME_STATE.paused);
		a.equal(h.state()[2], 5);
		a.equal(h.api.resume(), 0);
		h.api.advance(99);
		a.equalValues(h.commands().map(record => [record.kind, integer(record.payload)]), [[1, 42], [1, 40]]);
		const completed = h.events().at(-1);
		a.equal(completed?.kind, RUNTIME_RECORD.completed);
		a.assert(completed);
		a.equal(integer(completed.payload), RUNTIME_COMPLETION.returned);
		a.equal(integer(completed.payload, 4), 0);
		const before = h.state();
		h.api.advance(99);
		a.equalValues(h.state(), before);
		const output = h.commands();
		a.equalValues(h.commands(), output);
		a.equal(h.api.resume(), -4);
		a.equal(h.api.stop(), -4);
	});
	s.test('rejects malformed input atomically and permits reload before start', (a: SpecApi) => {
		const h = create();
		a.equal(h.api.load(0), RUNTIME_STATUS.invalidState);
		h.api.init();
		const original = encode([[1, 17], [6, 0], [8]]);
		a.equal(h.load(original), 0);
		const bad = [
			Int32Array.of(), Int32Array.of(1), Int32Array.of(1, 0),
			Int32Array.of(1, 65), Int32Array.of(1, -1),
			encode([[0], [8]]), encode([[10], [8]]), encode([[1]]),
			encode([[2, 0, 0], [8]]), encode([[1], [2, -1, 0], [8]]),
			encode([[1], [2, 0, 2], [8]]), encode([[1], [6, 1], [8]]),
			encode([[7], [6, 0], [8]]), encode([[1, 0, 0, 1], [8]]),
			encode([[9, 0, 1], [8]]), encode([[9, 10, -1], [8]]),
			encode([[9, 10, 249], [8]]), encode([[9, 2147483647, 2], [8]]),
			Int32Array.of(1, 2, 9, 10, 1, 0, 8, 0, 0, 0, 256),
			Int32Array.of(1, 2, 9, 10, 1, 0, 8, 0, 0, 0, -1),
		];
		for (const input of bad) {
			const before = h.state();
			a.equal(h.load(input), RUNTIME_STATUS.malformed);
			a.equalValues(h.state(), before);
		}
		a.equal(h.api.load(1025), -1);
		a.equal(h.api.load(-1), -1);
		a.throws(() => h.load(new Int32Array(1025)), { name: 'RangeError', message: 'Input capacity exceeded' });
		const unsupported = original.slice();
		unsupported[0] = 2;
		a.equal(h.load(unsupported), RUNTIME_STATUS.unsupported);
		a.equal(h.api.start(), 0);
		a.equal(h.load(original), RUNTIME_STATUS.invalidState);
		h.api.advance(99);
		a.equal(integer(h.commands()[0]?.payload ?? new Uint8Array()), 17);
		a.equal(h.load(original), RUNTIME_STATUS.invalidState);
		h.api.dispose();
		h.api.init();
		a.equal(h.load(encode([[1, 3], [6, 0], [8]])), 0);
		a.equal(h.load(original), 0);
		h.api.start();
		h.api.advance(99);
		a.equal(integer(h.commands()[0]?.payload ?? new Uint8Array()), 17);
	});
	s.test('encodes ordered integer and UTF-8 command records until acknowledgement', (a: SpecApi) => {
		const h = create();
		const text = 'hi 😀';
		const encodedText = new TextEncoder().encode(text);
		h.api.init();
		a.equal(h.load(encode([[1, -123], [6, 0], [9, 18, encodedText.length], [8]], text)), 0);
		h.api.start();
		h.api.advance(99);
		const commands = h.commands();
		a.equalValues(commands.map(record => record.kind), [1, 2]);
		a.equalValues(commands[0]?.payload, Uint8Array.of(133, 255, 255, 255));
		a.equal(integer(commands[0]?.payload ?? new Uint8Array()), -123);
		a.equalValues(commands[1]?.payload, encodedText);
		a.equal(new TextDecoder('utf-8', { fatal: true }).decode(commands[1]?.payload), text);
		a.equalValues(h.commands(), commands);
		a.equalValues(h.events().map(record => record.kind), [RUNTIME_RECORD.state, RUNTIME_RECORD.state, RUNTIME_RECORD.completed]);
		a.equal(h.runId, 'proof-1');
		h.api.acknowledge();
		a.equalValues(h.commands(), []);
		a.equalValues(h.events(), []);
		h.api.acknowledge();
		a.equalValues(h.events(), []);
	});
	s.test('pauses on output backpressure and retries the same node after acknowledgement', (a: SpecApi) => {
		const h = create();
		h.api.init();
		a.equal(h.load(encode([[1, 9], ...Array.from({ length: 25 }, (): Node => [6, 0]), [8]])), 0);
		h.api.start();
		h.api.advance(99);
		a.equal(h.commands().length, 21);
		a.equal(h.state()[0], RUNTIME_STATE.paused);
		a.equal(h.state()[2], 22);
		a.equal(h.api.resume(), 0);
		h.api.advance(99);
		a.equal(h.state()[2], 22);
		a.equal(h.commands().length, 21);
		h.api.acknowledge();
		a.equal(h.api.resume(), 0);
		h.api.advance(99);
		a.equalValues(h.commands().map(record => integer(record.payload)), [9, 9, 9, 9]);
		a.equal(h.events().at(-1)?.kind, RUNTIME_RECORD.completed);
	});
	s.test('reports arithmetic failures without traps and disposes failed runs', (a: SpecApi) => {
		for (const [left, right] of [[1, 0], [-2147483648, -1]]) {
			const h = create();
			h.api.init();
			a.equal(h.load(encode([[1, left], [1, right], [5, 0, 1], [6, 2], [8]])), 0);
			h.api.start();
			h.api.advance(99);
			a.equal(h.state()[2], 2);
			a.equal(h.state()[5], RUNTIME_STATUS.invalidValue);
			a.equal(h.events().at(-1)?.kind, RUNTIME_RECORD.failed);
			a.equal(integer(h.events().at(-1)?.payload ?? new Uint8Array()), RUNTIME_STATUS.invalidValue);
			a.equalValues(h.commands(), []);
			const before = h.state();
			h.api.advance(99);
			a.equalValues(h.state(), before);
			a.equal(h.api.start(), -4);
			a.equal(h.api.pause(), -4);
			a.equal(h.api.resume(), -4);
			a.equal(h.api.stop(), -4);
			a.equal(h.api.dispose(), 0);
			a.equalValues(h.state().slice(0, 4), Int32Array.of(7, 0, 0, 0));
			a.equal(h.state()[5], 0);
			a.equal(h.events().at(-1)?.kind, RUNTIME_RECORD.disposed);
			a.assert(bufferView(h.instance, h.api.inputStorage(), Int32Array).every(value => value === 0));
			a.equal(h.api.dispose(), 0);
			a.equal(h.api.init(), 0);
			a.equal(h.api.start(), -4);
		}
		const h = create();
		h.api.init();
		h.load(encode([[1, 21], [1, 4], [3, 0, 1], [5, 2, 1], [6, 3], [8]]));
		h.api.start();
		h.api.advance(99);
		a.equal(integer(h.commands()[0]?.payload ?? new Uint8Array()), 4);
	});
	s.test('retains pointers and VM state across actual memory growth', (a: SpecApi) => {
		const h = create();
		h.api.init();
		h.load(encode([[1, 12], [6, 0], [7], [1, 30], [2, 0, 3], [6, 4], [8]]));
		h.api.start();
		h.api.advance(99);
		const pointers = [h.api.inputStorage(), h.api.stateBuffer(), h.api.commandBuffer(), h.api.read()];
		const oldInput = bufferView(h.instance, pointers[0] ?? 0, Int32Array);
		const oldCommands = bufferView(h.instance, pointers[2] ?? 0, Uint8Array);
		const before = h.state();
		const output = h.commands();
		const events = h.events();
		const memory = h.api.memory.buffer;
		a.equal(h.api.growMemory(-1), RUNTIME_STATUS.invalidValue);
		a.equal(h.api.growMemory(1048577), RUNTIME_STATUS.invalidValue);
		a.equal(h.api.growMemory(1048576), 1048576);
		a.assert(h.api.memory.buffer !== memory);
		a.assert(h.api.memory.buffer.byteLength > 65536);
		a.equal(oldInput.byteLength, 0);
		a.equal(oldCommands.byteLength, 0);
		a.equalValues([h.api.inputStorage(), h.api.stateBuffer(), h.api.commandBuffer(), h.api.read()], pointers);
		a.equalValues(h.state(), before);
		a.equalValues(h.commands(), output);
		a.equalValues(h.events(), events);
		const grownMemory = h.api.memory.buffer;
		a.equal(h.api.growMemory(1048576), 1048576);
		a.equal(h.api.memory.buffer, grownMemory);
		h.api.resume();
		h.api.advance(99);
		a.equalValues(h.commands().map(record => integer(record.payload)), [12, 42]);
		a.equal(h.api.dispose(), 0);
		a.assert(bufferView(h.instance, h.api.commandBuffer(), Uint8Array).every(value => value === 0));
		a.equal(h.api.growMemory(0), 0);
	});
	s.test('stops, disposes and reinitializes through public lifecycle exports', (a: SpecApi) => {
		for (const paused of [false, true]) {
			const h = create();
			a.equal(h.api.pause(), -4);
			a.equal(h.api.resume(), -4);
			a.equal(h.api.stop(), -4);
			h.api.init();
			h.load(encode([[1, 99], [6, 0], [8]]));
			h.api.start();
			if (paused) h.api.pause();
			a.equal(h.api.stop(), 0);
			h.api.advance(99);
			a.equalValues(h.commands(), []);
			const completed = h.events().at(-1);
			a.assert(completed);
			a.equal(completed.kind, RUNTIME_RECORD.completed);
			a.equal(integer(completed.payload), RUNTIME_COMPLETION.stopped);
			a.equal(h.api.dispose(), 0);
			a.equal(h.api.dispose(), 0);
			a.equal(h.api.load(2), -4);
			a.equal(h.api.init(), 0);
			a.equal(h.api.start(), -4);
		}
		const h = create();
		a.equal(h.api.dispose(), 0);
		a.equal(h.api.init(), 0);
		a.equal(h.api.dispose(), 0);
		a.equal(h.api.input(1, -1, 2147483647), RUNTIME_STATUS.unsupported);
		a.equal(h.api.cancel(-1), RUNTIME_STATUS.unsupported);
	});
	s.test('bounds lifecycle records and retries transitions after acknowledgement', (a: SpecApi) => {
		const h = create();
		h.api.init();
		h.load(encode([[8]]));
		h.api.start();
		for (let i = 0; i < 9; i++) {
			a.equal(h.api.pause(), 0);
			a.equal(h.api.resume(), 0);
		}
		a.equal(h.api.pause(), 0);
		a.equal(h.state()[4], 252);
		a.equal(h.api.resume(), RUNTIME_STATUS.queueFull);
		a.equal(h.api.stop(), RUNTIME_STATUS.queueFull);
		a.equal(h.api.dispose(), RUNTIME_STATUS.queueFull);
		a.equal(h.state()[0], RUNTIME_STATE.paused);
		a.equal(h.events().length, 21);
		h.api.acknowledge();
		a.equal(h.api.resume(), 0);
		h.api.advance(1);
		a.equal(h.events().at(-1)?.kind, RUNTIME_RECORD.completed);
		a.equal(h.api.dispose(), 0);
	});
});
