import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import Footer from '../components/Footer'
import Header from '../components/Header'
import MobileNav from '../components/MobileNav'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'light';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

// `user-scalable=no` plus `touch-action` (see styles.css) is enough for Chrome
// and Android, but iOS Safari has ignored the meta tag since iOS 10 and treats
// pinch as a browser-level gesture that never reaches touch-action. The only
// lever left there is the non-standard `gesture*` events, with a two-finger
// touchmove guard for the in-page pinches Safari does route through the DOM.
// Double-tap zoom is handled purely by touch-action — swallowing `touchend`
// would also swallow the synthetic click and break fast repeat taps.
const NO_ZOOM_SCRIPT = `(function(){try{var stop=function(e){e.preventDefault()};['gesturestart','gesturechange','gestureend'].forEach(function(t){document.addEventListener(t,stop,{passive:false})});document.addEventListener('touchmove',function(e){if(e.touches&&e.touches.length>1){e.preventDefault()}},{passive:false});}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
      },
      {
        title: 'Rakit',
      },
      // Installed to the home screen, Rakit should run chromeless like an app.
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Rakit' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      // Was shipped in /public but never referenced, so "add to home screen"
      // fell back to a bookmark instead of a standalone window.
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'apple-touch-icon', href: '/logo192.png' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  // Auth screens are full-bleed with their own brand mark — skip the app chrome.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const bare = ['/login', '/signup', '/forgot', '/reset'].includes(pathname)
  // A board detail page has its own back-link and title right below the
  // header, so the workspace pill, greeting and search there would only
  // repeat where the user just came from.
  const minimalHeader = pathname.startsWith('/board/')
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: NO_ZOOM_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="flex min-h-screen font-sans antialiased [overflow-wrap:anywhere] selection:bg-[var(--accent-soft)]">
        {!bare && <Sidebar />}
        {/* Mobile nav floats above the content, so leave room for the bar + FAB. */}
        <div className={`flex min-w-0 flex-1 flex-col ${!bare ? 'pb-28 md:pb-0' : ''}`}>
          {!bare && <Header minimal={minimalHeader} />}
          {children}
          {!bare && <Footer />}
        </div>
        {!bare && <MobileNav />}
        <Toast />
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
