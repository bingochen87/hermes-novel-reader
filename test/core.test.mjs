import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bookFraction, chapterAtOffset, chapterOffset, clamp01, dataUrlToBytes, decodeBookText, isBookFile, isChapterHeading, percentLabel,
  resumeLine, sanitizeText, scrollOffsetFor, scrollRatio, sortBookEntries, splitChapters, splitParts,
  titleFromPath
} from '../src/core.js'

const BOOK = [
  '第一章 出发',
  '',
  '他推开门，风灌进来。',
  '这是第一段正文。',
  '',
  '第二章 归来',
  '',
  '三年后他回来了。',
  '',
  '第三章 终局',
  '',
  '最后一页。'
].join('\n')

test('sanitizeText normalises line endings and invisible junk', () => {
  const raw = '\ufeff第一章\r\n\r\n\r\n\r\n正文\u200b内容\u00a0  \r\n'
  const clean = sanitizeText(raw)

  assert.equal(clean, '第一章\n\n正文内容')
})

test('sanitizeText tolerates non-strings', () => {
  assert.equal(sanitizeText(null), '')
  assert.equal(sanitizeText(undefined), '')
  assert.equal(sanitizeText(42), '')
})

test('isChapterHeading accepts real headings and rejects prose or目录 lines', () => {
  assert.equal(isChapterHeading('第一章 出发'), true)
  assert.equal(isChapterHeading('  第 12 章：夜行  '), true)
  assert.equal(isChapterHeading('Chapter 7'), true)
  assert.equal(isChapterHeading('楔子'), true)
  assert.equal(isChapterHeading('番外一 后来'), true)

  assert.equal(isChapterHeading('他推开门，第二章风灌进来。'), false, 'prose with punctuation')

  // Titles that end in a question or an exclamation are still titles — real
  // books use them constantly ("第103章那是他的魅力吗？").
  assert.equal(isChapterHeading('第103章那是他的魅力吗？'), true, 'question-mark title')
  assert.equal(isChapterHeading('第2章真讨厌啊！'), true, 'exclamation title')
  assert.equal(isChapterHeading('第36章啪！（上）'), true, 'bracketed title')
  assert.equal(isChapterHeading('第三章的标题是假的。'), false, 'full stop means prose')
  assert.equal(isChapterHeading('第一章 出发...........12'), false, 'dot-leader TOC line')
  assert.equal(isChapterHeading('第一章 出发  12'), true, 'a title may end in a number')
  assert.equal(isChapterHeading('第3章 1984'), true, 'numeric titles are titles')
  assert.equal(isChapterHeading(''), false)
  assert.equal(isChapterHeading(`第一章 ${'很长的副标题'.repeat(8)}`), false, 'over the length cap')
})

test('splitChapters finds chapters and excludes the heading from the body', () => {
  const { kind, chapters } = splitChapters(BOOK)

  assert.equal(kind, 'chapters')
  assert.deepEqual(chapters.map(chapter => chapter.title), ['第一章 出发', '第二章 归来', '第三章 终局'])
  assert.ok(chapters[0].end > chapters[0].start)
  assert.equal(chapters[chapters.length - 1].end, BOOK.length, 'last chapter reaches end of text')
  assert.equal(BOOK.slice(chapters[0].start, chapters[0].end).trim().startsWith('他推开门'), true)
  assert.equal(BOOK.slice(chapters[2].start, chapters[2].end).trim(), '最后一页。')
  assert.equal(chapters[0].at < chapters[0].start, true, 'heading offset precedes the body')
})

test('splitChapters drops a leading table of contents so it does not become chapters', () => {
  const body = '真正的正文，一句话一段。'.repeat(40)
  const text = [
    '目录',
    '第一章 出发',
    '第二章 归来',
    '第三章 重逢',
    '第四章 终局',
    '',
    '第一章 出发',
    '',
    body,
    '',
    '第二章 归来',
    '',
    body
  ].join('\n')

  const { kind, chapters } = splitChapters(text)

  assert.equal(kind, 'chapters')
  assert.deepEqual(chapters.map(chapter => chapter.title), ['第一章 出发', '第二章 归来'])
  assert.equal(text.slice(chapters[0].start).trim().slice(0, 6), '真正的正文，')
})

