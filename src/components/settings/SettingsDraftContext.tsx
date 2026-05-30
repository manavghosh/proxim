'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Draft / dirty layer that powers the single "unsaved changes" save bar.
 *
 * Savable sections (CV markdown, Job Preferences, Outreach mode, Resume
 * attachment) register a `save()` callback and report their own dirty state via
 * `useRegisterSection`. The SaveBar (settings layout) and the wizard footer read
 * the aggregate `anyDirty` / `saveAll` / `discardAll` controls.
 *
 * Discard and post-save reset are implemented by bumping `version`, which callers
 * use as a React `key` on the section wrapper to remount sections from fresh
 * (server) props — dropping in-flight edits and clearing dirty baselines.
 */
export interface SettingsDraftContextValue {
  // ── section registration ──
  setDirty: (id: string, dirty: boolean) => void
  registerSaver: (id: string, save: () => Promise<void>) => void
  unregister: (id: string) => void
  // ── controls (consumed by SaveBar / wizard footer) ──
  anyDirty: boolean
  saving: boolean
  saveAll: () => Promise<boolean>
  discardAll: () => void
  version: number
}

const noop = () => {}

const SettingsDraftContext = createContext<SettingsDraftContextValue>({
  setDirty: noop,
  registerSaver: noop,
  unregister: noop,
  anyDirty: false,
  saving: false,
  saveAll: async () => true,
  discardAll: noop,
  version: 0,
})

export function useSettingsDraft(): SettingsDraftContextValue {
  return useContext(SettingsDraftContext)
}

/**
 * Register a savable section. `dirty` is tracked reactively; `save` is invoked by
 * `saveAll` only when the section is dirty. The latest `save` closure is always
 * used (stored in a ref) so registration stays stable across renders.
 */
export function useRegisterSection(
  id: string,
  dirty: boolean,
  save: () => Promise<void>,
): void {
  const ctx = useContext(SettingsDraftContext)
  const saveRef = useRef(save)
  saveRef.current = save

  const { setDirty, registerSaver, unregister } = ctx

  useEffect(() => {
    setDirty(id, dirty)
  }, [id, dirty, setDirty])

  useEffect(() => {
    registerSaver(id, () => saveRef.current())
    return () => unregister(id)
  }, [id, registerSaver, unregister])
}

interface ProviderProps {
  /** Called after a successful saveAll so the parent can refresh server state. */
  onSaved?: () => void | Promise<void>
  children: ReactNode | ((ctx: SettingsDraftContextValue) => ReactNode)
}

export function SettingsDraftProvider({ onSaved, children }: ProviderProps) {
  const [dirty, setDirtyState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState(0)
  const savers = useRef<Map<string, () => Promise<void>>>(new Map())

  const setDirty = useCallback((id: string, d: boolean) => {
    setDirtyState((prev) => (prev[id] === d ? prev : { ...prev, [id]: d }))
  }, [])

  const registerSaver = useCallback((id: string, save: () => Promise<void>) => {
    savers.current.set(id, save)
  }, [])

  const unregister = useCallback((id: string) => {
    savers.current.delete(id)
    setDirtyState((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const anyDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty])

  const saveAll = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    try {
      for (const [id, save] of savers.current) {
        if (dirty[id]) await save()
      }
      await onSaved?.()
      setDirtyState({})
      setVersion((v) => v + 1)
      return true
    } catch {
      // Section save callbacks surface their own field-level errors; the bar/
      // wizard just needs to know it failed.
      return false
    } finally {
      setSaving(false)
    }
  }, [dirty, onSaved])

  const discardAll = useCallback(() => {
    setDirtyState({})
    setVersion((v) => v + 1)
  }, [])

  const value = useMemo<SettingsDraftContextValue>(
    () => ({
      setDirty,
      registerSaver,
      unregister,
      anyDirty,
      saving,
      saveAll,
      discardAll,
      version,
    }),
    [setDirty, registerSaver, unregister, anyDirty, saving, saveAll, discardAll, version],
  )

  return (
    <SettingsDraftContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </SettingsDraftContext.Provider>
  )
}
