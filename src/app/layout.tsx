import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Proxim',
  description: 'Autonomous job hunting for senior IT professionals',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#060d1f] text-[#e2e8f0] antialiased">
        {children}
      </body>
    </html>
  )
}
