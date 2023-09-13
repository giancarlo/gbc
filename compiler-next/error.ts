export interface ErrorMap {
	unterminated: { what: string };
	expected: { what: string; butGot?: string };
}

export type ScannerErrorCode = 'expected' | 'unterminated';
