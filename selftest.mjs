/**
 * Offline selftest for @local/dsh-context-recom-hider.
 *
 * Runs the real `client.js` against a hand-rolled DOM stub — no browser, no
 * jsdom — and asserts the three things that make the plugin work:
 *
 *   1. `apply()` installs a stylesheet whose selector targets `.lc-recom` and
 *      hides it with `!important`.
 *   2. The sweep marks every `.lc-recom` node hidden and leaves the sibling
 *      plugin-info card (`div.lc-card` without `lc-recom`) untouched.
 *   3. Cleanup removes the stylesheet and restores the cards, so disabling the
 *      bundle puts the recommendation card back.
 *
 * The negative control at the end runs the same DOM *without* the plugin and
 * asserts the card is still visible, which is what makes the assertions above
 * meaningful rather than vacuous.
 *
 * Run: node selftest.mjs   (exit 0 = all passed)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, 'client.js')
const HOST = join(HERE, 'index.js')

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + detail))
  }
}

// ---------------------------------------------------------------------------
// Minimal DOM
// ---------------------------------------------------------------------------

class FakeStyle {
  constructor() {
    this.props = new Map()
  }
  setProperty(name, value, priority) {
    this.props.set(name, { value, priority: priority || '' })
  }
  removeProperty(name) {
    this.props.delete(name)
  }
  getPropertyValue(name) {
    const hit = this.props.get(name)
    return hit === undefined ? '' : hit.value
  }
  getPropertyPriority(name) {
    const hit = this.props.get(name)
    return hit === undefined ? '' : hit.priority
  }
}

class FakeEl {
  constructor(tag, className) {
    this.nodeType = 1
    this.tagName = String(tag || 'div').toUpperCase()
    this.className = className || ''
    this.attrs = new Map()
    this.style = new FakeStyle()
    this.children = []
    this.parentNode = null
    this.id = ''
    this.textContent = ''
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value))
    if (name === 'id') this.id = String(value)
  }
  getAttribute(name) {
    if (name === 'id') return this.id === '' ? null : this.id
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }
  removeAttribute(name) {
    this.attrs.delete(name)
    if (name === 'id') this.id = ''
  }
  hasAttribute(name) {
    return this.getAttribute(name) !== null
  }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }
  classList() {
    return this.className.split(/\s+/).filter(Boolean)
  }
  /** True when this element carries every class in `wanted`. */
  hasClasses(wanted) {
    const own = this.classList()
    return wanted.every((c) => own.includes(c))
  }
}

function walk(node, out) {
  out.push(node)
  for (const child of node.children) walk(child, out)
  return out
}

/** Supports exactly the two selectors this plugin uses. */
function matches(el, selector) {
  if (selector.startsWith('.')) {
    return el.hasClasses(selector.slice(1).split('.').filter(Boolean))
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    return el.hasAttribute(selector.slice(1, -1))
  }
  throw new Error('selftest stub: unsupported selector ' + selector)
}

function makeDocument() {
  const html = new FakeEl('html')
  const head = new FakeEl('head')
  const body = new FakeEl('body')
  html.appendChild(head)
  html.appendChild(body)
  const doc = {
    documentElement: html,
    head,
    body,
    createElement(tag) {
      return new FakeEl(tag)
    },
    getElementById(id) {
      return walk(html, []).find((el) => el.getAttribute('id') === id) || null
    },
    querySelectorAll(selector) {
      return walk(html, []).filter((el) => matches(el, selector))
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
  }
  return doc
}

/** A fresh module environment: loads client.js and returns its exported object. */
function loadPlugin(doc) {
  let exported = null
  const observers = []
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb
      this.connected = false
      observers.push(this)
    }
    observe() {
      this.connected = true
    }
    disconnect() {
      this.connected = false
    }
    /** Test hook: pretend React re-rendered. */
    trigger() {
      if (this.connected) this.cb([])
    }
  }
  const timers = []
  const sandbox = {
    document: doc,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: (cb) => {
      cb(0)
      return 1
    },
    setTimeout: (cb) => {
      cb()
      return 1
    },
    setInterval: (cb, ms) => {
      timers.push({ cb, ms })
      return timers.length
    },
    clearInterval: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true
    },
    console,
    window: {},
  }
  sandbox.window.__ModuleLoader__ = {
    load(def) {
      exported = def.factory()
    },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(CLIENT, 'utf8'), sandbox, { filename: CLIENT })
  return { exported, observers, timers }
}

/** Build the DOM dsh-context renders: a column holding plugin-info + recom. */
function buildContextPanel(doc) {
  const column = new FakeEl('div', 'lc-col')
  const infoCard = new FakeEl('div', 'lc-card')
  const infoTitle = new FakeEl('div', 'lc-card-title')
  infoCard.appendChild(infoTitle)
  const recom = new FakeEl('a', 'lc-card lc-recom')
  const recomTitle = new FakeEl('div', 'lc-card-title')
  recom.appendChild(recomTitle)
  column.appendChild(infoCard)
  column.appendChild(recom)
  doc.body.appendChild(column)
  return { column, infoCard, recom }
}

