import { Buffer } from 'node:buffer';
import { stderr } from 'node:process';

export type StatusState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear';

type StatusDetails = {
	/** Omit to address the root record. */
	id?: string;
	/** Stable machine-readable program name. */
	app?: string;
	/** Human-readable label, at most 192 UTF-8 bytes. */
	title?: string;
	/** One line of text, at most 2048 UTF-8 bytes. Encoded automatically. */
	message?: string;
};

type ReportsByState = {
	idle: StatusDetails;
	working: StatusDetails & { progress?: number };
	done: StatusDetails;
	blocked: StatusDetails & { kind?: 'permission' | 'question' | 'auth'; progress?: number };
	error: StatusDetails;
	clear: Pick<StatusDetails, 'id'>;
};

/** Fields supported by a state. Each report replaces its record. */
export type StatusReport<State extends StatusState = StatusState> = ReportsByState[State];

export type WriteStatusOptions = {
	/** Defaults to process.stderr. */
	stream?: {
		readonly isTTY?: boolean;
		write(sequence: string): unknown;
	};
	/** Defaults to stream.isTTY. Set true to emit through a pipe. */
	enabled?: boolean;
};

function validateSegment(value: string, key: string): void {
	const pattern = /^[A-Za-z0-9_.+-]{1,32}$/u;
	if (!pattern.test(value)) {
		throw new TypeError(`${key} must match ${pattern}`);
	}
}

function encodeText(value: string, key: string, limit: number): string {
	// OSC 7501 forbids C0, DEL, and C1 controls in decoded text.
	// oxlint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
		throw new TypeError(`${key} must not contain control characters`);
	}
	if (Buffer.byteLength(value, 'utf8') > limit) {
		throw new RangeError(`${key} must not exceed ${limit} UTF-8 bytes`);
	}
	return Buffer.from(value, 'utf8').toString('base64');
}

/** Encode an OSC 7501 report without writing it. */
export function encodeStatus<State extends StatusState>(state: State, report: StatusReport<State> = {}): string {
	const { id, app, kind, progress, title, message }: StatusReport<'blocked'> = report;
	const pairs = [`state=${state}`];

	if (id !== undefined) {
		const segments = id.split('/');
		if (id.length > 128 || segments.length > 8) {
			throw new RangeError('id must not exceed 128 ASCII bytes or 8 levels');
		}
		for (const segment of segments) {
			validateSegment(segment, 'id segment');
		}
		pairs.push(`id=${id}`);
	}
	if (kind !== undefined) {
		pairs.push(`kind=${kind}`);
	}
	if (progress !== undefined) {
		if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
			throw new RangeError('progress must be an integer from 0 to 100');
		}
		pairs.push(`progress=${progress}`);
	}
	if (app !== undefined) {
		validateSegment(app, 'app');
		pairs.push(`app=${app}`);
	}
	if (title !== undefined) {
		pairs.push(`title=${encodeText(title, 'title', 192)}`);
	}
	if (message !== undefined) {
		pairs.push(`msg=${encodeText(message, 'message', 2048)}`);
	}

	return `\x1b]7501;${pairs.join(':')}\x1b\\`;
}

function stateWriter<State extends StatusState>(state: State) {
	return (report: StatusReport<State> = {}, options: WriteStatusOptions = {}): boolean => {
		const sequence = encodeStatus(state, report);
		const stream = options.stream ?? stderr;
		if (!(options.enabled ?? stream.isTTY)) {
			return false;
		}
		stream.write(sequence);
		return true;
	};
}

/** Write a report. Returns true if emitted, false if disabled. */
export const oscStatus = {
	idle: stateWriter('idle'),
	working: stateWriter('working'),
	done: stateWriter('done'),
	blocked: stateWriter('blocked'),
	error: stateWriter('error'),
	clear: stateWriter('clear'),
};
