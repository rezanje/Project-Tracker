import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/coming-soon')({
  component: ComingSoon,
})

function ComingSoon() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="card p-8">
        <p className="display-title text-2xl font-bold">Coming Soon</p>
        <p className="mt-2 text-sm text-[var(--ink2)]">
          This screen is on the roadmap. Check back soon.
        </p>
      </div>
    </main>
  )
}
