'use client'

import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MarkdownReportProps {
  content: string
  className?: string
}

// Lightweight renderer for the LLM-generated scoring report. The report uses a
// small, known subset of Markdown — `##` headings, GFM pipe tables (without
// outer pipes), `-` bullet lists, `**bold**`, and paragraphs — so we parse that
// subset directly rather than pulling in a full Markdown dependency.

// Split a single line into React nodes, rendering **bold** spans as <strong>.
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function splitRow(row: string): string[] {
  const cells = row.split('|').map((c) => c.trim())
  if (cells.length > 1 && cells[0] === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

// A separator row is the GFM table divider: only dashes, pipes, colons, spaces,
// and it must contain at least one dash.
function isSeparatorRow(line: string): boolean {
  return /-/.test(line) && /^[\s|:-]+$/.test(line)
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }

function parse(content: string): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') { i++; continue }

    // Heading: # .. ######
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    // Table: a `|` row immediately followed by a separator row.
    if (trimmed.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1].trim())) {
      const header = splitRow(trimmed)
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i].trim()))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // Bullet list: consecutive `- ` / `* ` lines.
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    // Paragraph: accumulate until a blank line or a structural line.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1].trim()))
    ) {
      para.push(lines[i].trim())
      i++
    }
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') })
  }

  return blocks
}

export function MarkdownReport({ content, className }: MarkdownReportProps) {
  const blocks = useMemo(() => parse(content ?? ''), [content])

  if (blocks.length === 0) return null

  return (
    <div className={cn('space-y-3 text-[11px] leading-relaxed text-muted-foreground', className)}>
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'heading': {
            // Map `##` → <h4> etc. so the card's own headings stay above these
            // in the document outline, while still exposing a real heading role.
            const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
            return (
              <Tag
                key={idx}
                className="text-[11px] font-semibold uppercase tracking-wider text-foreground first:mt-0"
              >
                {block.text}
              </Tag>
            )
          }
          case 'paragraph':
            return <p key={idx}>{renderInline(block.text)}</p>
          case 'list':
            return (
              <ul key={idx} className="list-disc space-y-1 pl-4">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            )
          case 'table':
            return (
              <div key={idx} className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {block.header.map((h, j) => (
                        <th
                          key={j}
                          className="border border-border px-2 py-1 text-left font-semibold text-foreground"
                        >
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="border border-border px-2 py-1 align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
