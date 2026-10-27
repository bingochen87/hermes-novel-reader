/**
 * Novel Reader — a distraction-free reading pane for the Hermes desktop app,
 * for the minutes you spend waiting on the agent.
 *
 * Features: chapter detection (第N章 / Chapter N / 序章 / 番外 …), typography
 * controls, four reading themes, keyboard and click page turns, and a saved
 * position per book that survives restarts.
 *
 * Two filesystem doors, feature-detected at runtime:
 *   1. `ctx.files` (granted folders) — the sanctioned door on newer builds.
 *   2. `window.hermesDesktop.readDir / readFileDataUrl / selectPaths` — the
 *      door current builds actually have; the same one the Files panel uses.
 * Both are read-only, and the plugin writes nothing outside its own storage.
 *
 * Packaged by `build.mjs` into `dist/plugin.js` (the file you install). Plain
 * ESM, loaded uncompiled: the UI is jsx() calls, and the only resolvable
 * imports are `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
 */

import {
  atom, Codicon, host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, TITLEBAR_AREAS, Tip,
  usePluginI18n, useValue
} from '@hermes/plugin-sdk'
import { Fragment, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
// ---8<--- core: inlined by build.mjs from src/core.js ---8<---
import {
  bookFraction, dataUrlToBytes, decodeBookText, isBookFile, percentLabel, resumeLine,
  sanitizeText, scrollOffsetFor, scrollRatio, sortBookEntries, splitChapters, titleFromPath
} from './core.js'
// ---8<--- end core ---8<---

const ID = 'novel-reader'
const PANE_WIDTH = '380px'
const MIN_FONT = 13
const MAX_FONT = 26
const TOC_RENDER_LIMIT = 400

const DEFAULTS = { family: 'serif', fontSize: 17, lineHeight: 1.9, surface: 'float', theme: 'auto' }
const BOOK_EXTENSIONS = ['txt', 'text', 'md', 'markdown']
const THEMES = ['auto', 'paper', 'green', 'night']
const THEME_GLYPH = { auto: '◐', green: '❦', night: '☾', paper: '▤' }

const LOCALES = {
  en: {
    paneTitle: 'Reader',
    emptyTitle: 'No book open',
    emptyBody: 'Pick the folder your books live in. Plain .txt and .md files — UTF-8 or GBK.',
    chooseFolder: 'Choose folder…',
    openFile: 'Open file…',
    resumeReading: '← Reading now',
    prevPage: 'Page back',
    nextPage: 'Page forward',
    pathLabel: 'or paste a folder path',
    open: 'Open',
    shelfFiles: count => `${count} chosen files`,
    navLabel: 'Reading',
    library: 'Library',
    contents: 'Table of contents',
    bigger: 'Bigger text (+)',
    smaller: 'Smaller text (−)',
    theme: 'Reading theme (t)',
    family: 'Serif / sans',
    back: 'Back to library (Esc)',
    empty: 'No .txt or .md books in this folder.',
    loading: 'Loading…',
    chapters: count => `${count} chapters`,
    parts: count => `${count} parts`,
    filtered: (shown, total) => `Showing first ${shown} of ${total} — type to narrow`,
    filterPlaceholder: 'Jump to chapter…',
    prevChapter: 'Previous chapter',
    nextChapter: 'Next chapter',
    failed: 'Could not open that book.',
    folderFailed: 'Could not read that folder.',
    chip: (book, percent) => `${book} · ${percent}`,
    chipTip: '(book) chapter — click to copy a bookmark',
    copied: 'Bookmark copied',
    copyBookmark: 'Copy bookmark',
    openReader: 'Open the reader',
    openPanel: 'Reading panel',
    closePanel: 'Close reading panel',
    useDock: 'Dock to the sidebar',
    useFloat: 'Float as a panel',
    surfaceHint: 'Where the reader opens',
    palette: 'Novel Reader: open a book folder',
    paletteOpen: 'Novel Reader: open reader'
  },
  zh: {
    paneTitle: '阅读',
    emptyTitle: '还没有打开书',
    emptyBody: '选一个放小说的文件夹，支持 .txt 和 .md，UTF-8 或 GBK 都行。',
    chooseFolder: '选择文件夹…',
    openFile: '打开文件…',
    resumeReading: '← 正在读的书',
    prevPage: '上一页',
    nextPage: '下一页',
    pathLabel: '或直接粘贴文件夹路径',
    open: '打开',
    shelfFiles: count => `选中的 ${count} 个文件`,
    navLabel: '阅读',
    library: '书架',
    contents: '目录',
    bigger: '放大字号 (+)',
    smaller: '缩小字号 (−)',
    theme: '阅读配色 (t)',
    family: '宋体 / 黑体',
    back: '返回书架 (Esc)',
    empty: '这个文件夹里没有 .txt 或 .md 文件。',
    loading: '正在读取…',
    chapters: count => `${count} 章`,
    parts: count => `${count} 段`,
    filtered: (shown, total) => `显示前 ${shown} / ${total} 项，输入可缩小范围`,
    filterPlaceholder: '跳转到章节…',
    prevChapter: '上一章',
    nextChapter: '下一章',
    failed: '这本书打不开。',
    folderFailed: '这个文件夹读不了。',
    chip: (book, percent) => `${book} · ${percent}`,
    chipTip: '(书名) 章节 — 点击复制书签',
    copied: '书签已复制',
    copyBookmark: '复制书签',
    openReader: '打开阅读页',
    openPanel: '阅读侧栏',
    closePanel: '关闭阅读侧栏',
    useDock: '改为边栏模式',
    useFloat: '改为浮窗模式',
    surfaceHint: '阅读器打开的位置',
    palette: 'Novel Reader：打开小说文件夹',
    paletteOpen: 'Novel Reader：打开阅读页'
  },
  'zh-hant': {
    paneTitle: '閱讀',
    emptyTitle: '還沒有開啟書',
    emptyBody: '選一個放小說的資料夾，支援 .txt 和 .md，UTF-8 或 GBK 都可以。',
    chooseFolder: '選擇資料夾…',
    openFile: '開啟檔案…',
    resumeReading: '← 正在讀的書',
    prevPage: '上一頁',
    nextPage: '下一頁',
    pathLabel: '或直接貼上資料夾路徑',
    open: '開啟',
    shelfFiles: count => `選取的 ${count} 個檔案`,
    navLabel: '閱讀',
    library: '書架',
    contents: '目錄',
    bigger: '放大字級 (+)',
    smaller: '縮小字級 (−)',
    theme: '閱讀配色 (t)',
    family: '宋體 / 黑體',
    back: '返回書架 (Esc)',
    empty: '這個資料夾裡沒有 .txt 或 .md 檔案。',
    loading: '正在讀取…',
    chapters: count => `${count} 章`,
    parts: count => `${count} 段`,
    filtered: (shown, total) => `顯示前 ${shown} / ${total} 項，輸入可縮小範圍`,
    filterPlaceholder: '跳轉到章節…',
    prevChapter: '上一章',
    nextChapter: '下一章',
    failed: '這本書打不開。',
    folderFailed: '這個資料夾讀不了。',
    chip: (book, percent) => `${book} · ${percent}`,
    chipTip: '(書名) 章節 — 點擊複製書籤',
    copied: '書籤已複製',
    copyBookmark: '複製書籤',
    openReader: '開啟閱讀頁',
    openPanel: '閱讀側欄',
    closePanel: '關閉閱讀側欄',
    useDock: '改為側欄模式',
    useFloat: '改為浮窗模式',
    surfaceHint: '閱讀器開啟的位置',
    palette: 'Novel Reader：開啟小說資料夾',
    paletteOpen: 'Novel Reader：開啟閱讀頁'
  }
}

// Disk plugins are not scanned by Tailwind, so the reader carries its own CSS.
// Chrome (header, toolbar, rows) uses theme variables only. The reading surface
// is content, like an image viewer: its four themes own their colors on purpose.
const CSS = `
.nr-pane{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;color:var(--ui-text-secondary);overflow:hidden}
.nr-pane-close{position:absolute;top:5px;right:6px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--ui-text-tertiary);font:inherit;font-size:14px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}
.nr-pane-close:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-pane-close:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.nr-head{display:flex;align-items:baseline;gap:6px;padding:7px 30px 5px 10px;min-width:0;border-bottom:1px solid var(--ui-stroke-secondary)}
.nr-head-book{flex:1;min-width:0;font-size:12px;line-height:15px;font-weight:500;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-head-count{flex-shrink:0;font-size:10.5px;color:var(--ui-text-quaternary);font-variant-numeric:tabular-nums}
.nr-tools{display:flex;align-items:center;gap:1px;padding:3px 6px;border-bottom:1px solid var(--ui-stroke-secondary)}
.nr-tool{display:inline-flex;align-items:center;justify-content:center;height:22px;min-width:22px;padding:0 5px;border:0;border-radius:4px;background:transparent;color:var(--ui-text-tertiary);font:inherit;font-size:11px;cursor:pointer}
.nr-tool:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-tool[data-active=true]{color:var(--ui-accent)}
.nr-tool:disabled{opacity:.35;cursor:default}
.nr-tool:disabled:hover{background:transparent;color:var(--ui-text-tertiary)}
.nr-tool:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.nr-spacer{flex:1;min-width:4px}
.nr-column{display:flex;flex:1;min-height:0;flex-direction:column}
.nr-reader{position:relative;display:flex;flex:1;min-height:0}
.nr-surface{flex:1;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px 34px 72px;outline:none;white-space:pre-wrap;overflow-wrap:break-word}
.nr-inner{max-width:46em;margin:0 auto}
.nr-gutter{position:absolute;top:0;bottom:0;z-index:2;display:flex;align-items:center;justify-content:center;width:30px;padding:0;border:0;background:transparent;color:var(--ui-text-tertiary);font:inherit;font-size:15px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s ease,background .12s ease}
.nr-gutter[data-side=left]{left:0;border-radius:0 4px 4px 0}
.nr-gutter[data-side=right]{right:0;border-radius:4px 0 0 4px}
.nr-gutter:hover,.nr-gutter:focus-visible{opacity:.9;outline:none;background:var(--chrome-action-hover)}
@media (hover:none){.nr-gutter{opacity:.4}}
.nr-surface[data-theme=auto]{color:var(--ui-text-primary)}
.nr-surface[data-theme=paper]{background:#f7efe0;color:#3a3226}
.nr-surface[data-theme=green]{background:#d9e9d4;color:#24301f}
.nr-surface[data-theme=night]{background:#17181b;color:#c9c6c0}
.nr-surface[data-family=serif]{font-family:"Songti SC","Noto Serif CJK SC","Source Han Serif SC",Georgia,serif}
.nr-surface[data-family=sans]{font-family:var(--font-ui,ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif)}
.nr-chapter-title{margin:0 0 .9em;font-size:1.06em;font-weight:600;line-height:1.5;opacity:.85}
.nr-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px}
.nr-row{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.nr-row:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-row[data-current=true]{color:var(--ui-accent)}
.nr-row-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-row-meta{flex-shrink:0;font-size:10.5px;color:var(--ui-text-quaternary);font-variant-numeric:tabular-nums}
.nr-search{display:flex;align-items:center;padding:4px 6px 2px}
.nr-search input{width:100%;height:24px;padding:0 8px;border:1px solid var(--ui-stroke-secondary);border-radius:4px;background:transparent;color:var(--ui-text-primary);font:inherit;font-size:11.5px}
.nr-search input:focus{outline:1px solid var(--ui-accent);outline-offset:-1px}
.nr-note{padding:6px 10px 10px;font-size:10.5px;line-height:16px;color:var(--ui-text-quaternary)}
.nr-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px 22px;text-align:center}
.nr-empty-title{font-size:12.5px;font-weight:500;color:var(--ui-text-primary)}
.nr-empty-body{max-width:270px;font-size:11.5px;line-height:17px;color:var(--ui-text-tertiary)}
.nr-path{display:flex;gap:4px;width:100%;max-width:290px;margin-top:2px}
.nr-path input{flex:1;min-width:0;height:24px;padding:0 8px;border:1px solid var(--ui-stroke-secondary);border-radius:4px;background:transparent;color:var(--ui-text-primary);font:inherit;font-size:11px}
.nr-path input:focus{outline:1px solid var(--ui-accent);outline-offset:-1px}
.nr-primary{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:0;border-radius:5px;background:var(--ui-accent);color:#fff;font:inherit;font-size:11.5px;font-weight:500;cursor:pointer}
.nr-primary:hover{filter:brightness(1.08)}
.nr-ghost{display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid var(--ui-stroke-secondary);border-radius:5px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:11px;cursor:pointer}
.nr-ghost:hover:not(:disabled){background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-ghost:disabled{opacity:.45;cursor:default}
.nr-foot{display:flex;flex-shrink:0;align-items:center;gap:6px;padding:4px 8px 5px;border-top:1px solid var(--ui-stroke-secondary)}
.nr-bar{position:relative;flex:1;height:2px;overflow:hidden;border-radius:2px;background:var(--ui-stroke-secondary)}
.nr-bar>i{position:absolute;inset:0 auto 0 0;border-radius:2px;background:var(--ui-accent)}
.nr-pct{min-width:30px;font-size:10.5px;color:var(--ui-text-quaternary);font-variant-numeric:tabular-nums;text-align:right}
.nr-chapter{max-width:150px;font-size:10.5px;color:var(--ui-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-error{padding:10px 12px;font-size:11.5px;line-height:16px;color:var(--destructive,#e5484d)}
.nr-titlebar-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--ui-text-tertiary);cursor:pointer;transition:background .12s ease,color .12s ease}
.nr-titlebar-btn:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-titlebar-btn:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.nr-overlay{position:fixed;right:0;z-index:40;display:flex;flex-direction:column;width:min(440px,92vw);overflow:hidden;border-left:1px solid var(--ui-stroke-secondary);border-top-left-radius:8px;border-bottom-left-radius:8px;background:var(--ui-bg-chrome,var(--background,transparent));box-shadow:-18px 0 40px rgb(0 0 0 / 16%),-2px 0 0 rgb(0 0 0 / 4%)}
.nr-overlay[data-side=right]{right:0}
.nr-chip{display:inline-flex;align-items:center;gap:3px;height:100%;padding:0 6px;border:0;background:transparent;color:var(--ui-text-tertiary);font:inherit;font-size:10.5px;cursor:pointer;transition:background .12s ease,color .12s ease}
.nr-chip:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.nr-chip:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
`

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const st = atom({
  book: null,
  books: [],
  chapterIndex: 0,
  chapterRatio: 0,
  chapters: [],
  error: null,
  loading: false,
  phase: 'boot',
  posEpoch: 0,
  root: null,
  settings: DEFAULTS
})

const hud = atom({ book: '', chapter: '', fraction: 0 })
/** The floating reading panel beside the conversation. */
const overlayOpen = atom(false)

/** Book text lives outside the atom: a 5 MB string is not something to copy. */
let bookText = ''
/** Filesystem door, resolved once. */
let door = null
let ctxRef = null
let progressTimer = null
let positionRel = ''
let lastReport = { index: 0, ratio: 0 }

const patch = next => st.set({ ...st.get(), ...next })
const current = () => st.get()

function loadSettings() {
  const saved = ctxRef.storage.get('settings', null)

  return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

/**
 * Merge a settings change into the live state. Callers pass only what changed:
 * reading the previous value from `st` (not from a render closure) is what keeps
 * two quick clicks — "bigger text" then "theme" — from losing the first one.
 */
function saveSettings(changes) {
  const settings = { ...current().settings, ...changes }

  ctxRef.storage.set('settings', settings)
  patch({ settings })
}

const clampFont = size => Math.min(MAX_FONT, Math.max(MIN_FONT, size))
const bumpFont = delta => saveSettings({ fontSize: clampFont(current().settings.fontSize + delta) })
const cycleTheme = () =>
  saveSettings({ theme: THEMES[(THEMES.indexOf(current().settings.theme) + 1) % THEMES.length] })
const toggleFamily = () => saveSettings({ family: current().settings.family === 'serif' ? 'sans' : 'serif' })

function savePosition(index, ratio) {
  if (!positionRel) {
    return
  }

  ctxRef.storage.set(`pos:${positionRel}`, { at: Date.now(), index, ratio })
}

/** Report scroll progress: cheap HUD updates, debounced storage writes. */
function reportProgress(index, ratio) {
  const { book, chapters } = current()
  const fraction = bookFraction(chapters, index, ratio)
  const next = { book: book?.name ?? '', chapter: chapters[index]?.title ?? '', fraction }
  const last = hud.get()

  lastReport = { index, ratio }

  if (next.chapter !== last.chapter || next.book !== last.book || Math.abs(next.fraction - last.fraction) > 0.002) {
    hud.set(next)
  }

  if (progressTimer) {
    clearTimeout(progressTimer)
  }

  progressTimer = setTimeout(() => {
    progressTimer = null
    savePosition(lastReport.index, lastReport.ratio)
  }, 600)
}

function flushProgress() {
  if (!progressTimer) {
    return
  }

  clearTimeout(progressTimer)
  progressTimer = null
  savePosition(lastReport.index, lastReport.ratio)
}

// ---------------------------------------------------------------------------
// Filesystem doors
// ---------------------------------------------------------------------------

/**
 * `ctx.files` door — granted folders, paths relative to the grant, and ids that
 * survive restarts. Only present on builds that ship the plugin-files bridge.
 */
function grantDoor(ctx) {
  return {
    kind: 'grant',

    async pick() {
      const result = await ctx.files.requestFolder()

      if (!result || !result.ok || !result.folder) {
        return null
      }

      return { id: result.folder.id, name: result.folder.name, path: result.folder.path }
    },

    async list(root) {
      const result = await ctx.files.list(root.id, '')

      if (!result || result.ok === false) {
        throw new Error(result?.message || result?.error || 'list failed')
      }

      return (result.entries || []).map(entry => ({
        isDirectory: Boolean(entry.isDirectory),
        name: entry.name,
        rel: entry.path
      }))
    },

    async read(root, entry) {
      const result = await ctx.files.readDataUrl(root.id, entry.rel)

      if (!result || result.ok === false) {
        throw new Error(result?.message || result?.error || 'read failed')
      }

      const bytes = dataUrlToBytes(result.url)

      if (!bytes) {
        throw new Error('unreadable data url')
      }

      return bytes
    }
  }
}

/**
 * Electron bridge door — what current builds expose. Paths are absolute, and the
 * user grants access by picking the folder (or pasting its path).
 */
function bridgeDoor(bridge) {
  const join = (root, rel) => (rel ? `${root.path}/${rel}` : root.path)

  return {
    kind: 'bridge',

    async pick(defaultPath) {
      const picked = await bridge.selectPaths({
        defaultPath: defaultPath || undefined,
        directories: true,
        multiple: false,
        title: 'Choose your book folder'
      })

      const path = Array.isArray(picked) ? picked[0] : null

      if (!path) {
        return null
      }

      return { name: path.split(/[\\/]/).filter(Boolean).pop() || path, path }
    },

    async list(root) {
      const result = await bridge.readDir(root.path)

      if (!result || result.error) {
        throw new Error(result?.error || 'list failed')
      }

      const prefix = root.path.endsWith('/') ? root.path : `${root.path}/`

      return (result.entries || []).map(entry => ({
        isDirectory: Boolean(entry.isDirectory),
        name: entry.name,
        rel: entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.name
      }))
    },

    async read(root, entry) {
      // A shelf of individually chosen files carries its own absolute path; a
      // folder listing carries a path relative to the chosen folder.
      const url = await bridge.readFileDataUrl(entry.abs ?? join(root, entry.rel))

      if (typeof url !== 'string') {
        throw new Error(url?.error || 'read failed')
      }

      const bytes = dataUrlToBytes(url)

      if (!bytes) {
        throw new Error('unreadable data url')
      }

      return bytes
    }
  }
}

function ensureDoor() {
  if (door) {
    return door
  }

  if (ctxRef.files && typeof ctxRef.files.requestFolder === 'function') {
    door = grantDoor(ctxRef)
  } else if (typeof window !== 'undefined' && window.hermesDesktop?.readFileDataUrl) {
    door = bridgeDoor(window.hermesDesktop)
  }

  return door
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function openFolder(explicitPath) {
  const active = ensureDoor()

  if (!active) {
    patch({ error: 'no-file-door', phase: 'empty' })
    return
  }

  const root = explicitPath
    ? { name: explicitPath.split(/[\\/]/).filter(Boolean).pop() || explicitPath, path: explicitPath }
    : await active.pick(current().root?.path)

  if (!root) {
    return
  }

  ctxRef.storage.set('root', { kind: active.kind, ...root })
  patch({ error: null, loading: true, phase: 'library', root })

  try {
    const entries = await active.list(root)
    const books = sortBookEntries(entries.filter(entry => !entry.isDirectory && isBookFile(entry.name)))

    patch({ books, loading: false })
  } catch (error) {
    patch({ books: [], error: String(error?.message || error), loading: false })
  }
}

/**
 * Open individual books instead of scanning a folder. Only the Electron bridge
 * door can do this — `ctx.files` grants whole folders and has no single-file
 * picker, so the button hides itself on that door.
 */
async function openFiles() {
  const bridge = typeof window !== 'undefined' ? window.hermesDesktop : null

  if (!bridge?.selectPaths) {
    return
  }

  const picked = await bridge.selectPaths({
    directories: false,
    filters: [{ extensions: BOOK_EXTENSIONS, name: 'Books' }],
    multiple: true,
    title: 'Open books'
  })

  const entries = (Array.isArray(picked) ? picked : [])
    .filter(path => isBookFile(path))
    .map(path => ({ abs: path, isDirectory: false, name: path.split(/[\\/]/).pop() || path, rel: path }))

  if (!entries.length) {
    return
  }

  const root = {
    kind: 'files',
    name: entries.length === 1 ? titleFromPath(entries[0].name) : `${entries.length} files`,
    path: ''
  }

  ctxRef.storage.set('root', root)
  ctxRef.storage.set('shelf', entries.map(entry => ({ abs: entry.abs, name: entry.name })))
  ensureDoor()
  patch({ books: sortBookEntries(entries), error: null, loading: false, phase: 'library', root })

  if (entries.length === 1) {
    await openBook(entries[0])
  }
}

/**
 * Where the title-bar button puts the reader. `float` slides the panel over the
 * conversation; `dock` reveals the contributed layout pane, which lives in the
 * app's right-edge region (shared with files / review / terminal — that region
 * only has one toggle, hence the panel as the alternative).
 */
function readerSurface() {
  const stored = current().settings?.surface ?? ctxRef.storage.get('settings', {})?.surface

  return stored === 'dock' ? 'dock' : 'float'
}

/** True when the layout pane is mounted AND actually painted. */
function dockedPaneVisible() {
  const pane = document.querySelector('.nr-pane[data-nr-variant="layout"]')

  return !!pane && pane.getBoundingClientRect().width > 0
}

function openReader() {
  if (readerSurface() === 'dock') {
    void ctxRef.runAction?.('view.toggleRightSidebar')
    return
  }

  overlayOpen.set(true)
}

function setSurface(next) {
  saveSettings({ surface: next })

  if (next === 'dock') {
    overlayOpen.set(false)

    if (!dockedPaneVisible()) {
      void ctxRef.runAction?.('view.toggleRightSidebar')
    }

    return
  }

  overlayOpen.set(true)

  // Leaving dock mode should not leave the docked column on screen behind the
  // panel — one reading surface at a time.
  if (dockedPaneVisible()) {
    void ctxRef.runAction?.('view.toggleRightSidebar')
  }
}

async function openBook(entry) {
  const { root } = current()

  if (!root || !door) {
    return
  }

  patch({ error: null, loading: true })

  try {
    const decoded = decodeBookText(await door.read(root, entry))
    const text = sanitizeText(decoded.text)

    if (!text) {
      throw new Error('empty file')
    }

    // One key per book: the absolute path for a chosen file, the path relative to
    // the granted folder otherwise.
    const key = entry.abs ?? entry.rel

    bookText = text
    positionRel = key

    const split = splitChapters(text)
    const saved = ctxRef.storage.get(`pos:${key}`, null)
    const index = saved && Number.isInteger(saved.index)
      ? Math.min(Math.max(0, saved.index), split.chapters.length - 1)
      : 0
    const ratio = saved && Number.isFinite(saved.ratio) ? saved.ratio : 0
    const name = titleFromPath(entry.name)

    ctxRef.storage.set('last', { rel: key })
    lastReport = { index, ratio }
    hud.set({ book: name, chapter: split.chapters[index]?.title ?? '', fraction: bookFraction(split.chapters, index, ratio) })
    patch({
      book: { encoding: decoded.encoding, name, rel: key, units: split.kind },
      chapterIndex: index,
      chapterRatio: ratio,
      chapters: split.chapters,
      loading: false,
      phase: 'reading',
      posEpoch: current().posEpoch + 1
    })
  } catch (error) {
    patch({ error: String(error?.message || error), loading: false })
  }
}

/**
 * Switch chapters. `ratio` is where to land inside the new chapter (0 top, 1
 * bottom). The new position is persisted immediately: one bookmark per book, so
 * the previous chapter's offset is not worth keeping — and persisting here (not
 * only in the debounced scroll sink) means a chapter boundary crossing survives
 * quitting the app a moment later.
 */
function goChapter(index, ratio = 0) {
  const state = current()
  const next = Math.min(Math.max(0, index), state.chapters.length - 1)

  if (!state.chapters.length || next === state.chapterIndex) {
    return
  }

  lastReport = { index: next, ratio }
  savePosition(next, ratio)
  patch({ chapterIndex: next, chapterRatio: ratio, posEpoch: state.posEpoch + 1 })
  hud.set({ ...hud.get(), chapter: state.chapters[next]?.title ?? '', fraction: bookFraction(state.chapters, next, ratio) })
}

async function boot() {
  const settings = loadSettings()
  const savedRoot = ctxRef.storage.get('root', null)
  patch({ settings })

  const active = ensureDoor()

  // A shelf of chosen files has no folder path at all, so the path check cannot
  // be the only gate here.
  if (!active || (!savedRoot?.path && savedRoot?.kind !== 'files')) {
    patch({ error: active ? null : 'no-file-door', phase: 'empty' })
    return
  }

  const root = { id: savedRoot.id, kind: savedRoot.kind, name: savedRoot.name, path: savedRoot.path }

  if (savedRoot.kind === 'files') {
    const shelf = ctxRef.storage.get('shelf', [])
    const books = sortBookEntries(
      (Array.isArray(shelf) ? shelf : [])
        .filter(entry => entry && entry.abs)
        .map(entry => ({ abs: entry.abs, isDirectory: false, name: entry.name, rel: entry.abs }))
    )
    const last = ctxRef.storage.get('last', null)

    patch({ books, loading: false, phase: 'library', root })

    const match = last?.rel ? books.find(book => book.rel === last.rel) : null

    if (match) {
      await openBook(match)
    }

    return
  }

  patch({ loading: true, phase: 'library', root })

  try {
    const entries = await active.list(root)
    const books = sortBookEntries(entries.filter(entry => !entry.isDirectory && isBookFile(entry.name)))
    const last = ctxRef.storage.get('last', null)

    patch({ books, loading: false })

    const match = last?.rel ? books.find(book => book.rel === last.rel) : null

    if (match) {
      await openBook(match)
    }
  } catch {
    // A folder that no longer resolves (moved, permission revoked, another
    // machine) is not worth shouting about: start clean and let the user pick.
    ctxRef.storage.remove('root')
    patch({ books: [], loading: false, phase: 'empty' })
  }
}

let booted = false

function ensureBoot() {
  if (booted) {
    return
  }

  booted = true
  ensureDoor()
  void boot()
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * The status bar's permanent door: always present (so "where do I open this?" has
 * an answer even before a book exists), and it navigates to the reader page
 * instead of copying — a chip that sometimes navigates and sometimes copies is a
 * trap. Copying a bookmark lives on the reader's own footer.
 */
function Chip() {
  const t = usePluginI18n(ID)
  const values = useValue(hud)

  return jsx(Tip, {
    label: values.book ? t('chipTip') : t('openReader'),
    children: jsx('button', {
      'aria-label': values.book || t('navLabel'),
      className: 'nr-chip',
      'data-nr': 'chip',
      onClick: () => host.navigate('/novel'),
      type: 'button',
      children: values.book ? t('chip', values.book, percentLabel(values.fraction)) : t('navLabel')
    })
  })
}

/**
 * Title-bar entry point. `titleBar.*` is a Slot area — it renders `render`, not a
 * `TitlebarTool` payload — so this is a small ghost button shaped like the
 * system tools next to it, and it is mounted permanently (title-bar slots
 * survive route changes).
 *
 * It slides the reading panel in over the right edge of the conversation, which
 * is what "read beside the chat" means here: the contributed layout pane lives
 * inside the app's right-edge region (one toggle for files + review + terminal),
 * so a panel the reader owns is the only way to open the reader alone.
 */
function TitleBarReader() {
  const t = usePluginI18n(ID)
  const open = useValue(overlayOpen)

  return jsxs(Fragment, {
    children: [
      jsx(Tip, {
        label: open ? t('closePanel') : t('openPanel'),
        placement: 'toolbar',
        children: jsx('button', {
          'aria-label': open ? t('closePanel') : t('openPanel'),
          'aria-pressed': open,
          className: 'nr-titlebar-btn',
          'data-active': open,
          'data-nr': 'titlebar',
          onClick: () => (overlayOpen.get() ? overlayOpen.set(false) : openReader()),
          type: 'button',
          children: jsx(Codicon, { name: 'book', size: 14 })
        })
      }),
      open ? jsx(ReadingPanel, {}) : null
    ]
  })
}

/**
 * The floating panel: fixed to the right edge, between the title bar and the
 * status bar, sized from the live chrome so it never covers either. It renders
 * the same reader as the pane and the page — one state, three surfaces.
 */
function ReadingPanel() {
  const [insets, setInsets] = useState({ bottom: 28, top: 34 })

  useEffect(() => {
    const measure = () => {
      const titlebar = document.querySelector('[data-titlebar-cluster="left"]') ?? document.querySelector('[data-titlebar-cluster="right"]')
      const statusbar = document.querySelector('[data-slot="statusbar"]')
      const top = titlebar ? Math.round(titlebar.getBoundingClientRect().bottom + 8) : 34
      const bottom = statusbar ? Math.round(window.innerHeight - statusbar.getBoundingClientRect().top) : 28

      setInsets({ bottom: Math.max(8, bottom), top: Math.max(24, top) })
    }

    measure()
    const listener = ctxRef.addEventListener(window, 'resize', measure)

    return () => listener()
  }, [])

  return jsx('div', {
    className: 'nr-overlay',
    'data-nr': 'panel',
    'data-side': 'right',
    onKeyDownCapture: event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        overlayOpen.set(false)
      }
    },
    style: { bottom: `${insets.bottom}px`, top: `${insets.top}px` },
    children: jsx(NovelPane, { onClose: () => overlayOpen.set(false), variant: 'panel' })
  })
}

function copyBookmark(t) {
  const values = hud.get()
  const line = resumeLine(values.book, values.chapter, values.fraction)

  void ctxRef.os?.writeClipboard?.(line)
  host.notify({ detail: line, kind: 'success', message: t('copied') })
}

function Toolbar({ state, t, toc, onToggleToc }) {
  return jsxs('div', {
    className: 'nr-tools',
    children: [
      jsx('button', {
        'aria-label': t('library'),
        className: 'nr-tool',
        'data-nr': 'library',
        onClick: () => { flushProgress(); patch({ phase: 'library' }) },
        title: t('library'),
        type: 'button',
        children: '☰'
      }),
      jsx('button', {
        'aria-label': t('contents'),
        className: 'nr-tool',
        'data-nr': 'contents',
        'data-active': toc,
        onClick: onToggleToc,
        title: t('contents'),
        type: 'button',
        children: '≡'
      }),
      jsx('span', { className: 'nr-spacer' }),
      jsx('button', { 'aria-label': t('smaller'), className: 'nr-tool', 'data-nr': 'smaller', onClick: () => bumpFont(-1), title: t('smaller'), type: 'button', children: 'A−' }),
      jsx('button', { 'aria-label': t('bigger'), className: 'nr-tool', 'data-nr': 'bigger', onClick: () => bumpFont(1), title: t('bigger'), type: 'button', children: 'A+' }),
      jsx('button', {
        'aria-label': t('family'),
        className: 'nr-tool',
        'data-active': state.settings.family === 'serif',
        'data-nr': 'family',
        onClick: toggleFamily,
        title: t('family'),
        type: 'button',
        children: 'Aa'
      }),
      jsx('button', {
        'aria-label': state.settings.surface === 'dock' ? t('useFloat') : t('useDock'),
        className: 'nr-tool',
        'data-nr': 'surface',
        onClick: () => setSurface(state.settings.surface === 'dock' ? 'float' : 'dock'),
        title: state.settings.surface === 'dock' ? t('useFloat') : t('useDock'),
        type: 'button',
        children: jsx(Codicon, {
          name: state.settings.surface === 'dock' ? 'multiple-windows' : 'layout-sidebar-right',
          size: 12
        })
      }),
      jsx('button', {
        'aria-label': t('theme'),
        className: 'nr-tool',
        'data-active': state.settings.theme !== 'auto',
        'data-nr': 'theme',
        onClick: cycleTheme,
        title: t('theme'),
        type: 'button',
        children: THEME_GLYPH[state.settings.theme] ?? '◐'
      })
    ]
  })
}

function Toc({ state, t, onNavigate }) {
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const matches = []

  for (let i = 0; i < state.chapters.length; i++) {
    if (!needle ? matches.length < TOC_RENDER_LIMIT : state.chapters[i].title.toLowerCase().includes(needle)) {
      matches.push(i)
    }

    if (!needle && matches.length >= TOC_RENDER_LIMIT) {
      break
    }
  }

  return jsxs('div', {
    className: 'nr-column',
    children: [
      jsx('div', {
        className: 'nr-search',
        children: jsx('input', {
          'aria-label': t('filterPlaceholder'),
          onChange: event => setFilter(event.target.value),
          placeholder: t('filterPlaceholder'),
          value: filter
        })
      }),
      jsx('div', {
        className: 'nr-list',
        children: matches.map(index => jsx('button', {
          className: 'nr-row',
          'data-current': index === state.chapterIndex,
          onClick: () => onNavigate(index),
          type: 'button',
          children: [
            jsx('span', { className: 'nr-row-name', children: state.chapters[index].title }),
            jsx('span', { className: 'nr-row-meta', children: String(index + 1) })
          ]
        }, `${index}:${state.chapters[index].title}`))
      }),
      !needle && matches.length >= TOC_RENDER_LIMIT
        ? jsx('div', { className: 'nr-note', children: t('filtered', matches.length, state.chapters.length) })
        : null
    ]
  })
}

function Library({ state, t }) {
  return jsxs('div', {
    className: 'nr-column',
    children: [
      jsxs('div', {
        className: 'nr-tools',
        style: { borderBottom: 'none', padding: '6px 6px 4px' },
        children: [
          jsx('button', { className: 'nr-ghost', 'data-nr': 'choose-folder', onClick: () => void openFolder(), type: 'button', children: t('chooseFolder') }),
          door?.kind === 'grant'
            ? null
            : jsx('button', { className: 'nr-ghost', 'data-nr': 'open-file', onClick: () => void openFiles(), type: 'button', children: t('openFile') }),
          state.book
            ? jsx('button', {
                'aria-label': t('resumeReading'),
                className: 'nr-tool',
                'data-nr': 'resume',
                onClick: () => patch({ phase: 'reading' }),
                title: t('resumeReading'),
                type: 'button',
                children: '↩'
              })
            : null,
          jsx('span', { className: 'nr-spacer' }),
          jsx('span', {
            className: 'nr-row-meta',
            style: { maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            title: state.root?.path || state.root?.name || '',
            children: state.root?.name ?? ''
          })
        ]
      }),
      state.loading
        ? jsx('div', { className: 'nr-note', children: t('loading') })
        : jsx('div', {
            className: 'nr-list',
            children: state.books.length
              ? state.books.map(book => jsx('button', {
                  className: 'nr-row',
                  onClick: () => void openBook(book),
                  type: 'button',
                  children: [
                    jsx('span', { className: 'nr-row-name', children: titleFromPath(book.name) }),
                    jsx('span', { className: 'nr-row-meta', children: book.name.split('.').pop()?.toUpperCase() ?? '' })
                  ]
                }, book.rel))
              : jsx('div', { className: 'nr-note', children: state.error ? t('folderFailed') : t('empty') })
          })
    ]
  })
}

function Empty({ state, t }) {
  const [path, setPath] = useState('')
  const open = () => {
    const trimmed = path.trim()

    if (trimmed) {
      void openFolder(trimmed)
    }
  }

  return jsxs('div', {
    className: 'nr-empty',
    children: [
      jsx('div', { className: 'nr-empty-title', children: t('emptyTitle') }),
      jsx('div', { className: 'nr-empty-body', children: state.error && state.error !== 'no-file-door' ? t('folderFailed') : t('emptyBody') }),
      jsx('button', { className: 'nr-primary', 'data-nr': 'choose-folder', onClick: () => void openFolder(), type: 'button', children: t('chooseFolder') }),
      door?.kind === 'grant'
        ? null
        : jsx('button', { className: 'nr-ghost', 'data-nr': 'open-file', onClick: () => void openFiles(), type: 'button', children: t('openFile') }),
      door?.kind === 'bridge'
        ? jsxs('div', {
            className: 'nr-path',
            children: [
              jsx('input', {
                'aria-label': t('pathLabel'),
                onChange: event => setPath(event.target.value),
                onKeyDown: event => {
                  if (event.key === 'Enter') {
                    open()
                  }
                },
                placeholder: t('pathLabel'),
                value: path
              }),
              jsx('button', { className: 'nr-ghost', disabled: !path.trim(), onClick: open, type: 'button', children: t('open') })
            ]
          })
        : null
    ]
  })
}

function ReaderSurface({ chapter, settings, startRatio, onEdge, onFont, onPosition, onTheme, t }) {
  const ref = useRef(null)
  const settled = useRef(false)

  useEffect(() => {
    const el = ref.current

    if (!el) {
      return undefined
    }

    const apply = () => {
      if (!settled.current) {
        el.scrollTop = scrollOffsetFor(startRatio, el)
      }
    }

    const markSettled = () => {
      settled.current = true
    }

    apply()
    const frame = requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(apply)
    })
    const timer = setTimeout(apply, 90)

    el.addEventListener('wheel', markSettled, { once: true, passive: true })
    el.addEventListener('pointerdown', markSettled, { once: true })

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      el.removeEventListener('wheel', markSettled)
      el.removeEventListener('pointerdown', markSettled)
    }
  }, [])

  const frame = useRef(0)

  const handleScroll = () => {
    if (frame.current) {
      return
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = ref.current

      if (el) {
        onPosition(scrollRatio(el))
      }
    })
  }

  const page = direction => {
    const el = ref.current

    if (!el) {
      return
    }

    const lineHeight = settings.fontSize * settings.lineHeight
    const step = Math.max(48, Math.round(el.clientHeight - lineHeight * 1.5))
    const max = el.scrollHeight - el.clientHeight

    if (direction > 0) {
      if (el.scrollTop >= max - 4) {
        settled.current = true
        onEdge(1)
        return
      }

      el.scrollBy({ behavior: 'smooth', top: Math.min(step, max - el.scrollTop) })
      return
    }

    if (el.scrollTop <= 4) {
      settled.current = true
      onEdge(-1)
      return
    }

    el.scrollBy({ behavior: 'smooth', top: -Math.min(step, el.scrollTop) })
  }

  const handleKeyDown = event => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const key = event.key

    if (key === ' ' || key === 'PageDown' || key === 'ArrowRight' || key === 'j') {
      event.preventDefault()
      page(event.shiftKey ? -1 : 1)
      return
    }

    if (key === 'PageUp' || key === 'ArrowLeft' || key === 'k') {
      event.preventDefault()
      page(-1)
      return
    }

    if (key === 'Home' || key === 'End') {
      event.preventDefault()
      const el = ref.current

      if (el) {
        el.scrollTop = key === 'Home' ? 0 : el.scrollHeight
      }

      return
    }

    if (key === '+' || key === '=') {
      event.preventDefault()
      onFont(1)
      return
    }

    if (key === '-') {
      event.preventDefault()
      onFont(-1)
      return
    }

    if (key === 't') {
      event.preventDefault()
      onTheme()
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      onEdge('library')
    }
  }

  // Page turns live on the two hover gutters, never on the text: a click in the
  // reading area stays a click (selection, caret, or nothing at all).
  const turn = direction => {
    page(direction)
    ref.current?.focus({ preventScroll: true })
  }

  return jsxs('div', {
    className: 'nr-reader',
    children: [
      jsxs('div', {
        className: 'nr-surface',
        'data-family': settings.family,
        'data-nr': 'prose',
        'data-theme': settings.theme,
        onKeyDown: handleKeyDown,
        onScroll: handleScroll,
        ref,
        style: { fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight },
        tabIndex: 0,
        children: [
          jsxs('div', {
            className: 'nr-inner',
            children: [
              jsx('div', { className: 'nr-chapter-title', children: chapter.title }),
              jsx('div', { children: chapter.text })
            ]
          })
        ]
      }),
      jsx('button', {
        'aria-label': t('prevPage'),
        className: 'nr-gutter',
        'data-nr': 'prev-page',
        'data-side': 'left',
        onClick: () => turn(-1),
        tabIndex: -1,
        title: t('prevPage'),
        type: 'button',
        children: '‹'
      }),
      jsx('button', {
        'aria-label': t('nextPage'),
        className: 'nr-gutter',
        'data-nr': 'next-page',
        'data-side': 'right',
        onClick: () => turn(1),
        tabIndex: -1,
        title: t('nextPage'),
        type: 'button',
        children: '›'
      })
    ]
  })
}

function Foot({ state, t }) {
  const values = useValue(hud)

  return jsxs('div', {
    className: 'nr-foot',
    'data-nr': 'foot',
    children: [
      jsx('button', {
        'aria-label': t('prevChapter'),
        className: 'nr-tool',
        disabled: state.chapterIndex <= 0,
        onClick: () => goChapter(state.chapterIndex - 1, 1),
        type: 'button',
        children: '‹'
      }),
      jsx('div', { className: 'nr-chapter', children: state.chapters[state.chapterIndex]?.title ?? '' }),
      jsxs('div', {
        className: 'nr-bar',
        children: [jsx('i', { style: { width: `${Math.round(values.fraction * 1000) / 10}%` } })]
      }),
      jsx('span', { className: 'nr-pct', children: percentLabel(values.fraction) }),
      jsx('button', {
        'aria-label': t('copyBookmark'),
        className: 'nr-tool',
        'data-nr': 'copy-bookmark',
        onClick: () => copyBookmark(t),
        title: t('copyBookmark'),
        type: 'button',
        children: '⧉'
      }),
      jsx('button', {
        'aria-label': t('nextChapter'),
        className: 'nr-tool',
        disabled: state.chapterIndex >= state.chapters.length - 1,
        onClick: () => goChapter(state.chapterIndex + 1, 0),
        type: 'button',
        children: '›'
      })
    ]
  })
}

