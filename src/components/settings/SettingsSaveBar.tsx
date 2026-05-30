'use client'

import { useSettingsDraft } from '@/components/settings/SettingsDraftContext'
import { Button } from '@/components/ui/button'

/**
 * Single sticky "unsaved changes" bar. Renders only when a savable section is
 * dirty, replacing the per-section save buttons. Must be rendered inside a
 * SettingsDraftProvider.
 */
export function SettingsSaveBar() {
  const { anyDirty, saving, saveAll, discardAll } = useSettingsDraft()

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 transition-all duration-300 ${
        anyDirty ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
      }`}
      aria-hidden={!anyDirty}
    >
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-4 rounded-xl border border-border-strong bg-card px-5 py-3 shadow-2xl">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          You have unsaved changes
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={discardAll}
            disabled={saving}
          >
            Discard
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={() => { void saveAll() }}
            isLoading={saving}
            data-testid="settings-save-all"
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
