import { useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

/** The comps' round back arrow, used by the screens with a centred title.
 *  Falls back to Home when there is nothing to go back to — a refresh or a
 *  shared link opens these screens cold, and browser-back would leave the app. */
export default function BackButton() {
  const router = useRouter()

  return (
    <button
      type="button"
      aria-label="Kembali"
      onClick={() => {
        if (window.history.length > 1) router.history.back()
        else router.navigate({ to: '/home' })
      }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:-translate-y-px active:scale-[.94]"
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
  )
}