function CloseButton({ onClose, t }) {
  return onClose
    ? jsx('button', {
        'aria-label': t('closePanel'),
        className: 'nr-pane-close',
        'data-nr': 'close-panel',
        onClick: onClose,
        title: t('closePanel'),
        type: 'button',
        children: '\u00d7'
      })
    : null
}

function NovelPane({ onClose, variant = 'layout' }) {
  const t = usePluginI18n(ID)
  const state = useValue(st)
  const [toc, setToc] = useState(false)

  useEffect(() => {
    ensureBoot()
  }, [])

  if (state.phase === 'boot') {
    return jsx('div', { 'data-nr-variant': variant, className: 'nr-pane' })
  }

  if (state.phase === 'empty' || !state.root) {
    return jsxs('div', {
      'data-nr-variant': variant, className: 'nr-pane',
      children: [jsx(Empty, { state, t }), jsx(CloseButton, { onClose, t })]
    })
  }

  if (state.phase === 'library') {
    return jsxs('div', {
      'data-nr-variant': variant, className: 'nr-pane',
      children: [
        jsxs('div', {
          className: 'nr-head',
          children: [
            jsx('span', { className: 'nr-head-book', title: state.root.path, children: state.root.name }),
            jsx('span', { className: 'nr-head-count', children: state.books.length || '' })
          ]
        }),
        jsx(Library, { state, t }),
        jsx(CloseButton, { onClose, t })
      ]
    })
  }

  const chapter = state.chapters[state.chapterIndex]

  if (!chapter) {
    return jsxs('div', {
      'data-nr-variant': variant, className: 'nr-pane',
      children: [jsx(Empty, { state, t }), jsx(CloseButton, { onClose, t })]
    })
  }

  const index = state.chapterIndex
  const onEdge = direction => {
    if (direction === 'library') {
      flushProgress()
      patch({ phase: 'library' })
      return
    }

    const next = index + direction

    if (next < 0 || next >= state.chapters.length) {
      return
    }

    goChapter(next, direction > 0 ? 0 : 1)
  }

  return jsxs('div', {
    'data-nr-variant': variant, className: 'nr-pane',
    children: [
      jsx(CloseButton, { onClose, t }),
      jsxs('div', {
        className: 'nr-head',
        children: [
          jsx('span', { className: 'nr-head-book', title: state.book?.name, children: state.book?.name ?? '' }),
          jsx('span', {
            className: 'nr-head-count',
            children: state.book?.units === 'parts' ? t('parts', state.chapters.length) : t('chapters', state.chapters.length)
          })
        ]
      }),
      jsx(Toolbar, { onToggleToc: () => setToc(!toc), state, t, toc }),
      toc
        ? jsx(Toc, {
            onNavigate: index => {
              goChapter(index)
              setToc(false)
            },
            state,
            t
          })
        : jsxs('div', {
            className: 'nr-column',
            children: [
              jsx(ReaderSurface, {
                chapter: { text: bookText.slice(chapter.start, chapter.end), title: chapter.title },
                key: `${state.book?.rel}:${state.posEpoch}`,
                onEdge,
                onFont: bumpFont,
                onPosition: ratio => reportProgress(index, ratio),
                onTheme: cycleTheme,
                settings: state.settings,
                startRatio: state.chapterRatio,
                t
              }),
              jsx(Foot, { state, t })
            ]
          })
    ]
  })
}

