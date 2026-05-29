'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'

/** Discoverable trigger for the global ⌘K command palette. */
export function CommandMenuHint() {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent))
  }, [])

  function openPalette() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true })
    )
  }

  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Open command menu"
      className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Search className="size-3.5" />
      <span>Search</span>
      <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {isMac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  )
}
