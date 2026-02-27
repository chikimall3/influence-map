import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase.js'
import './ArtistPanel.css'

const TRUST_CONFIG = {
  self_stated: { cls: 'trust-pill--self' },
  expert_db: { cls: 'trust-pill--expert' },
  wikidata: { cls: 'trust-pill--wikidata' },
  academic: { cls: 'trust-pill--academic' },
  community: { cls: 'trust-pill--community' },
}

const TRUST_DOT_COLORS = {
  self_stated: '#7da38d',
  expert_db: '#6a80aa',
  wikidata: '#d4a753',
  academic: '#4a5568',
  community: '#8a8880',
}

export default function ArtistPanel({ artist, onClose, onNavigate }) {
  const { t } = useTranslation()
  const [fullArtist, setFullArtist] = useState(null)
  const [influencers, setInfluencers] = useState([])
  const [influenced, setInfluenced] = useState([])
  const [sources, setSources] = useState([])
  const [loadingPanel, setLoadingPanel] = useState(false)

  useEffect(() => {
    if (!artist?.id) return

    setLoadingPanel(true)

    async function fetchDetails() {
      // Fetch full artist details + both influence directions in parallel
      const [artistRes, influencersRes, influencedRes] = await Promise.all([
        supabase
          .from('artists')
          .select('*')
          .eq('id', artist.id)
          .single(),
        supabase
          .from('influences')
          .select(`id, influence_type, trust_level, influencer:influencer_id (id, name, name_ja)`)
          .eq('influenced_id', artist.id),
        supabase
          .from('influences')
          .select(`id, influence_type, trust_level, influenced:influenced_id (id, name, name_ja)`)
          .eq('influencer_id', artist.id),
      ])

      if (artistRes.data) setFullArtist(artistRes.data)

      if (influencersRes.data) setInfluencers(influencersRes.data)
      if (influencedRes.data) setInfluenced(influencedRes.data)

      // Fetch sources for all influences
      const allInfluences = [
        ...(influencersRes.data || []),
        ...(influencedRes.data || []),
      ]
      if (allInfluences.length > 0) {
        const infIds = allInfluences.map((i) => i.id)
        const { data: srcData } = await supabase
          .from('sources')
          .select('*')
          .in('influence_id', infIds)

        if (srcData) setSources(srcData)
      }

      setLoadingPanel(false)
    }

    fetchDetails()
  }, [artist?.id])

  if (!artist) return null

  const a = fullArtist || artist

  // Collect unique trust levels
  const allInf = [...influencers, ...influenced]
  const trustLevels = [...new Set(allInf.map(i => i.trust_level || 'wikidata'))]

  const yearsText = a.birth_year
    ? a.death_year
      ? `${a.birth_year}–${a.death_year}`
      : `${a.birth_year}–`
    : null

  return (
    <aside className="artist-panel">
      <div className="panel-drag-handle" onClick={onClose}>
        <div className="drag-bar" />
      </div>
      <div className="panel-header">
        <div className="panel-avatar">
          {a.image_url ? (
            <img src={a.image_url} alt={a.name} />
          ) : (
            <span>{(a.name_ja || a.name)[0]}</span>
          )}
        </div>
        <div className="panel-info">
          <h2>{a.name_ja || a.name}</h2>
          {a.name_ja && <p className="panel-name-en">{a.name}</p>}
          {a.genres?.length > 0 && (
            <div className="panel-genres">
              {a.genres.map((g) => (
                <span key={g} className="genre-tag">{g}</span>
              ))}
            </div>
          )}
          {yearsText && (
            <p className="panel-years">{yearsText}</p>
          )}
          {(a.spotify_url || a.youtube_url || a.wikidata_id) && (
            <div className="panel-links">
              {a.spotify_url && (
                <a href={a.spotify_url} target="_blank" rel="noopener noreferrer" className="panel-ext-link" title="Spotify">
                  <span className="material-symbols-outlined">play_circle</span>
                </a>
              )}
              {a.youtube_url && (
                <a href={a.youtube_url} target="_blank" rel="noopener noreferrer" className="panel-ext-link" title="YouTube">
                  <span className="material-symbols-outlined">smart_display</span>
                </a>
              )}
              {a.wikidata_id && (
                <a href={`https://www.wikidata.org/wiki/${a.wikidata_id}`} target="_blank" rel="noopener noreferrer" className="panel-ext-link" title="Wikidata">
                  <span className="material-symbols-outlined">database</span>
                </a>
              )}
            </div>
          )}
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {trustLevels.length > 0 && (
        <div className="panel-badges">
          {trustLevels.map((level) => {
            const cfg = TRUST_CONFIG[level] || TRUST_CONFIG.wikidata
            return (
              <span key={level} className={`trust-pill ${cfg.cls}`}>
                <span className="diamond" />
                {t(`trust.${level}`)}
              </span>
            )
          })}
        </div>
      )}

      {loadingPanel && (
        <div className="panel-loading">
          <div className="panel-spinner" />
        </div>
      )}

      {influencers.length > 0 && (
        <div className="panel-section">
          <h3>{t('artist_panel.influences')} ({influencers.length})</h3>
          <ul className="influence-list">
            {influencers.map((inf) => {
              const trustKey = inf.trust_level || 'wikidata'
              const typeKey = inf.influence_type || 'musical'
              return (
                <li key={inf.id} className="influence-item">
                  <button
                    className="influence-link"
                    onClick={() => onNavigate?.(inf.influencer)}
                  >
                    <span className="influence-name">
                      {inf.influencer?.name_ja || inf.influencer?.name}
                    </span>
                    <span className="influence-meta">
                      <span className="influence-type-tag">
                        {t(`influence_type.${typeKey}`, typeKey)}
                      </span>
                      <span
                        className="influence-trust-dot"
                        style={{ background: TRUST_DOT_COLORS[trustKey] || '#8a8880' }}
                        title={t(`trust.${trustKey}`)}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {influenced.length > 0 && (
        <div className="panel-section">
          <h3>{t('artist_panel.influenced')} ({influenced.length})</h3>
          <ul className="influence-list">
            {influenced.map((inf) => {
              const trustKey = inf.trust_level || 'wikidata'
              const typeKey = inf.influence_type || 'musical'
              return (
                <li key={inf.id} className="influence-item">
                  <button
                    className="influence-link influenced-link"
                    onClick={() => onNavigate?.(inf.influenced)}
                  >
                    <span className="influence-name">
                      {inf.influenced?.name_ja || inf.influenced?.name}
                    </span>
                    <span className="influence-meta">
                      <span className="influence-type-tag">
                        {t(`influence_type.${typeKey}`, typeKey)}
                      </span>
                      <span
                        className="influence-trust-dot"
                        style={{ background: TRUST_DOT_COLORS[trustKey] || '#8a8880' }}
                        title={t(`trust.${trustKey}`)}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {sources.length > 0 && (
        <div className="panel-section">
          <h3>{t('artist_panel.sources')}</h3>
          <ul className="source-list">
            {sources.map((src) => (
              <li key={src.id}>
                {src.url ? (
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.title}
                    <span className="material-symbols-outlined" style={{ fontSize: 10, opacity: 0.5 }}>open_in_new</span>
                  </a>
                ) : (
                  <span>{src.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loadingPanel && influencers.length === 0 && influenced.length === 0 && (
        <div className="panel-empty">
          <span className="material-symbols-outlined">info</span>
          {t('artist_panel.no_data')}
        </div>
      )}
    </aside>
  )
}
