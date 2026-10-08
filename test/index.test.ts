import { Buffer } from 'node:buffer';
import { stderr } from 'node:process';
import { describe, expect, it, vi } from 'vite-plus/test';
import oscStatus, { encodeStatus } from '../src/index.ts';

describe('encodeStatus', () => {
	it.each(['idle', 'working', 'done', 'blocked', 'error', 'clear'] as const)('encodes %s', (state) => {
		expect(encodeStatus(state)).toBe(`\x1b]7501;state=${state}\x1b\\`);
	});

	it('encodes the Terraform approval example from the specification', () => {
		expect(
			encodeStatus('blocked', {
				kind: 'permission',
				app: 'terraform',
				message: 'Apply 3 to add, 1 to change, 0 to destroy?',
			}),
		).toBe(
			'\x1b]7501;state=blocked:kind=permission:app=terraform:msg=QXBwbHkgMyB0byBhZGQsIDEgdG8gY2hhbmdlLCAwIHRvIGRlc3Ryb3k/\x1b\\',
		);
	});

	it('encodes Unicode and delimiters as standard UTF-8 base64', () => {
		const title = 'Deploy 🚀';
		const message = '東京: Ready; a=b / +';
		expect(encodeStatus('working', { id: 'build/test-1', title, message, progress: 40 })).toBe(
			`\x1b]7501;state=working:id=build/test-1:progress=40:title=${Buffer.from(title).toString('base64')}:msg=${Buffer.from(message).toString('base64')}\x1b\\`,
		);
	});

	it.each(['permission', 'question', 'auth'] as const)('encodes blocked kind %s', (kind) => {
		expect(encodeStatus('blocked', { kind, progress: 0 })).toContain(`kind=${kind}:progress=0`);
	});

	it.each([0, 100])('preserves the progress boundary %s', (progress) => {
		expect(encodeStatus('working', { progress })).toContain(`progress=${progress}`);
	});

	it('preserves empty text fields and omits missing fields', () => {
		expect(encodeStatus('idle', { message: '', title: '' })).toBe('\x1b]7501;state=idle:title=:msg=\x1b\\');
		expect(encodeStatus('done', {})).toBe('\x1b]7501;state=done\x1b\\');
	});

	it('addresses a subtree when clearing', () => {
		expect(encodeStatus('clear', { id: 'build/test' })).toBe('\x1b]7501;state=clear:id=build/test\x1b\\');
	});

	it('accepts the exact limits and keeps the sequence below 4096 bytes', () => {
		const id = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(29)].join('/');
		expect(id).toHaveLength(128);
		const sequence = encodeStatus('blocked', {
			kind: 'question',
			progress: 100,
			id,
			app: 'x'.repeat(32),
			title: 'é'.repeat(96),
			message: '🚀'.repeat(512),
		});
		expect(Buffer.byteLength(sequence)).toBeLessThanOrEqual(4096);
		expect(sequence).toContain(`title=${Buffer.from('é'.repeat(96)).toString('base64')}`);
		expect(encodeStatus('working', { id: Array<string>(8).fill('a').join('/') })).toContain('id=a/a/a/a/a/a/a/a');
	});

	it.each([
		'',
		'/build',
		'build/',
		'build//test',
		'a'.repeat(33),
		'x/y:z',
		'x;y',
		'x=y',
		'with space',
		'東京',
		'build\n',
		'\x1b\\',
		Array<string>(9).fill('a').join('/'),
		Array<string>(4).fill('a'.repeat(32)).join('/'),
	])('rejects invalid id %j instead of addressing the root', (id) => {
		expect(() => encodeStatus('working', { id })).toThrow();
	});

	it.each(['', 'a'.repeat(33), 'x/y', 'x:y', 'x;y', 'x=y', 'my app', '東京', 'app\n'])(
		'rejects invalid app %j',
		(app) => {
			expect(() => encodeStatus('working', { app })).toThrow(TypeError);
		},
	);

	it.each([-1, 101, 0.5, NaN, Infinity])('rejects invalid progress %s', (progress) => {
		expect(() => encodeStatus('working', { progress })).toThrow(RangeError);
	});

	it.each(['message', 'title'] as const)('rejects every prohibited control character in %s', (key) => {
		for (let code = 0; code <= 0x9f; code++) {
			if (code <= 0x1f || code >= 0x7f) {
				expect(() => encodeStatus('working', { [key]: `a${String.fromCharCode(code)}b` })).toThrow(TypeError);
			}
		}
	});

	it.each([
		{ message: 'é'.repeat(1024) + 'a' },
		{ message: 'a'.repeat(2049) },
		{ title: '🚀'.repeat(48) + 'a' },
		{ title: 'a'.repeat(193) },
	])('enforces UTF-8 byte limits for %j', (text) => {
		expect(() => encodeStatus('working', { ...text })).toThrow(RangeError);
	});
});

