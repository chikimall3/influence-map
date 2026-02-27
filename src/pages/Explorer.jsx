import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SearchBar from '../components/SearchBar/SearchBar.jsx'
import GraphView from '../components/GraphView/GraphView.jsx'
import ArtistPanel from '../components/ArtistPanel/ArtistPanel.jsx'
import { useState, useEffect } from 'react'

const ONBOARDING_KEY = 'influence-map-onboarded'

export default function Explorer() {
  const { artistId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [selectedArtist, setSelectedArtist] = useState(null)
  const [showShareToast, setShowShareToast] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setShowOnboarding(true)
    }
  }, [])

  const handleSelectArtist = (artist) => {
    navigate(`/artist/${artist.id}`)
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      // fallback
      const input = document.createElement('input')
      input.value = window.location.href
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setShowShareToast(true)
    setTimeout(() => setShowShareToast(false), 2000)
  }

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1')
    setShowOnboarding(false)
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
        <button className="share-btn" onClick={handleShare} title={t('share.button')} aria-label={t('share.button')}>
          <span className="material-symbols-outlined">share</span>
        </button>
      </header>

      {showShareToast && (
        <div className="share-toast">{t('share.copied')}</div>
      )}

      {showOnboarding && (
        <div className="onboarding-overlay" onClick={dismissOnboarding}>
          <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
            <h2>{t('onboarding.title')}</h2>
            <ul className="onboarding-tips">
              <li>
                <span className="material-symbols-outlined">touch_app</span>
                {t('onboarding.tip1')}
              </li>
              <li>
                <span className="material-symbols-outlined">swap_vert</span>
                {t('onboarding.tip2')}
              </li>
              <li>
                <span className="material-symbols-outlined">back_hand</span>
                {t('onboarding.tip3')}
              </li>
            </ul>
            <button className="onboarding-dismiss" onClick={dismissOnboarding}>
              {t('onboarding.dismiss')}
            </button>
          </div>
        </div>
      )}

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
