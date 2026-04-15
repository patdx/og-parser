import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const artifactsDir = path.join(repoRoot, 'artifacts', 'parser-quality')

const { stdout, stderr, combinedOutput } = await runEvaluation()
const marker = '__PARSER_QUALITY_REPORT__'
const markerIndex = combinedOutput.indexOf(marker)

if (markerIndex === -1) {
	throw new Error(`Failed to extract parser quality report from Vitest output.\n${stdout}\n${stderr}`)
}

const report = JSON.parse(extractJsonObject(combinedOutput, markerIndex + marker.length))
const mismatches = report.fixtures.filter((fixture) => fixture.mismatches.length > 0)

await mkdir(artifactsDir, { recursive: true })
await writeFile(path.join(artifactsDir, 'parser-quality-report.json'), JSON.stringify(report, null, '\t'))
await writeFile(path.join(artifactsDir, 'parser-quality-mismatches.json'), JSON.stringify(mismatches, null, '\t'))

console.log(`Wrote parser quality artifacts to ${artifactsDir}.`)

async function runEvaluation() {
	return new Promise((resolve, reject) => {
		const child = spawn(
			'pnpm',
			[
				'exec',
				'vitest',
				'run',
				'test/parser-quality.spec.ts',
				'-t',
				'machine-readable parser quality report',
				'--reporter=verbose',
			],
			{
				cwd: repoRoot,
				env: {
					...process.env,
					VITE_PARSER_QUALITY_EMIT_REPORT: '1',
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		)

		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString()
		})

		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString()
		})

		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Parser quality evaluation failed with code ${code}.\n${stdout}\n${stderr}`))
				return
			}

			resolve({
				stdout,
				stderr,
				combinedOutput: `${stdout}\n${stderr}`,
			})
		})

		child.on('error', reject)
	})
}

function extractJsonObject(text, startIndex) {
	const firstBraceIndex = text.indexOf('{', startIndex)
	if (firstBraceIndex === -1) {
		throw new Error('Failed to locate parser quality report JSON payload.')
	}

	let depth = 0
	let inString = false
	let isEscaped = false

	for (let index = firstBraceIndex; index < text.length; index += 1) {
		const char = text[index]

		if (inString) {
			if (isEscaped) {
				isEscaped = false
			} else if (char === '\\') {
				isEscaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
			continue
		}

		if (char === '{') {
			depth += 1
		} else if (char === '}') {
			depth -= 1
			if (depth === 0) {
				return text.slice(firstBraceIndex, index + 1)
			}
		}
	}

	throw new Error('Failed to extract a complete parser quality report JSON payload.')
}
