import type { ReactNode } from 'react'
import { CandidateSidebar } from '@/components/layout/CandidateSidebar'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function CandidateLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [candidate] = await db
    .select({ id: candidates.id, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, id))
    .limit(1)

  const name = candidate?.name ?? 'Candidate'

  return (
    <div className="flex h-screen overflow-hidden">
      <CandidateSidebar candidateId={id} candidateName={name} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
