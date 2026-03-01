import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../shared/lib/supabase.js'
import './SearchBar.css'

const GENRE_OPTIONS = [
  'rock', 'jazz', 'classical', 'pop', 'blues', 'hip hop',
  'electronic', 'folk', 'r&b', 'punk', 'metal', 'country',
]

const ERA_OPTIONS = [
  { label: '〜1900', min: null, max: 1900 },
  { label: '1900–1950', min: 1900, max: 1950 },
  { label: '1950–1970', min: 1950, max: 1970 },
  { label: '1970–1990', min: 1970, max: 1990 },
  { label: '1990–2010', min: 1990, max: 2010 },
  { label: '2010–', min: 2010, max: null },
]

export default function SearchBar({ onSelect, compact = false }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState(null)
  const [selectedEra, setSelectedEra] = useState(null)
  const wrapperRef = useRef(null)

  const hasFilters = selectedGenre || selectedEra
  const hasQuery = query.length >= 2

  const doSearch = useCallback(async (q, genre, era) => {
    setSearching(true)

    let qb = supabase
      .from('artists')
      .select('id, name, name_ja, genres, birth_year')

    if (q && q.length >= 2) {
      const escaped = q.replace(/[%_\\]/g, c => '\\' + c)
      qb = qb.or(`name.ilike.%${escaped}%,name_ja.ilike.%${escaped}%`)
    }

    if (genre) {
      qb = qb.contains('genres', [genre])
    }

    if (era) {
      if (era.min != null) qb = qb.gte('birth_year', era.min)
      if (era.max != null) qb = qb.lt('birth_year', era.max)
    }

    qb = qb.limit(12)

    const { data, error } = await qb

    setSearching(false)
    if (!error && data) {
      setResults(data)
      setIsOpen(true)
      setNoResults(data.length === 0)
    }
  }, [])

  useEffect(() => {
    if (!hasQuery && !hasFilters) {
      setResults([])
      setIsOpen(false)
      setNoResults(false)
      return
    }

    const timer = setTimeout(() => {
      doSearch(query, selectedGenre, selectedEra)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, selectedGenre, selectedEra, hasQuery, hasFilters, doSearch])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false)
        setFiltersOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (artist) => {
    setQuery('')
    setIsOpen(false)
    setFiltersOpen(false)
    onSelect(artist)
  }

  const toggleGenre = (genre) => {
    setSelectedGenre(prev => prev === genre ? null : genre)
  }

  const toggleEra = (era) => {
    setSelectedEra(prev => prev === era ? null : era)
  }

  const clearFilters = () => {
    setSelectedGenre(null)
    setSelectedEra(null)
  }

  return (
    <div className={`search-wrapper ${compact ? 'compact' : ''}`} ref={wrapperRef} role="search">
      <div className="search-input-row">
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
        <button
          className={`filter-toggle ${hasFilters ? 'filter-active' : ''}`}
          onClick={() => setFiltersOpen(prev => !prev)}
          title="フィルタ"
          aria-label="フィルタ"
        >
          <span className="material-symbols-outlined">tune</span>
        </button>
      </div>

      {hasFilters && (
        <div className="active-filters">
          {selectedGenre && (
            <span className="filter-badge" onClick={() => setSelectedGenre(null)}>
              {selectedGenre} <span className="badge-x">&times;</span>
            </span>
          )}
          {selectedEra && (
            <span className="filter-badge" onClick={() => setSelectedEra(null)}>
              {selectedEra.label} <span className="badge-x">&times;</span>
            </span>
          )}
          <button className="filter-clear" onClick={clearFilters}>クリア</button>
        </div>
      )}

      {filtersOpen && (
        <div className="filter-panel">
          <div className="filter-section">
            <span className="filter-label">ジャンル</span>
            <div className="filter-chips">
              {GENRE_OPTIONS.map(g => (
                <button
                  key={g}
                  className={`filter-chip ${selectedGenre === g ? 'chip-active' : ''}`}
                  onClick={() => toggleGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-section">
            <span className="filter-label">年代</span>
            <div className="filter-chips">
              {ERA_OPTIONS.map(era => (
                <button
                  key={era.label}
                  className={`filter-chip ${selectedEra === era ? 'chip-active' : ''}`}
                  onClick={() => toggleEra(era)}
                >
                  {era.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isOpen && (
        <ul className="search-results" role="listbox">
          {noResults ? (
            <li className="search-no-results">
              <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.5 }}>search_off</span>
              {hasQuery ? t('search.no_results', { query }) : 'フィルタに一致するアーティストが見つかりません'}
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
                  <span className="result-meta">
                    {artist.birth_year && (
                      <span className="result-year">{artist.birth_year}</span>
                    )}
                    {artist.genres?.length > 0 && (
                      <span className="result-genre">{artist.genres[0]}</span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
