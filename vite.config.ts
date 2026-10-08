import { defineConfig } from 'vite-plus';

export default defineConfig({
	pack: {
		entry: ['src/index.ts'],
		format: ['esm', 'cjs'],
		outputOptions: {
			exports: 'named',
		},
		dts: true,
		exports: true,
		target: 'node22',
	},
	test: {
		include: ['test/**/*.test.ts'],
		isolate: false,
		sequence: {
			concurrent: true,
		},
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
		categories: {
			correctness: 'error',
			perf: 'error',
		},
		ignorePatterns: ['dist/**', 'temp/**'],
	},
	fmt: {
		singleQuote: true,
		useTabs: true,
		printWidth: 120,
		ignorePatterns: ['dist/**', 'temp/**', 'etc/*.api.md', 'CHANGELOG.md'],
	},
});
