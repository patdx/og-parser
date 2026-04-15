import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const fixturesDir = path.join(repoRoot, 'test/fixtures/parser-quality')

const fixtureDirs = (await readdir(fixturesDir, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort()

const fixtureFiles = []

for (const fixtureDir of fixtureDirs) {
	const sourcePath = path.join(fixturesDir, fixtureDir, 'source.html')
	const expectedPath = path.join(fixturesDir, fixtureDir, 'expected.json')
	fixtureFiles.push({
		id: fixtureDir,
		sourcePath,
		expectedPath,
	})
}

console.log(`Found ${fixtureFiles.length} parser quality fixtures in ${fixturesDir}.`)
