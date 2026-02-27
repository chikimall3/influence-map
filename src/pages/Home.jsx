import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase.js'
import SearchBar from '../components/SearchBar/SearchBar.jsx'
import './Home.css'

// Curated musician IDs for featured section (confirmed in DB)
const CURATED_MUSICIAN_IDS = [
  '515e6290-f7e0-443b-85a4-a7bceed6e261', // Bob Dylan
  '135d1a50-a43d-4be5-8f39-b200eab4da2a', // Jimi Hendrix
  '7c109fec-b8ae-4eff-89b4-3e03cd20120f', // David Bowie
  '3f34466a-43b5-49b2-96d4-5418cb41acc7', // John Coltrane
  '43b78ae0-7acb-4e9c-b34e-15aeefaaf700', // Beethoven
  '888d61c8-6608-4c2c-93c3-7f92689a92a2', // Elvis Presley
  '4d13b2f3-5bd1-46e7-9f8f-c952d25ee7bf', // Prince
  'fd15fced-d482-48e0-b048-562f7190feee', // Mozart
  '9bca8ba5-dc81-43dc-84b3-0d2e37368697', // Stevie Wonder
  '345cfc49-6837-4def-b131-c2f51425c379', // James Brown
]

const FALLBACK_ARTISTS = [
  { id: '515e6290-f7e0-443b-85a4-a7bceed6e261', name: 'Bob Dylan', name_ja: 'ボブ・ディラン' },
  { id: '135d1a50-a43d-4be5-8f39-b200eab4da2a', name: 'Jimi Hendrix', name_ja: 'ジミ・ヘンドリックス' },
  { id: '7c109fec-b8ae-4eff-89b4-3e03cd20120f', name: 'David Bowie', name_ja: 'デヴィッド・ボウイ' },
  { id: '3f34466a-43b5-49b2-96d4-5418cb41acc7', name: 'John Coltrane', name_ja: 'ジョン・コルトレーン' },
  { id: '43b78ae0-7acb-4e9c-b34e-15aeefaaf700', name: 'Ludwig van Beethoven', name_ja: 'ベートーヴェン' },
  { id: '888d61c8-6608-4c2c-93c3-7f92689a92a2', name: 'Elvis Presley', name_ja: 'エルヴィス・プレスリー' },
]

export default function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [featured, setFeatured] = useState(FALLBACK_ARTISTS)

  useEffect(() => {
    async function fetchFeatured() {
      // Fetch curated musicians from DB
      const { data: artists } = await supabase
        .from('artists')
        .select('id, name, name_ja, image_url')
        .in('id', CURATED_MUSICIAN_IDS)

      if (artists && artists.length >= 6) {
        // Shuffle and pick 6
        const shuffled = artists.sort(() => Math.random() - 0.5).slice(0, 6)
        setFeatured(shuffled)
      }
    }
    fetchFeatured()
  }, [])

  const handleSelectArtist = (artist) => {
    navigate(`/artist/${artist.id}`)
  }

  return (
    <div className="home">
      <div className="home-hero">
        <span className="material-symbols-outlined home-icon">history_edu</span>
        <h1 className="home-title">{t('app.title')}</h1>
        <p className="home-subtitle">
          {t('home.subtitle')}
        </p>
        <SearchBar onSelect={handleSelectArtist} />
      </div>

      <div className="home-featured">
        <h2 className="home-featured-title">{t('home.featured_title')}</h2>
        <div className="home-featured-grid">
          {featured.map((artist) => (
            <button
              key={artist.id}
              className="featured-card"
              onClick={() => handleSelectArtist(artist)}
            >
              <div className="featured-avatar">
                {artist.image_url ? (
                  <img src={artist.image_url} alt={artist.name} />
                ) : (
                  artist.name_ja?.[0] || artist.name[0]
                )}
              </div>
              <span className="featured-name">{artist.name_ja || artist.name}</span>
              <span className="featured-name-en">{artist.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
