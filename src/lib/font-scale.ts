export type FontScale = 'small' | 'normal' | 'large' | 'xlarge'

const SCALES: Record<FontScale, number> = { small: 0.9, normal: 1, large: 1.15, xlarge: 1.3 }
let currentScale = 1
let observer: MutationObserver | null = null

function hasDirectText(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))
}

function apply(el: HTMLElement) {
  if (!(el instanceof HTMLElement) || el.closest('svg')) return
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  if (!isField && !hasDirectText(el)) return
  let base = Number(el.dataset.fontBase || 0)
  if (!base) {
    const computed = Number.parseFloat(getComputedStyle(el).fontSize)
    if (!Number.isFinite(computed) || computed <= 0) return
    const parent = el.parentElement
    const parentBase = Number(parent?.dataset.fontBase || 0)
    const parentComputed = parent ? Number.parseFloat(getComputedStyle(parent).fontSize) : 0
    // If the new node inherits its size from an already-scaled parent, reuse the parent's base.
    base = parentBase > 0 && parentComputed > 0 && Math.abs(computed - parentComputed) < 0.2 ? parentBase : computed
    el.dataset.fontBase = String(base)
  }
  el.style.fontSize = `${Math.round(base * currentScale * 100) / 100}px`
}

function applyTree(root: HTMLElement) {
  apply(root)
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,b,strong,em,small,label,td,th,button,input,select,textarea,div').forEach(apply)
}

/** Scale actual computed font sizes. Unlike page zoom, this changes getComputedStyle(...).fontSize. */
export function installFontScale(scale: FontScale) {
  currentScale = SCALES[scale]
  const root = document.querySelector<HTMLElement>('.etf-page, .app-shell')
  if (!root) return
  observer?.disconnect()
  applyTree(root)
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) applyTree(node)
      })
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  document.documentElement.dataset.fontSize = scale
}