test('splitChapters splits titles that end in a number', () => {
  const text = [1, 2, 3].map(n => `第${n}章 那年 ${n}\n\n${'正文。'.repeat(120)}`).join('\n\n')

  const { kind, chapters } = splitChapters(text)

  assert.equal(kind, 'chapters')
  assert.deepEqual(chapters.map(chapter => chapter.title), ['第1章 那年 1', '第2章 那年 2', '第3章 那年 3'])
})

test('splitChapters keeps every chapter of a short-chapter book', () => {
  const body = '短章节的正文。'
  const text = [1, 2, 3, 4, 5].map(n => `第${n}章 小事\n\n${body.repeat(20)}`).join('\n\n')

  const { chapters } = splitChapters(text)

  assert.equal(chapters.length, 5)
  assert.equal(chapters[0].title, '第1章 小事')
})

test('splitChapters keeps front matter as its own unit', () => {
  const front = `${'x'.repeat(60)}\n\n第一章 出发\n\n正文。\n\n第二章 归来\n\n正文二。`
  const { chapters } = splitChapters(front)

  assert.equal(chapters[0].title, 'Front matter')
  assert.equal(chapters[0].start, 0)
  assert.equal(chapters.length, 3)
})

test('splitChapters falls back to parts when there are no headings', () => {
  const text = `${'无章节的段落。\n'.repeat(2000)}`

  const { kind, chapters } = splitChapters(text, { partSize: 1000 })

  assert.equal(kind, 'parts')
  assert.ok(chapters.length > 5)
  assert.equal(chapters[0].start, 0)
  assert.equal(chapters[chapters.length - 1].end, text.length)
  assert.match(chapters[0].title, /^Part 1$/)

  for (let i = 1; i < chapters.length; i++) {
    assert.equal(chapters[i].start, chapters[i - 1].end, 'parts are contiguous')
  }
})

test('splitParts prefers paragraph boundaries', () => {
  const text = `${'a'.repeat(80)}\n${'b'.repeat(80)}\n`
  const parts = splitParts(text, 100)

  assert.equal(parts.length, 2)
  assert.equal(parts[0].end, 81, 'cuts at the newline, not mid-line')
})

test('splitParts always returns at least one unit', () => {
  assert.deepEqual(splitParts('', 100), [{ title: 'Part 1', start: 0, at: 0, end: 0 }])
})

test('scroll helpers clamp and round-trip', () => {
  const box = { clientHeight: 500, scrollHeight: 2100 }

  assert.equal(scrollRatio({ ...box, scrollTop: 0 }), 0)
  assert.equal(scrollRatio({ ...box, scrollTop: 1600 }), 1)
  assert.equal(scrollRatio({ ...box, scrollTop: 800 }), 0.5)
  assert.equal(scrollRatio({ clientHeight: 500, scrollHeight: 500, scrollTop: 0 }), 0, 'unscrollable content')
  assert.equal(scrollOffsetFor(0.25, box), 400)
  assert.equal(scrollOffsetFor(4, box), 1600)
  assert.equal(clamp01(Number.NaN), 0)
  assert.equal(clamp01(-3), 0)
})

