import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import './App.css'

const Explorer = lazy(() => import('./pages/Explorer.jsx'))

function App() {
  return (
    <Suspense fallback={<div className="page-loading"><div className="page-spinner" /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/artist/:artistId" element={<Explorer />} />
      </Routes>
    </Suspense>
  )
}

export default App
