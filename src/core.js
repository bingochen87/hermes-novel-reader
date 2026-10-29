/**
 * Pure helpers for the novel reader.
 *
 * No DOM, no SDK, no third-party imports: everything here is a function of its
 * arguments, so it can be unit-tested in plain Node (`node --test`) and inlined
 * verbatim into the shipped `dist/plugin.js` by `build.mjs`. Keep it that way —
 * a helper that needs `window` belongs in `src/plugin.js`, not here.
 */

/** Heading shapes we accept as a chapter break: 第12章 / Chapter 7 / 楔子 / 番外… */
const HEADING = /^(?:第\s*[0-9０-９〇零一二三四五六七八九十百千两]{1,12}\s*[章节節回卷集部篇话話幕]|(?:chapter|ch\.)\s*\d{1,4}(?!\d)|序章|序言|自序|前言|楔子|引子|引言|尾声|尾聲|终章|終章|后记|後記|番外|完本感言|作者的话|作者的話)/i

/**
 * A heading line never ends a sentence — but a title may well ask a question or
 * shout ("第103章那是他的魅力吗？", "第43章今天只能活一个！"). Only the marks that
 * never appear in a title are treated as prose: a full stop, a semicolon, an
 * ellipsis, or the ASCII equivalents.
 */
const SENTENCE_PUNCTUATION = /[。；…;]/

/** Table-of-contents lines: dot leaders running out to a page number. */
const TOC_LEADER = /(?:\.{3,}|…{2,}|·{3,}|-{4,})/

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g

/**
 * Normalise raw book text: BOM, CRLF, non-breaking spaces, trailing blanks,
 * runs of empty lines, and invisible formatting characters that otherwise show
 * up as gaps between paragraphs.
 */
