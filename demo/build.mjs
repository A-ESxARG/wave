import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

await build({
  entryPoints: [path.join(__dirname, 'main.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(__dirname, 'bundle.mjs'),
  sourcemap: true,
  target: ['es2020'],
  absWorkingDir: root,
  logLevel: 'info'
})