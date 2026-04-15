import 'cloudflare:test'
import 'vitest'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}

declare global {
	interface ImportMeta {
		glob<T = unknown>(
			pattern: string | readonly string[],
			options?: {
				eager?: boolean
				import?: string
				query?: string | Record<string, string | number | boolean>
			},
		): Record<string, T>
	}
}

export {}
