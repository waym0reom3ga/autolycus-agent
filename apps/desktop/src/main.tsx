import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import App from './app'
import { HapticsProvider } from './components/haptics-provider'
import { installClipboardShim } from './lib/clipboard'
import { ThemeProvider } from './themes/context'

installClipboardShim()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HapticsProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </HapticsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
