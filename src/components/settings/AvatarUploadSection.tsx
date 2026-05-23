'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'
import { updateCandidateAvatar } from '@/lib/api'

interface Props {
  candidateId: string
  candidateName: string
  avatarData: string | null
  onAvatarChange: (avatarData: string | null) => void
}

export function AvatarUploadSection({ candidateId, candidateName, avatarData, onAvatarChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [removing, setRemoving] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const SIZE = 128
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')!

      // Center-crop to square
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
      URL.revokeObjectURL(url)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      onAvatarChange(dataUrl)
      void updateCandidateAvatar(candidateId, dataUrl)
    }
    img.src = url
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      await updateCandidateAvatar(candidateId, null)
      onAvatarChange(null)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <CandidateAvatar name={candidateName} avatarData={avatarData} size="lg" className="rounded-xl flex-shrink-0" />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
            onClick={() => inputRef.current?.click()}
          >
            Upload photo
          </Button>
          {avatarData && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-[#475569] hover:text-destructive"
              onClick={handleRemove}
              isLoading={removing}
            >
              Remove
            </Button>
          )}
        </div>
        <p className="text-[10px] text-[#475569]">JPG, PNG or GIF · will be cropped to square</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