export function sanitizeText(raw) {
  if (typeof raw !== 'string') {
    return ''
  }

  return raw
    .replace(ZERO_WIDTH, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0|\u3000(?=\n)/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** True when a single line looks like a chapter heading rather than prose. */
export function isChapterHeading(line) {
  const text = line.trim()

  if (!text || text.length > 40) {
    return false
  }

  if (!HEADING.test(text)) {
    return false
  }

  if (SENTENCE_PUNCTUATION.test(text)) {
    return false
  }

  // "第一章 归途 ………… 12" is a目录 entry, not a body. A bare trailing number
  // is NOT enough: real titles do that too ("第3章 1984"). Lists without dot
  // leaders are caught by trimLeadingToc() instead, which looks at whether any
  // prose follows the run of headings.
  if (TOC_LEADER.test(text)) {
    return false
  }

  return true
}

function headingTitle(line) {
  return line.trim().replace(/\s+/g, ' ')
}

/**
 * Many .txt novels open with a bare list of chapter names ("目录") with no dot
 * leaders, which would otherwise split into empty chapters. A leading run of
 * headings packed within ~120 characters of each other is that list — but only
 * when real prose follows the run: the last heading of the run is kept as the
 * first real chapter, and everything before it is dropped.
 */
function trimLeadingToc(marks) {
  if (marks.length < 4) {
    return { dropped: false, marks }
  }

  let cluster = 1

  while (cluster < marks.length && cluster < 24 && marks[cluster].offset - marks[cluster - 1].offset <= 120) {
    cluster++
  }

  if (cluster < 3 || cluster >= marks.length) {
    return { dropped: false, marks }
  }

  // A real chapter is followed by its body, so the next gap is far larger than
  // the gaps inside the list. Without that, this is just a short-chapter book.
  const nextGap = marks[cluster].offset - marks[cluster - 1].offset

  if (nextGap <= 400) {
    return { dropped: false, marks }
  }

  return { dropped: true, marks: marks.slice(cluster - 1) }
}

/**
 * Split one book into reading units.
 *
 * `kind: 'chapters'` when at least two real headings were found; otherwise the
 * text is chunked into `'parts'` of roughly `partSize` characters so a
 * chapter-less dump is still pageable instead of rendering a 5 MB text node.
 *
 * Each unit is `{ title, start, at, end }`: `at` is the heading's offset (used
 * for progress), `start` the first character of the body (the heading line
 * itself becomes `title`).
 */
export function splitChapters(text, options = {}) {
  const partSize = options.partSize ?? 6000
  const marks = []
  let offset = 0

  for (const line of text.split('\n')) {
    if (isChapterHeading(line)) {
      marks.push({ body: offset + line.length + 1, offset, title: headingTitle(line) })
    }

    offset += line.length + 1
  }

  const trimmed = trimLeadingToc(marks)
  const keep = trimmed.marks

  if (keep.length >= 2) {
    const chapters = keep.map((mark, index) => ({
      at: mark.offset,
      end: index + 1 < keep.length ? keep[index + 1].offset : text.length,
      start: Math.min(mark.body, text.length),
      title: mark.title
    })).filter(chapter => chapter.end > chapter.start)

    if (chapters.length >= 2) {
      const front = trimmed.dropped ? '' : text.slice(0, keep[0].offset).trim()

      if (front.length > 40) {
        chapters.unshift({ at: 0, end: keep[0].offset, start: 0, title: options.frontMatterTitle ?? 'Front matter' })
      }

      return { kind: 'chapters', chapters }
    }
  }

  return { kind: 'parts', chapters: splitParts(text, partSize) }
}

/**
 * Many .txt novels open with a bare list of chapter names ("目录") that would
 * otherwise split into empty chapters. A cluster of headings packed within the
 * first few hundred characters, with almost no text between them, is that list.
 */
function dropLeadingTableOfContents(marks) {
  let cluster = 1

  for (let i = 1; i < marks.length && i < 12; i++) {
    if (marks[i].offset - marks[i - 1].offset > 160) {
      break
    }

    cluster++
  }

  return cluster >= 4 ? marks.slice(cluster) : marks
}

/** Chunk text with no usable headings into page-sized parts on paragraph edges. */
export function splitParts(text, size = 6000) {
  const chapters = []
  let start = 0
  let index = 1

  while (start < text.length) {
    let end = Math.min(text.length, start + size)

    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end)

      if (boundary > start + size * 0.6) {
        end = boundary + 1
      }
    }

    chapters.push({ title: `Part ${index}`, start, at: start, end })
    start = end
    index++
  }

  return chapters.length ? chapters : [{ title: 'Part 1', start: 0, at: 0, end: text.length }]
}

export function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Scroll offset → 0..1 position inside the current chapter. */
export function scrollRatio({ clientHeight, scrollHeight, scrollTop }) {
  const span = scrollHeight - clientHeight

  return span <= 1 ? 0 : clamp01(scrollTop / span)
}

/** 0..1 position → scroll offset, for restoring where the reader was. */
export function scrollOffsetFor(ratio, { clientHeight, scrollHeight }) {
  const span = scrollHeight - clientHeight

  return span <= 1 ? 0 : Math.round(clamp01(ratio) * span)
}

/**
 * Whole-book fraction across uneven chapter lengths.
 *
 * Measured from each chapter's heading offset (`at`), not its body offset, so
 * the first page of the first chapter reads 0% and the last page reads 100%
 * instead of starting a few characters in.
 */
/**
 * Shapes returned by the host's plugin file door (`ctx.files`), normalised so the
 * reader never touches a raw host payload:
 *   requestFolder() → { ok, folder: { id, name, path } }
 *   list(id, path)  → { ok, entries: [{ name, path, isDirectory }] }
 * A null return means "the door refused" — callers show that, they do not guess.
 */
export function grantRoot(folder) {
  if (!folder || typeof folder.id !== 'string' || !folder.id) {
    return null
  }

  return {
    id: folder.id,
    name: String(folder.name || folder.path || 'folder'),
    path: String(folder.path || '')
  }
}

