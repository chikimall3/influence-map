import { useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { getCached, setCache } from '../../lib/cache.js'

const MAX_CONNECTIONS = 15
const LAYOUT_OPTIONS = {
  name: 'dagre',
  rankDir: 'TB',
  nodeSep: 60,
  rankSep: 80,
  animate: true,
  animationDuration: 400,
}

export function useGraphData({ cyRef, onSelectArtist, onNodeCountChange, onLoadingChange, onError, applySemanticZoom, selectedNodeRef, filterLevelRef, isLayoutRunningRef, t }) {
  const loadedNodesRef = useRef(new Set())

  const addArtistNode = useCallback((cy, artist, isRoot) => {
    if (cy.getElementById(artist.id).length) return
    cy.add({
      group: 'nodes',
      data: {
        id: artist.id,
        label: artist.name_ja || artist.name,
        name: artist.name,
        name_ja: artist.name_ja,
        genres: artist.genres,
        birth_year: artist.birth_year,
        image_url: artist.image_url,
        isRoot,
        hasChildren: !loadedNodesRef.current.has(artist.id),
        connectionCount: 1,
      },
    })
  }, [])

  const loadArtistConnections = useCallback(async (artistId, { isRoot = false, skipLayoutAnim = false } = {}) => {
    if (loadedNodesRef.current.has(artistId)) return
    loadedNodesRef.current.add(artistId)

    if (isRoot) onLoadingChange(true)

    try {
      const cacheKey = `artist:${artistId}`
      let artist = getCached(cacheKey)
      if (!artist) {
        const { data, error: artistErr } = await supabase
          .from('artists')
          .select('*')
          .eq('id', artistId)
          .single()
        if (artistErr || !data) {
          if (isRoot) onError(t('graph.error_not_found'))
          return
        }
        artist = data
        setCache(cacheKey, artist)
      }

      const cy = cyRef.current
      if (!cy) return

      addArtistNode(cy, artist, isRoot)

      const infCacheKey = `influences:${artistId}`
      let cached = getCached(infCacheKey)
      let influencersRes, influencedRes
      if (cached) {
        influencersRes = cached.influencersRes
        influencedRes = cached.influencedRes
      } else {
        ;[influencersRes, influencedRes] = await Promise.all([
          supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influencer:influencer_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `)
            .eq('influenced_id', artistId)
            .limit(MAX_CONNECTIONS),
          supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influenced:influenced_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `)
            .eq('influencer_id', artistId)
            .limit(MAX_CONNECTIONS),
        ])
        setCache(infCacheKey, { influencersRes, influencedRes })
      }

      const newNodes = []
      const newEdges = []

      if (influencersRes.data) {
        for (const inf of influencersRes.data) {
          const influencer = inf.influencer
          if (!influencer) continue
          if (!cy.getElementById(influencer.id).length) {
            newNodes.push({
              group: 'nodes',
              data: {
                id: influencer.id,
                label: influencer.name_ja || influencer.name,
                name: influencer.name,
                name_ja: influencer.name_ja,
                genres: influencer.genres,
                birth_year: influencer.birth_year,
                image_url: influencer.image_url,
                isRoot: false,
                hasChildren: !loadedNodesRef.current.has(influencer.id),
                connectionCount: 1,
              },
            })
          }
          const edgeId = `${influencer.id}->${artistId}`
          if (!cy.getElementById(edgeId).length) {
            newEdges.push({
              group: 'edges',
              data: { id: edgeId, source: influencer.id, target: artistId, influence_type: inf.influence_type || 'musical', trust_level: inf.trust_level || 'wikidata' },
            })
          }
        }
      }

      if (influencedRes.data) {
        for (const inf of influencedRes.data) {
          const influenced = inf.influenced
          if (!influenced) continue
          if (!cy.getElementById(influenced.id).length) {
            newNodes.push({
              group: 'nodes',
              data: {
                id: influenced.id,
                label: influenced.name_ja || influenced.name,
                name: influenced.name,
                name_ja: influenced.name_ja,
                genres: influenced.genres,
                birth_year: influenced.birth_year,
                image_url: influenced.image_url,
                isRoot: false,
                hasChildren: !loadedNodesRef.current.has(influenced.id),
                connectionCount: 1,
              },
            })
          }
          const edgeId = `${artistId}->${influenced.id}`
          if (!cy.getElementById(edgeId).length) {
            newEdges.push({
              group: 'edges',
              data: { id: edgeId, source: artistId, target: influenced.id, influence_type: inf.influence_type || 'musical', trust_level: inf.trust_level || 'wikidata' },
            })
          }
        }
      }

      if (newNodes.length > 0 || newEdges.length > 0) {
        cy.add([...newNodes, ...newEdges])
        const node = cy.getElementById(artistId)
        if (node.length) node.data('hasChildren', false)

        const layoutOpts = skipLayoutAnim ? { ...LAYOUT_OPTIONS, animate: false } : LAYOUT_OPTIONS
        const layout = cy.layout(layoutOpts)
        isLayoutRunningRef.current = true
        layout.on('layoutstop', () => {
          isLayoutRunningRef.current = false
          cy.nodes().forEach(n => n.data('connectionCount', n.degree()))
          onNodeCountChange(cy.nodes().length)
          if (isRoot) cy.fit(undefined, 40)
          if (selectedNodeRef.current) {
            applySemanticZoom(cy, selectedNodeRef.current, filterLevelRef.current, { fit: true })
          }
        })
        layout.run()
      }

      if (isRoot) {
        onLoadingChange(false)
        onSelectArtist?.({
          id: artist.id, name: artist.name, name_ja: artist.name_ja,
          genres: artist.genres, birth_year: artist.birth_year, death_year: artist.death_year,
          image_url: artist.image_url, spotify_url: artist.spotify_url,
          youtube_url: artist.youtube_url, wikidata_id: artist.wikidata_id,
        })
      }
    } catch (err) {
      if (isRoot) onError(t('graph.error_load_failed'))
      onLoadingChange(false)
    }
  }, [cyRef, onSelectArtist, addArtistNode, applySemanticZoom, selectedNodeRef, filterLevelRef, isLayoutRunningRef, onNodeCountChange, onLoadingChange, onError, t])

  const resetLoadedNodes = useCallback(() => {
    loadedNodesRef.current = new Set()
  }, [])

  return { loadArtistConnections, resetLoadedNodes }
}
