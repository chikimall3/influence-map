import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase.js'
import './SearchBar.css'

export default function SearchBar({ onSelect, compact = false }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      setIsOpen(false)
      setNoResults(false)
      return
    }

    setSearching(true)
    const timer = setTimeout(async () => {
      // Escape special characters for ilike pattern matching
      const escaped = query.replace(/[%_\\]/g, c => '\\' + c)
      const { data, error } = await supabase
        .from('artists')
        .select('id, name, name_ja, genres')
        .or(`name.ilike.%${escaped}%,name_ja.ilike.%${escaped}%`)
        .limit(8)

      setSearching(false)
      if (!error && data) {
        setResults(data)
        setIsOpen(true)
        setNoResults(data.length === 0)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (artist) => {
    setQuery('')
    setIsOpen(false)
    onSelect(artist)
  }

  return (
    <div className={`search-wrapper ${compact ? 'compact' : ''}`} ref={wrapperRef} role="search">
      <span className="material-symbols-outlined search-icon" aria-hidden="true">search</span>
      <input
        type="text"
        className="search-input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {searching && <span className="search-spinner" aria-label="Searching..." />}
      {isOpen && (
        <ul className="search-results" role="listbox">
          {noResults ? (
            <li className="search-no-results">
              <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.5 }}>search_off</span>
              {t('search.no_results', { query })}
            </li>
          ) : (
            results.map((artist) => (
              <li key={artist.id}>
                <button
                  className="search-result-item"
                  onClick={() => handleSelect(artist)}
                >
                  <span className="result-name">
                    {artist.name_ja || artist.name}
                  </span>
                  {artist.name_ja && (
                    <span className="result-name-en">{artist.name}</span>
                  )}
                  {artist.genres?.length > 0 && (
                    <span className="result-genre">{artist.genres[0]}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
