import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				ratelimits: {
					MY_RATE_LIMITER: {
						simple: {
							limit: 50,
							period: 60,
						},
					},
				},
			},
		}),
	],
})
