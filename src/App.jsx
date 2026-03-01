import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Home from './pages/Home.jsx'
import './App.css'

const Explorer = lazy(() => import('./pages/Explorer.jsx'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="page-loading"><div className="page-spinner" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/artist/:artistId" element={<Explorer />} />
        </Routes>
      </Suspense>
    </QueryClientProvider>
  )
}

export default App