export default {
  id: ID,
  name: 'Novel Reader',
  description: 'Read .txt/.md novels in a side pane while the agent works. Remembers where you stopped.',
  register(pluginCtx) {
    ctxRef = pluginCtx

    // Every surface registers independently. A host that lacks one area (or one
    // component) must cost us that surface only — a throw here used to take the
    // whole plugin down, so the app showed nothing and said nothing.
    const failed = []
    const t = (key, ...args) => {
      try {
        return pluginCtx.i18n?.t?.(key, ...args) ?? key
      } catch (error) {
        failed.push(`i18n:${key} ${String(error)}`)

        return key
      }
    }
    const add = (id, contribution) => {
      try {
        pluginCtx.register(contribution)

        return true
      } catch (error) {
        failed.push(`${id}: ${String(error)}`)

        return false
      }
    }

    try {
      pluginCtx.i18n?.register?.(LOCALES)
    } catch (error) {
      failed.push(`i18n.register: ${String(error)}`)
    }

    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)

    try {
      pluginCtx.onDispose?.(() => {
        style.remove()
        flushProgress()
      })
    } catch (error) {
      failed.push(`onDispose: ${String(error)}`)
    }

    // Text the HOST stores as a plain string — pane title, sidebar row, palette
    // labels — is built once at register time, so a language switch would leave
    // it stale. These live in `relabelable` and are rebuilt through
    // `i18n.onLocaleChange` (the host hook for exactly this).
    const relabelable = []
    let relabelDisposers = []
    const addStatic = (id, build) => {
      const bind = () => {
        try {
          return pluginCtx.register(build(t))
        } catch (error) {
          failed.push(`${id}: ${String(error)}`)

          return () => {}
        }
      }

      relabelable.push(bind)
      relabelDisposers.push(bind())
    }

    // 1. The layout pane (docks into the app's right-edge region).
    addStatic('pane', tr => ({
      area: 'panes',
      data: { dock: { enforce: true, pane: 'workspace', pos: 'right' }, placement: 'right', width: PANE_WIDTH },
      id: 'pane',
      render: () => jsx(NovelPane, { variant: 'layout' }),
      title: tr('navLabel')
    }))

    // 2. The full-page reader, so "where do I open this" always has an answer.
    add('page', { area: ROUTES_AREA, data: { path: '/novel' }, id: 'page', render: () => jsx(NovelPane, { variant: 'page' }) })

    // 3. A sidebar row that leads there.
    addStatic('nav', tr => ({
      area: SIDEBAR_NAV_AREA,
      data: { codicon: 'book', label: tr('navLabel'), path: '/novel' },
      id: 'nav'
    }))

    // 4. A permanent status-bar chip — the one door that survives every layout.
    add('chip', { area: 'statusBar.right', id: 'chip', order: 120, render: () => jsx(Chip, {}) })

    // 5. The title-bar book button (opens the reader in the chosen mode).
    add('titlebar', { area: TITLEBAR_AREAS.right, id: 'titlebar', order: 60, render: () => jsx(TitleBarReader, {}) })

    // 6. Palette entries. The host matches every typed term against the label
    // and the joined keyword string, so the plugin id has to be a keyword of its
    // own: "novel-reader" is not a substring of "novel" or "reader".
    const PALETTE_KEYWORDS = [
      'novel', 'novel-reader', 'novelreader', 'novel_reader', 'novel reader',
      'book', 'books', 'read', 'reader', 'reading', 'library', 'txt', 'md',
      '小说', '阅读', '阅读器', '看书', '书架'
    ]

    addStatic('palette-open-reader', tr => ({
      area: PALETTE_AREA,
      data: {
        id: 'novel-reader.open-reader',
        keywords: PALETTE_KEYWORDS,
        label: tr('paletteOpen'),
        run: () => host.navigate('/novel')
      },
      id: 'palette-open-reader'
    }))

    addStatic('palette-open-folder', tr => ({
      area: PALETTE_AREA,
      data: {
        id: 'novel-reader.open-folder',
        keywords: [...PALETTE_KEYWORDS, 'folder', 'open', '文件夹', '打开'],
        label: tr('palette'),
        run: () => void openFolder()
      },
      id: 'palette-open-folder'
    }))

    try {
      pluginCtx.i18n?.onLocaleChange?.(() => {
        for (const dispose of relabelDisposers) {
          try {
            dispose()
          } catch {
            // A stale disposer is harmless — the rebuild below re-registers.
          }
        }

        relabelDisposers = relabelable.map(bind => bind())
      })
    } catch (error) {
      failed.push(`onLocaleChange: ${String(error)}`)
    }

    if (failed.length) {
      // Say it out loud: a silently half-registered plugin is unreadable from
      // the outside ("I installed it and nothing appeared").
      console.error(`[${ID}] ${failed.length} surface(s) failed`, failed)
      host.notify?.({
        detail: failed.join(' · ').slice(0, 400),
        kind: 'error',
        message: 'Novel Reader: partial load'
      })
    }
  }
}
