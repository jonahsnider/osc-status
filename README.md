# osc-status

Report terminal program status with [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status).
No dependencies, Node.js v22+, TypeScript, ESM + CJS.

```sh
npm install osc-status
```

```ts
import oscStatus from 'osc-status';

oscStatus.working({ app: 'deploy', message: 'Deploying', progress: 50 });
oscStatus.blocked({ kind: 'permission', message: 'Approve production deploy?' });
oscStatus.done({ message: 'Deployed' });
oscStatus.error({ message: 'Deploy failed' });
oscStatus.idle();
oscStatus.clear();
```

## Usage

Methods write to stderr when it is a TTY and return whether a report was emitted.
Pass a second argument to select a stream or override TTY detection:

```ts
oscStatus.working({ progress: 50 }, { stream: process.stdout, enabled: true });
```

Specify progress as an integer from 0-100:

```ts
oscStatus.working({ progress: 0 });
oscStatus.working({ progress: 100 });
```

Describe what kind of blocker is active:

```ts
oscStatus.blocked({ kind: 'question', message: 'Which environment?' });
oscStatus.blocked({ kind: 'auth', message: 'Sign in to continue' });
oscStatus.blocked({ kind: 'permission', message: 'Approve deploy?', progress: 50 });
```

Include details on what's in progress:

```ts
oscStatus.working({
	app: 'deploy', // 1-32 characters: alphanumeric, _, ., +, -
	id: 'regions/us-east', // Slash-separated task path or undefined for the root record
	title: 'US East', // Up to 192 UTF-8 bytes
	message: 'Uploading', // Up to 2048 UTF-8 bytes
	progress: 40,
});
```

Clear the status for a specific task:

```ts
oscStatus.clear({ id: 'regions/us-east' });
```

## Advanced use

Text is automatically base64-encoded and must contain no control characters.

Each report replaces its record, so repeat any fields you want to retain.
Use `oscStatus.clear({ id: 'build/test' })` to remove a task and its children;
`oscStatus.clear()` removes all records in the terminal.

For a state variable or to encode without writing:

```ts
import { encodeStatus } from 'osc-status';

const state = 'working';
oscStatus[state]({ message: 'Building' });
const sequence = encodeStatus('done', { message: 'Built' });
```
