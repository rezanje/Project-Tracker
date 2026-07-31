import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/coming-soon')({
  component: ComingSoon,
})

function ComingSoon() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="panel p-10">
        <p className="text-[26px] font-extrabold tracking-[-0.03em]">Coming soon</p>
        <p className="mt-2 text-[14px] text-[var(--ink2)]">
          This screen is on the roadmap. Check back soon.
        </p>
      </div>
    </main>
  )
}