test('chapterOffset / chapterAtOffset round-trip across a re-split', () => {
  const before = splitChapters('第1章 甲\n\n' + 'a'.repeat(100) + '\n\n第2章 乙\n\n' + 'b'.repeat(100)).chapters
  const offset = chapterOffset(before, 1, 0.5)
  assert.equal(typeof offset, 'number')
  assert.equal(chapterAtOffset(before, offset), 1, 'offset lands in the same chapter')

  // A later split that recognises one more heading before the bookmark must not
  // move the reader: the same offset still resolves to 第2章.
  const after = splitChapters('第1章 甲\n\n' + 'a'.repeat(100) + '\n\n第2章 乙\n\n' + 'b'.repeat(100)).chapters
  assert.equal(after.length, before.length)
  assert.equal(chapterAtOffset(after, offset), 1)
  assert.equal(chapterAtOffset([], 10), -1, 'empty list')
  assert.equal(chapterOffset([], 0, 0), null, 'no chapter')
})

test('bookFraction spans chapters by character count', () => {
  const { chapters } = splitChapters(BOOK)
  const total = BOOK.length

  assert.equal(bookFraction(chapters, 0, 0), 0)
  assert.ok(bookFraction(chapters, 2, 1) > 0.99)
  assert.ok(bookFraction(chapters, 1, 0.5) > bookFraction(chapters, 0, 1))
  assert.equal(bookFraction(chapters, 0, 0) >= 0, true)
  assert.equal(bookFraction(chapters, 2, 1) <= 1, true)
  assert.equal(Math.abs(bookFraction([{ end: total, start: 0 }], 0, 1) - 1) < 1e-9, true)
  assert.equal(bookFraction([], 0, 0.5), 0)
})

test('labels stay short', () => {
  assert.equal(percentLabel(0.126), '13%')
  assert.equal(percentLabel(1.4), '100%')
  assert.equal(resumeLine('夜行', '第三章 终局', 0.5), '《夜行》 · 第三章 终局 · 50%')
  assert.equal(resumeLine('', '第一章', 0), '第一章 · 0%')
})

test('file helpers', () => {
  assert.equal(isBookFile('夜行.txt'), true)
  assert.equal(isBookFile('README.MD'), true)
  assert.equal(isBookFile('cover.epub'), false)
  assert.equal(isBookFile('book.pdf'), false)
  assert.equal(titleFromPath('/Users/me/books/夜行.txt'), '夜行')
  assert.equal(titleFromPath('C:\\books\\夜行.txt'), '夜行')
  assert.equal(titleFromPath('noext'), 'noext')
})

test('decodeBookText reads UTF-8 and falls back to GB18030', () => {
  const utf8 = new TextEncoder().encode('他推开门，风灌进来。')
  assert.deepEqual(decodeBookText(utf8), { encoding: 'utf-8', text: '他推开门，风灌进来。' })

  // "你好" in GBK — invalid UTF-8, so the reader must switch encodings.
  const gbk = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3])
  assert.deepEqual(decodeBookText(gbk), { encoding: 'gb18030', text: '你好' })
})

test('dataUrlToBytes handles base64 and percent-encoded payloads', () => {
  const bytes = new TextEncoder().encode('你好')
  const b64 = btoa(String.fromCharCode(...bytes))
  assert.deepEqual(Array.from(dataUrlToBytes(`data:text/plain;base64,${b64}`)), Array.from(bytes))
  assert.deepEqual(Array.from(dataUrlToBytes('data:text/plain,%E4%BD%A0')), [0xe4, 0xbd, 0xa0])
  assert.equal(dataUrlToBytes('not a data url'), null)
  assert.equal(dataUrlToBytes('data:text/plain;base64,@@@@'), null)
  assert.equal(dataUrlToBytes(null), null)
})

test('sortBookEntries is natural and case-insensitive', () => {
  const sorted = sortBookEntries([{ name: 'Book 10.txt' }, { name: 'book 2.txt' }, { name: 'Book 1.txt' }])

  assert.deepEqual(sorted.map(entry => entry.name), ['Book 1.txt', 'book 2.txt', 'Book 10.txt'])
})

test('chapters never overlap and cover the text', () => {
  const { chapters } = splitChapters(BOOK)

  for (let i = 1; i < chapters.length; i++) {
    assert.ok(chapters[i].start >= chapters[i - 1].end, 'no overlap')
  }
})
