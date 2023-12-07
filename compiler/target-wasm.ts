///<amd-module name="@cxl/gbc.compiler/target-wasm.js"/>
import type { Node } from './node.js';

declare class TextEncoder {
	constructor();
	encode(data: string): Uint8Array;
}

function encode(content: string) {
	return new TextEncoder().encode(content);
}

/*const i32 = 0x7f;
const i64 = 0x7e;
const f32 = 0x7d;
const f64 = 0x7c;
const v128 = 0x7b;
const funcref = 0x70;
const externref = 0x6f;
const end = 0x0b;*/

type Limits = [number] | [number, number];

export function Bytecode() {
	function vector(data: Uint8Array) {
		out.push(data.length);
		out.push(...data);
	}

	function functype() {
		out.push(0x60);
	}

	function tabletype(reftype: number, [min, max]: Limits) {
		out.push(reftype);
		limits(min, max);
	}

	function limits(min: number, max?: number, dest = out) {
		dest.push(max === undefined ? 0 : 1);
		dest.push(min);
		if (max !== undefined) dest.push(max);
		return dest;
	}

	function block() {
		out.push(2);
	}

	// MAGIC + VERSION
	const out: number[] = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];

	const br = (labelidx: number) => out.push(0x0c, labelidx);
	const br_if = (labelidx: number) => out.push(0x0d, labelidx);
	const drop = () => out.push(0x1a);
	const select = () => out.push(0x1b);
	const empty = 0x40;
	const string = (data: string) => vector(encode(data));
	const unreachable = () => out.push(0);
	const nop = () => out.push(1);
	const ret = () => out.push(0x0f);
	const call = (idx: number) => out.push(0x10, idx);
	const call_indirect = (typeidx: number, tableidx: number) =>
		out.push(0x11, typeidx, tableidx);
	//const functions = [];

	return {
		out: new Uint8Array(out).buffer,

		block,
		br,
		br_if,
		call,
		call_indirect,
		drop,
		empty,
		functype,
		limits,
		nop,
		unreachable,
		ret,
		select,
		string,
		tabletype,
		vector,
	};
}

export function compileWasm(ast: Node) {
	const { out } = Bytecode();

	function compile(node: Node) {
		switch (node.kind) {
		}
	}

	compile(ast);

	return out;
}
