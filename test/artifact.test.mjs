import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const DIST = new URL('../desktop/plugin.js', import.meta.url)

test('desktop/plugin.js exists and is installable shape', async () => {
  const source = await readFile(DIST, 'utf8')

  assert.doesNotMatch(source, /from '\.\/core\.js'/, 'core must be inlined')
  assert.match(source, /export default \{/, 'plugin default export')
  assert.match(source, /id: ID/, 'stable plugin id')

  // The only specifiers a disk plugin may import.
  const specifiers = [...source.matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm)].map(match => match[1])

  for (const specifier of specifiers) {
    assert.ok(
      ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(specifier),
      `unexpected import: ${specifier}`
    )
  }
})

test('file access is ctx.files only — no Electron bridge fallback', async () => {
  const source = await readFile(DIST, 'utf8')

  // The catalog reviews this: a plugin reaches files through the host's door, not
  // through the preload bridge the app happens to expose.
  assert.doesNotMatch(source, /hermesDesktop/, 'no window.hermesDesktop reach')
  assert.doesNotMatch(source, /\bselectPaths\b/, 'no single-file picker')
  assert.doesNotMatch(source, /\breadFileDataUrl\b/, 'no bridge read')
  assert.match(source, /ctxRef\.files|files\.readDataUrl/, 'reads through ctx.files')
})

test('desktop/plugin.js parses as a module', async () => {
  // Importing fails on the unresolvable SDK specifier — but only after the file
  // itself parses. A SyntaxError here means the build produced broken output.
  const error = await import(DIST.href).then(() => null, cause => cause)

  if (error) {
    assert.notEqual(error.name, 'SyntaxError', `build output does not parse: ${error.message}`)
    assert.match(String(error.message), /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/)
  }
})
