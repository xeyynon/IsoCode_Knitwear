// A small reader for the block-style YAML the workflow files use: nested mappings, lists (of values or of mappings),
// scalars, flow lists such as [main], and | / > block scalars. It is here so the tests can read the workflows as data
// without a new dependency. It is NOT a general YAML parser: no anchors, no multi-document files, no flow mappings.
export type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml }

const indentOf = (l: string) => l.length - l.trimStart().length

function scalar(raw: string): Yaml {
  let s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '')
  if (s.startsWith('"') || s.startsWith("'")) {
    const q = s[0]!
    const end = s.indexOf(q, 1)
    return end === -1 ? s : s.slice(1, end)
  }
  const hash = s.search(/\s#/)
  if (hash !== -1) s = s.slice(0, hash).trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?[0-9]+$/.test(s)) return Number(s)
  return s
}

export function parseYaml(text: string): Yaml {
  const lines = text.split(/\r?\n/)
  let i = 0
  const blank = (l: string) => l.trim() === '' || l.trim().startsWith('#')
  const skip = () => { while (i < lines.length && blank(lines[i]!)) i++ }

  function blockScalar(parent: number, folded: boolean): string {
    const out: string[] = []
    let base = -1
    while (i < lines.length) {
      const l = lines[i]!
      if (l.trim() !== '' && indentOf(l) <= parent) break
      if (l.trim() !== '' && base === -1) base = indentOf(l)
      out.push(l.trim() === '' ? '' : l.slice(Math.min(base, indentOf(l))))
      i++
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    return (folded ? out.join(' ') : out.join('\n')) + '\n'
  }

  function value(rest: string | undefined, ind: number): Yaml {
    if (rest === undefined || rest === '') {
      skip()
      const l = lines[i]
      if (l === undefined) return null
      const t = l.trimStart()
      if (indentOf(l) > ind) return block(indentOf(l))
      if (indentOf(l) === ind && (t.startsWith('- ') || t === '-')) return block(ind)   // a list may sit at the key's own indent
      return null
    }
    if (/^[|>][+-]?$/.test(rest.trim())) return blockScalar(ind, rest.trim().startsWith('>'))
    return scalar(rest)
  }

  function block(ind: number): Yaml {
    skip()
    const t = lines[i]!.trimStart()
    return t.startsWith('- ') || t === '-' ? list(ind) : mapping(ind)
  }

  function list(ind: number): Yaml[] {
    const out: Yaml[] = []
    for (;;) {
      skip()
      const l = lines[i]
      if (l === undefined || indentOf(l) !== ind || !(l.trimStart().startsWith('- ') || l.trim() === '-')) return out
      const content = l.trimStart().slice(1).trimStart()
      if (content === '') { i++; out.push(value('', ind)); continue }
      if (/^[^\s'"[{][^:]*:(\s|$)/.test(content)) {
        lines[i] = ' '.repeat(ind + 2) + content   // the first key of an item sits two columns in, like the keys after it
        out.push(mapping(ind + 2))
      } else { i++; out.push(scalar(content)) }
    }
  }

  function mapping(ind: number): { [key: string]: Yaml } {
    const out: { [key: string]: Yaml } = {}
    for (;;) {
      skip()
      const l = lines[i]
      if (l === undefined || indentOf(l) !== ind) return out
      const m = /^([^:]+?):(?:\s+(.*))?$/.exec(l.trim())
      if (!m) throw new Error(`miniYaml: cannot read line ${i + 1}: ${l}`)
      i++
      out[scalar(m[1]!) as string] = value(m[2], ind)
    }
  }

  skip()
  return i >= lines.length ? null : block(indentOf(lines[i]!))
}

/** Reads a path such as 'jobs.release.needs' from parsed YAML; undefined when any step is missing. */
export function at(doc: Yaml, dotted: string): Yaml | undefined {
  let cur: Yaml | undefined = doc
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as { [k: string]: Yaml })[part]
  }
  return cur
}
