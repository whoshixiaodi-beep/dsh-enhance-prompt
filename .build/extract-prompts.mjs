// One-off build helper: extract the prompt templates verbatim from the
// original Codex++ userscript so the plugin carries the exact same text.
// Reads the source, matches each `const NAME = `...`;` literal, and emits
// prompts.js with JSON-stringified values (no manual transcription).
//
// The userscript is third-party work and is NOT vendored in this repository:
// pass its path as the first argument. The generated file carries the
// attribution header below.
//
// Usage: node extract-prompts.mjs <path-to-userscript> <path-to-prompts.js>
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2]
const OUT = process.argv[3]

const src = readFileSync(SRC, 'utf8')

const NAMES = [
  'WORKBUDDY_SYSTEM_TEMPLATE',
  'WORKBUDDY_USER_TEMPLATE',
  'DEFAULT_ENHANCE_PROMPT_SYSTEM_TEMPLATE',
  'DEFAULT_ENHANCE_PROMPT_USER_TEMPLATE',
  'PARAGRAPH_OUTPUT_RULES',
]

const values = {}
for (const name of NAMES) {
  const re = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;')
  const match = src.match(re)
  if (match === null) throw new Error('template not found: ' + name)
  const value = match[1]
  if (value.includes('`')) throw new Error('unexpected backtick inside ' + name)
  values[name] = value
}

const header = `// Prompt templates transcribed verbatim from the original Codex++ userscript
// \`wb-enhance-prompt-share.js\`, by that userscript's original author.
//
// Attribution: the enhancement behaviour and the template text below originate
// from that userscript and are reproduced here to preserve its exact behaviour.
// Everything else in this repository (the DSH Host half, the browser half, the
// bundle wiring, and the documentation) is original to this project.
//
// Do not reflow or retranslate: the Chinese/English language rules and the
// exact-content preservation rules are behaviour, not prose.

`

const body = NAMES.map((name) => `export const ${name} = ${JSON.stringify(values[name])}\n`).join('\n')

const helpers = `
/** Normalise a mode value to one of the two supported enhancement modes. */
export function normalizeEnhanceMode(mode) {
  return mode === 'creative' ? 'creative' : 'workbuddy'
}

/**
 * Render the user message for one mode. The callback form of replace() is used
 * so a draft containing \`$&\`, \`$'\` or \`$\\\`\` is inserted literally instead of
 * being interpreted as a replacement pattern.
 */
export function renderUserPrompt(input, mode = 'workbuddy') {
  if (normalizeEnhanceMode(mode) === 'workbuddy') {
    return WORKBUDDY_USER_TEMPLATE.replace('{input}', () => input)
  }
  return DEFAULT_ENHANCE_PROMPT_USER_TEMPLATE.replace('{input}', () => JSON.stringify({ instruction: input }))
}

/** The system message: the mode template plus the shared paragraph layout rules. */
export function renderSystemPrompt(mode) {
  const template = normalizeEnhanceMode(mode) === 'creative'
    ? DEFAULT_ENHANCE_PROMPT_SYSTEM_TEMPLATE
    : WORKBUDDY_SYSTEM_TEMPLATE
  return template + '\\n\\n' + PARAGRAPH_OUTPUT_RULES
}
`

writeFileSync(OUT, header + body + helpers, 'utf8')

for (const name of NAMES) {
  console.log(name + ': ' + values[name].length + ' chars')
}
console.log('wrote ' + OUT)