export function normalizeListing(result) {
  if (!result || result.ok === false || !Array.isArray(result.entries)) {
    return null
  }

  return result.entries.map(entry => ({
    isDirectory: Boolean(entry?.isDirectory),
    name: String(entry?.name ?? ''),
    rel: String(entry?.path ?? entry?.name ?? '')
  }))
}

/**
 * Character offset of a position, measured in the sanitised book text. Storing
 * this instead of a chapter index keeps a bookmark meaningful when the chapter
 * list itself changes (a smarter heading rule, a re-encoded file): the index
 * shifts, the offset does not.
 */
export function chapterOffset(chapters, index, ratio) {
  const chapter = chapters?.[index]

  if (!chapter) {
    return null
  }

  const from = chapter.at ?? chapter.start

  return Math.round(from + (chapter.end - from) * clamp01(ratio))
}

/** Which chapter holds a character offset; -1 when the list is empty. */
export function chapterAtOffset(chapters, offset) {
  if (!Array.isArray(chapters) || !chapters.length) {
    return -1
  }

  if (!Number.isFinite(offset)) {
    return -1
  }

  for (let i = 0; i < chapters.length; i++) {
    if (offset < chapters[i].start) {
      return Math.max(0, i - 1)
    }

    if (offset < chapters[i].end) {
      return i
    }
  }

  return chapters.length - 1
}

export function bookFraction(chapters, index, ratio) {
  const total = chapters.length ? chapters[chapters.length - 1].end : 0
  const chapter = chapters[index]

  if (!total || !chapter) {
    return 0
  }

  const from = chapter.at ?? chapter.start
  const consumed = from + (chapter.end - from) * clamp01(ratio)

  return clamp01(consumed / total)
}

export function percentLabel(fraction) {
  return `${Math.round(clamp01(fraction) * 100)}%`
}

/** One-line bookmark the reader can copy anywhere ("《书名》第3章 · 37%"). */
export function resumeLine(bookName, chapterTitle, fraction) {
  const parts = []

  if (bookName) {
    parts.push(`《${bookName}》`)
  }

  if (chapterTitle) {
    parts.push(chapterTitle)
  }

  parts.push(percentLabel(fraction))

  return parts.join(' · ')
}

/** Files this reader opens. Epublishing formats are deliberately out of scope. */
export function isBookFile(name) {
  return /\.(txt|text|md|markdown)$/i.test(name)
}

export function titleFromPath(path) {
  const base = String(path ?? '').split(/[\\/]/).pop() || ''

  return base.replace(/\.[^.]+$/, '') || base
}

/**
 * Decode a book file: UTF-8 when the bytes are valid UTF-8, otherwise GB18030 —
 * which covers GBK/GB2312, the encoding most Chinese .txt novels still ship in.
 * A file that is valid in neither is decoded leniently rather than rejected.
 */
export function decodeBookText(bytes) {
  for (const encoding of ['utf-8', 'gb18030']) {
    try {
      return { encoding, text: new TextDecoder(encoding, { fatal: true }).decode(bytes) }
    } catch {
      // Try the next candidate.
    }
  }

  return { encoding: 'gb18030', text: new TextDecoder('gb18030').decode(bytes) }
}

/** `data:` URL (base64 or percent-encoded) → bytes. Null when unparseable. */
export function dataUrlToBytes(url) {
  if (typeof url !== 'string') {
    return null
  }

  const comma = url.indexOf(',')

  if (!url.startsWith('data:') || comma < 0) {
    return null
  }

  const meta = url.slice(5, comma)
  const payload = url.slice(comma + 1)

  if (!/;base64/i.test(meta)) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload))
    } catch {
      return null
    }
  }

  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return bytes
  } catch {
    return null
  }
}

/** Natural, locale-aware book ordering so "第10章" sorts after "第9章". */
export function sortBookEntries(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}
