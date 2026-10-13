import { cn } from '@/lib/utils'
import { useTheme } from '@/themes'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Keep the in-app brand moments on the same source of truth as the native
// application icon. The padded PNG is intentional: it follows the platform
// icon grid and keeps the mascot at a consistent visual size in the titlebar,
// onboarding cards, and About panel.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  const { renderedMode } = useTheme()
  const dark = renderedMode === 'dark'

  return (
    <span
      className={cn('inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md', className)}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('apple-touch-icon.png')} />
    </span>
  )
}
