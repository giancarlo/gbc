///<amd-module name="@cxl/gbc.compiler/error.js"/>

export interface Position {
	start: number;
	end: number;
	line: number;
	source: string;
}

export class CompilerError {
	constructor(
		public message: string,
		public position: Position,
	) {}
}

export type ErrorApi = ReturnType<typeof ErrorApi>;
export function ErrorApi() {
	const errors: CompilerError[] = [];

	const error = (msg: string, pos: Position) => new CompilerError(msg, pos);

	function pushError(error: CompilerError) {
		errors.push(error);
		if (errors.length > 100) {
			errors.push(
				new CompilerError('Too many errors. Aborting compilation', {
					start: 0,
					end: 0,
					line: 0,
					source: '',
				}),
			);
			throw 'TOO_MANY_ERRORS';
		}
	}

	function catchAndRecover<T>(fn: () => T, recover: () => T) {
		try {
			return fn();
		} catch (e) {
			if (e instanceof CompilerError) {
				pushError(e);
				return recover();
			} else throw e;
		}
	}

	return {
		catchAndRecover,
		errors,
		error,
		pushError,
	};
}
