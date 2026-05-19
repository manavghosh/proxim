import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { NavigationLoader } from '@/components/layout/NavigationLoader'

export const metadata: Metadata = {
  title: 'Proxim',
  description: 'Autonomous job hunting for senior IT professionals',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#060d1f] text-[#e2e8f0] antialiased">
        <NavigationLoader />
        {children}
      </body>
    </html>
  )
}
