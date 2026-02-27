import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SearchBar from '../components/SearchBar/SearchBar.jsx'
import GraphView from '../components/GraphView/GraphView.jsx'
import ArtistPanel from '../components/ArtistPanel/ArtistPanel.jsx'
import { useState } from 'react'

export default function Explorer() {
  const { artistId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [selectedArtist, setSelectedArtist] = useState(null)

  const handleSelectArtist = (artist) => {
    navigate(`/artist/${artist.id}`)
  }

  return (
    <div className="explorer-page">
      <header className="app-header">
        <button className="home-btn" onClick={() => navigate('/')} aria-label="ホームに戻る">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span className="material-symbols-outlined">history_edu</span>
          {t('app.title')}
        </h1>
        <SearchBar onSelect={handleSelectArtist} compact />
      </header>

      <div className="explorer-layout">
        <div className="graph-container">
          <GraphView
            rootArtistId={artistId}
            onSelectArtist={setSelectedArtist}
          />
        </div>

        {selectedArtist && (
          <ArtistPanel
            artist={selectedArtist}
            onClose={() => setSelectedArtist(null)}
            onNavigate={handleSelectArtist}
          />
        )}
      </div>
    </div>
  )
}
