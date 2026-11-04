/**
 * dsh-context-recom-hider — client half.
 *
 * dsh-context draws a "感谢 / Thanks" recommendation card (`a.lc-card.lc-recom`)
 * at the top of its 上下文 tab. That card is rendered *inside* the tab's React
 * tree — it is not a slot occupant — so no other plugin can replace or unmount
 * it through `ctx.slots`, and dsh-context exposes no config switch for it.
 *
 * So this half never touches dsh-context's package: it only decorates the DOM.
 * A stylesheet it owns hides `.lc-recom`, and a MutationObserver re-asserts an
 * inline `display:none !important` on every card React re-creates, which covers
 * the case where dsh-context's own stylesheet wins on specificity.
 *
 * Everything is torn down in the cleanup returned from `apply`, so disabling the
 * bundle restores the card without a reinstall.
 */

const STYLE_ID = 'dsh-context-recom-hider:style'
const CSS_TAG = 'dsh-context-recom-hider/recom.css'
const HIDDEN_ATTR = 'data-dsh-recom-hider'
const RECOM_CLASS = 'lc-recom'
const SCAN_INTERVAL_MS = 3000

/** Only the recommendation card itself; never the sibling plugin-info card. */
const CSS = [
  '/* dsh-context "感谢 / Thanks" recommendation card — hidden by @local/dsh-context-recom-hider */',
  'a.lc-card.' + RECOM_CLASS + ',',
  '.' + RECOM_CLASS + ' {',
  '  display: none !important;',
  '  visibility: hidden !important;',
  '  height: 0 !important;',
  '  min-height: 0 !important;',
  '  margin: 0 !important;',
  '  padding: 0 !important;',
  '  border: 0 !important;',
  '  overflow: hidden !important;',
  '}',
  '',
].join('\n')

window.__ModuleLoader__.load({
  id: '@local/dsh-context-recom-hider',
  factory() {
    /** @type {MutationObserver | null} */
    let observer = null
    let scanTimer = null
    let disposed = false
    let styleEl = null

    function installStyle() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) {
        styleEl = existing
        return
      }
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.setAttribute('data-plugin-css', CSS_TAG)
      tag.textContent = CSS
      ;(document.head || document.documentElement).appendChild(tag)
      styleEl = tag
    }

    /** Force-hide one card and remember that we touched it. */
    function hideCard(el) {
      if (!el || el.nodeType !== 1) return
      if (el.getAttribute(HIDDEN_ATTR) === 'true') return
      el.setAttribute(HIDDEN_ATTR, 'true')
      if (el.style && typeof el.style.setProperty === 'function') {
        el.style.setProperty('display', 'none', 'important')
      }
    }

    /**
     * Sweep the current DOM. Cheap enough to run on every mutation batch: the
     * query is a single class selector and already-hidden nodes short-circuit.
     */
    function sweep() {
      if (disposed || typeof document === 'undefined') return
      const nodes = document.querySelectorAll('.' + RECOM_CLASS)
      for (const el of nodes) hideCard(el)
    }

    let pending = false
    function scheduleSweep() {
      if (disposed || pending) return
      pending = true
      const run = () => {
        pending = false
        sweep()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 0)
    }

    function startObserver() {
      if (typeof MutationObserver !== 'function') return
      observer = new MutationObserver(scheduleSweep)
      observer.observe(document.documentElement, { childList: true, subtree: true })
    }

    /** Undo every inline override we made, so disabling restores the card. */
    function restoreCards() {
      if (typeof document === 'undefined') return
      for (const el of document.querySelectorAll('[' + HIDDEN_ATTR + ']')) {
        el.removeAttribute(HIDDEN_ATTR)
        if (el.style && typeof el.style.removeProperty === 'function') {
          el.style.removeProperty('display')
        }
      }
    }

    function apply(ctx) {
      if (typeof document === 'undefined') return
      installStyle()
      sweep()
      startObserver()
      // Safety net for a re-render that swaps the card without a childList
      // change we can observe (or a page restored from the bfcache).
      scanTimer = setInterval(sweep, SCAN_INTERVAL_MS)

      return () => {
        disposed = true
        if (observer !== null) {
          observer.disconnect()
          observer = null
        }
        if (scanTimer !== null) {
          clearInterval(scanTimer)
          scanTimer = null
        }
        restoreCards()
        if (styleEl !== null && styleEl.parentNode !== null) {
          styleEl.parentNode.removeChild(styleEl)
        }
        styleEl = null
        void ctx
      }
    }

    return {
      // Pure DOM decoration: no service reads at all, so nothing can trip the
      // Cordis "cannot get property … without inject" trap.
      inject: [],
      apply,
      /** Exposed for the offline test harness only; nothing in DSH reads this. */
      internals: { STYLE_ID, CSS_TAG, CSS, HIDDEN_ATTR, RECOM_CLASS, sweep, restoreCards },
    }
  },
})
