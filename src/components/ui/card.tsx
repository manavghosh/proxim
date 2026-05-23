import * as React from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-[#0d1f3c] border border-[#1e2d4a] rounded-xl flex flex-col transition-colors hover:border-[#2d4a6e]',
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-header" className={cn('flex items-start gap-3 p-5 pb-0', className)} {...props} />
  )
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-content" className={cn('px-5', className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-footer" className={cn('px-5 pb-5', className)} {...props} />
  )
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 data-slot="card-title" className={cn('font-semibold text-[#f1f5f9] leading-tight', className)} {...props} />
  )
}

// Added for analytics components (F7)
function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p data-slot="card-description" className={cn('text-sm text-[#64748b]', className)} {...props} />
  )
}

export { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription }
