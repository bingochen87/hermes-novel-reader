import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const DIST = new URL('../dist/plugin.js', import.meta.url)

test('dist/plugin.js exists and is installable shape', async () => {
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

test('dist/plugin.js parses as a module', async () => {
  // Importing fails on the unresolvable SDK specifier — but only after the file
  // itself parses. A SyntaxError here means the build produced broken output.
  const error = await import(DIST.href).then(() => null, cause => cause)

  if (error) {
    assert.notEqual(error.name, 'SyntaxError', `build output does not parse: ${error.message}`)
    assert.match(String(error.message), /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/)
  }
})
