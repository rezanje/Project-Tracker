import { createFileRoute, redirect } from '@tanstack/react-router'

// `/` used to be the Command Center. It isn't a place of its own any more: the
// account level is what Home shows when the scope is "Semua workspace", so the
// root just hands over. Kept as a route so old links, the sidebar logo and the
// post-login landing all still resolve.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/home' })
  },
})
