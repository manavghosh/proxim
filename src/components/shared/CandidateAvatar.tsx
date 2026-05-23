import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const SIZE: Record<string, string> = {
  sm: 'h-5 w-5 text-[8px]',
  md: 'h-7 w-7 text-[10px]',
  lg: 'h-16 w-16 text-xl',
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface CandidateAvatarProps {
  name: string
  avatarData?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function CandidateAvatar({
  name,
  avatarData,
  size = 'md',
  className,
}: CandidateAvatarProps) {
  if (avatarData) {
    return (
      <Avatar className={cn(SIZE[size], className)}>
        <img
          src={avatarData}
          alt={name}
          className="aspect-square h-full w-full object-cover rounded-full"
        />
      </Avatar>
    )
  }

  return (
    <Avatar className={cn(SIZE[size], className)}>
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