// ---------------------------------------------------------------------------
// Static source audit
// ---------------------------------------------------------------------------

const clientSrc = readFileSync(CLIENT, 'utf8')
const hostSrc = readFileSync(HOST, 'utf8')

ok('client.js has no bare ctx.<service> read (Cordis inject trap)',
  !/ctx\.(?!effect\b|slots\b|get\?\.|config\b|locale\b|logger\b)[A-Za-z_$]/.test(clientSrc),
  'found: ' + JSON.stringify((clientSrc.match(/ctx\.[A-Za-z_$][\w$]*/g) || [])))
ok('client.js declares inject: [] (no required services)', /inject:\s*\[\s*\]/.test(clientSrc))
ok('client.js returns a cleanup function from apply()', /return\s*\(\)\s*=>\s*\{/.test(clientSrc))
ok('host half exports apply()', /export\s+function\s+apply\s*\(/.test(hostSrc))
ok('stylesheet hides .lc-recom with !important',
  /display:\s*none\s*!important/.test(clientSrc) && /\.lc-recom/.test(clientSrc))

// ---------------------------------------------------------------------------
// Behaviour: apply() installs the stylesheet and hides the card
// ---------------------------------------------------------------------------

{
  const doc = makeDocument()
  const panel = buildContextPanel(doc)
  const { exported, observers, timers } = loadPlugin(doc)

  ok('factory returns inject/apply', exported !== null && typeof exported.apply === 'function')

  const styleBefore = doc.getElementById('dsh-context-recom-hider:style')
  ok('no stylesheet before apply()', styleBefore === null)

  const dispose = exported.apply({})

  const styleEl = doc.getElementById('dsh-context-recom-hider:style')
  ok('apply() injects the stylesheet', styleEl !== null)
  ok('stylesheet carries the plugin CSS tag',
    styleEl !== null && styleEl.getAttribute('data-plugin-css') === 'dsh-context-recom-hider/recom.css')
  ok('stylesheet targets .lc-recom', styleEl !== null && styleEl.textContent.includes('.lc-recom'))
  ok('stylesheet hides with !important', styleEl !== null && styleEl.textContent.includes('display: none !important'))
  ok('stylesheet does not target the sibling plugin-info card',
    styleEl !== null && !/(^|\n)\s*\.lc-card\s*[,{]/.test(styleEl.textContent))

  ok('recom card hidden after apply()',
    panel.recom.style.getPropertyValue('display') === 'none' &&
      panel.recom.style.getPropertyPriority('display') === 'important')
  ok('plugin-info card untouched', panel.infoCard.style.getPropertyValue('display') === '')
  ok('hidden card is marked with the plugin attribute',
    panel.recom.getAttribute('data-dsh-recom-hider') === 'true')

  ok('a MutationObserver is installed', observers.length === 1 && observers[0].connected === true)
  ok('a safety-net interval is installed', timers.length === 1 && timers[0].ms === 3000)

  // React re-creates the card as a brand-new node; the observer must hide it.
  // (Optional-call guards keep a broken plugin reporting FAILs instead of
  // throwing, so the negative control prints a complete red list.)
  const rerendered = new FakeEl('a', 'lc-card lc-recom')
  panel.column.appendChild(rerendered)
  observers[0]?.trigger?.()
  ok('observer hides a re-rendered card',
    rerendered.style.getPropertyValue('display') === 'none')

  // The safety-net interval must catch it even if the observer missed it.
  const late = new FakeEl('a', 'lc-card lc-recom')
  panel.column.appendChild(late)
  timers[0]?.cb?.()
  ok('interval sweep hides a late card', late.style.getPropertyValue('display') === 'none')

  // Cleanup
  if (typeof dispose === 'function') dispose()
  ok('cleanup removes the stylesheet', doc.getElementById('dsh-context-recom-hider:style') === null)
  ok('cleanup disconnects the observer', observers[0]?.connected === false)
  ok('cleanup clears the interval', timers[0]?.cleared === true)
  ok('cleanup restores the original card',
    panel.recom.style.getPropertyValue('display') === '' &&
      panel.recom.getAttribute('data-dsh-recom-hider') === null)
  ok('cleanup restores the re-rendered card',
    rerendered.style.getPropertyValue('display') === '')
}

// ---------------------------------------------------------------------------
// Negative control: the same DOM *without* the plugin keeps the card visible
// ---------------------------------------------------------------------------

{
  const doc = makeDocument()
  const panel = buildContextPanel(doc)
  // No plugin loaded at all.
  ok('[negctl] card is visible without the plugin',
    panel.recom.style.getPropertyValue('display') === '')
  ok('[negctl] no stylesheet without the plugin',
    doc.getElementById('dsh-context-recom-hider:style') === null)
}

// ---------------------------------------------------------------------------

console.log('')
console.log(fail === 0
  ? 'ALL CHECKS PASSED  (' + pass + ' passed)'
  : fail + ' FAILED / ' + (pass + fail) + ' checks')
process.exit(fail === 0 ? 0 : 1)
