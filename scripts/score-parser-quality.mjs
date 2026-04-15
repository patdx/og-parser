import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const reportPath = path.join(repoRoot, 'artifacts', 'parser-quality', 'parser-quality-report.json')

const report = JSON.parse(await readFile(reportPath, 'utf8'))
const { summary } = report

console.log(
	JSON.stringify(
		{
			fixtures: summary.fixtures,
			pass: summary.pass,
			needs_review: summary.needs_review,
			fail: summary.fail,
			critical_mismatches: summary.critical_mismatches,
			major_mismatches: summary.major_mismatches,
			minor_mismatches: summary.minor_mismatches,
		},
		null,
		'\t',
	),
)

if (summary.fail > 0 || summary.critical_mismatches > 0) {
	process.exitCode = 1
}
