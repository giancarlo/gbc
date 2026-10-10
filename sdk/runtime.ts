import type { Position } from './index.js';

export const RUNTIME_STATUS = {
	applied: 0,
	malformed: -1,
	unsupported: -2,
	queueFull: -3,
	invalidState: -4,
	invalidType: -5,
	invalidValue: -6,
	staleInput: -7,
	cancelled: -9,
} as const;

export type RuntimeStatus =
	(typeof RUNTIME_STATUS)[keyof typeof RUNTIME_STATUS];

export const RUNTIME_RECORD = {
	state: 1,
	commandResult: 2,
	input: 3,
	diagnostic: 4,
	completed: 5,
	failed: 6,
	disposed: 7,
	inputCancelled: 8,
} as const;

export const RUNTIME_STATE = {
	ready: 1,
	running: 2,
	paused: 3,
	stopping: 4,
} as const;

export const RUNTIME_INPUT_TYPE = {
	string: 1,
	number: 2,
	boolean: 3,
} as const;

export const RUNTIME_SEVERITY = {
	info: 1,
	warning: 2,
	error: 3,
} as const;

export const RUNTIME_COMPLETION = {
	returned: 1,
	stopped: 2,
} as const;

export const RUNTIME_BUFFER_HEADER_BYTES = 8;
export const RUNTIME_RECORD_HEADER_BYTES = 8;

export interface RuntimeExports {
	readonly memory: { readonly buffer: ArrayBufferLike };
	init(): number;
	start(): number;
	pause(): number;
	resume(): number;
	stop(): number;
	dispose(): number;
	advance(budget: number): void;
	input(inputId: number, pointer: number, byteLength: number): number;
	cancel(commandId: number): number;
	commandBuffer(): number;
	read(): number;
}

export interface RuntimeDiagnostic {
	readonly severity: keyof typeof RUNTIME_SEVERITY;
	readonly message: string;
	readonly code?: string;
	readonly position?: Position;
}

export interface RuntimeError {
	readonly name: string;
	readonly message: string;
	readonly code?: string;
	readonly position?: Position;
	readonly stack?: string;
}

export interface RuntimeInputRequest {
	readonly inputId: number;
	readonly prompt: string;
	readonly type: keyof typeof RUNTIME_INPUT_TYPE;
}

export type RuntimeInputResponse = { readonly inputId: number } & (
	| { readonly type: 'string'; readonly value: string }
	| { readonly type: 'number'; readonly value: number }
	| { readonly type: 'boolean'; readonly value: boolean }
);

export type RuntimeEvent =
	| {
			readonly kind: 'state';
			readonly state: keyof typeof RUNTIME_STATE;
	  }
	| {
			readonly kind: 'commandResult';
			readonly commandId: number;
			readonly status: RuntimeStatus;
	  }
	| { readonly kind: 'input'; readonly request: RuntimeInputRequest }
	| { readonly kind: 'inputCancelled'; readonly inputId: number }
	| { readonly kind: 'diagnostic'; readonly diagnostic: RuntimeDiagnostic }
	| {
			readonly kind: 'completed';
			readonly reason: keyof typeof RUNTIME_COMPLETION;
			readonly exitCode: number;
	  }
	| { readonly kind: 'failed'; readonly error: RuntimeError }
	| { readonly kind: 'disposed' };

export interface RuntimeRunRecord<
	Record extends RuntimeEvent | RuntimeInputResponse = RuntimeEvent,
> {
	readonly runId: string;
	readonly record: Record;
}
