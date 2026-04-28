import type { PipelineReadiness } from '@/types/candidate'

interface PipelineReadinessIndicatorProps {
  readiness: PipelineReadiness
}

export function PipelineReadinessIndicator({
  readiness,
}: PipelineReadinessIndicatorProps) {
  if (readiness.ready) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-green-800">
          Pipeline ready to run
        </span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="text-sm font-medium text-amber-800">Pipeline not ready</span>
      </div>
      <ul className="ml-4 space-y-0.5">
        {readiness.missing.map((item) => (
          <li key={item} className="text-xs text-amber-700">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