describe('oscStatus output', () => {
	it('writes a complete sequence once to a TTY', () => {
		const stream = { isTTY: true, write: vi.fn() };
		expect(oscStatus.working({ message: 'Building' }, { stream })).toBe(true);
		expect(stream.write).toHaveBeenCalledExactlyOnceWith('\x1b]7501;state=working:msg=QnVpbGRpbmc=\x1b\\');
	});

	it.each([false, undefined])('skips output when isTTY is %s', (isTTY) => {
		const stream = { ...(isTTY === undefined ? {} : { isTTY }), write: vi.fn() };
		expect(oscStatus.done({}, { stream })).toBe(false);
		expect(stream.write).not.toHaveBeenCalled();
	});

	it('supports explicitly enabling a pipe', () => {
		const stream = { isTTY: false, write: vi.fn() };
		expect(oscStatus.done({}, { stream, enabled: true })).toBe(true);
		expect(stream.write).toHaveBeenCalledExactlyOnceWith('\x1b]7501;state=done\x1b\\');
	});

	it('supports explicitly disabling a TTY', () => {
		const stream = { isTTY: true, write: vi.fn() };
		expect(oscStatus.done({}, { stream, enabled: false })).toBe(false);
		expect(stream.write).not.toHaveBeenCalled();
	});

	it('defaults to stderr', () => {
		const write = vi.spyOn(stderr, 'write').mockReturnValue(true);
		try {
			expect(oscStatus.idle({}, { enabled: true })).toBe(true);
			expect(write).toHaveBeenCalledExactlyOnceWith('\x1b]7501;state=idle\x1b\\');
		} finally {
			write.mockRestore();
		}
	});

	it('reports emission even when the stream signals backpressure', () => {
		const stream = { isTTY: true, write: vi.fn().mockReturnValue(false) };
		expect(oscStatus.working({}, { stream })).toBe(true);
		expect(stream.write).toHaveBeenCalledOnce();
	});

	it('validates the entire report before writing anything', () => {
		const stream = { isTTY: true, write: vi.fn() };
		expect(() => oscStatus.working({ message: 'injected\x1b]0;title\x07' }, { stream })).toThrow(TypeError);
		expect(stream.write).not.toHaveBeenCalled();
	});

	it('validates reports even when output is disabled', () => {
		expect(() => oscStatus.working({ progress: 101 }, { enabled: false })).toThrow(RangeError);
	});

	it('propagates stream errors', () => {
		const error = new Error('Closed stream');
		const stream = {
			isTTY: true,
			write: () => {
				throw error;
			},
		};
		expect(() => oscStatus.working({}, { stream })).toThrow(error);
	});
});

describe('oscStatus', () => {
	it.each(['idle', 'working', 'done', 'blocked', 'error', 'clear'] as const)('writes %s reports', (state) => {
		const stream = { isTTY: true, write: vi.fn() };
		expect(oscStatus[state]({ id: 'build' }, { stream })).toBe(true);
		expect(stream.write).toHaveBeenCalledExactlyOnceWith(`\x1b]7501;state=${state}:id=build\x1b\\`);
	});

	it('forwards report fields and output options', () => {
		const stream = { isTTY: false, write: vi.fn() };
		expect(
			oscStatus.blocked({ kind: 'auth', message: 'Login required', progress: 50 }, { stream, enabled: true }),
		).toBe(true);
		expect(stream.write).toHaveBeenCalledExactlyOnceWith(
			'\x1b]7501;state=blocked:kind=auth:progress=50:msg=TG9naW4gcmVxdWlyZWQ=\x1b\\',
		);
		expect(oscStatus.working({ progress: 75 }, { stream, enabled: false })).toBe(false);
		expect(stream.write).toHaveBeenCalledOnce();
	});

	it('allows clearing without arguments', () => {
		const write = vi.spyOn(stderr, 'write').mockReturnValue(true);
		try {
			expect(oscStatus.clear()).toBe(Boolean(stderr.isTTY));
			if (stderr.isTTY) {
				expect(write).toHaveBeenCalledExactlyOnceWith('\x1b]7501;state=clear\x1b\\');
			} else {
				expect(write).not.toHaveBeenCalled();
			}
		} finally {
			write.mockRestore();
		}
	});
});
