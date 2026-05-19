'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * NProgress-style top loading bar for Next.js App Router.
 * Starts on any internal link click, completes when the pathname changes.
 */
export function NavigationLoader() {
  const pathname = usePathname()
  const [visible, setVisible]   = useState(false)
  const [width,   setWidth]     = useState(0)
  const timerRef  = useRef<NodeJS.Timeout | null>(null)
  const prevPath  = useRef(pathname)

  // Navigation completed → jump to 100% then fade out
  useEffect(() => {
    if (pathname === prevPath.current) return
    prevPath.current = pathname
    setWidth(100)
    timerRef.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 250)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [pathname])

  // Capture internal link clicks → start the bar
  useEffect(() => {
    function onLinkClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return
      if (timerRef.current) clearTimeout(timerRef.current)
      setVisible(true)
      setWidth(15)
      timerRef.current = setTimeout(() => setWidth(55), 180)
      timerRef.current = setTimeout(() => setWidth(75), 600)
    }
    document.addEventListener('click', onLinkClick)
    return () => document.removeEventListener('click', onLinkClick)
  }, [])

  if (!visible) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none">
      <div
        className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.7)]"
        style={{
          width: `${width}%`,
          transition: width === 100
            ? 'width 150ms ease-out'
            : 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  )
}
