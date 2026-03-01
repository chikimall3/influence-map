import { useCallback, useRef, useState } from 'react'
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

export { MAX_CONNECTIONS }

export function useGraphData({ cyRef, onSelectArtist, onNodeCountChange, onLoadingChange, onError, applySemanticZoom, selectedNodeRef, filterLevelRef, isLayoutRunningRef, t }) {
  const loadedNodesRef = useRef(new Set())
  const connectionTotalsRef = useRef(new Map())
  const connectionLoadedRef = useRef(new Map())
  const [moreInfo, setMoreInfo] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

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
            `, { count: 'exact' })
            .eq('influenced_id', artistId)
            .limit(MAX_CONNECTIONS),
          supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influenced:influenced_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `, { count: 'exact' })
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

      // Track connection counts for load-more
      const influencersLoaded = influencersRes.data?.length || 0
      const influencedLoaded = influencedRes.data?.length || 0
      const influencersTotal = influencersRes.count ?? influencersLoaded
      const influencedTotal = influencedRes.count ?? influencedLoaded
      connectionTotalsRef.current.set(artistId, { influencers: influencersTotal, influenced: influencedTotal })
      connectionLoadedRef.current.set(artistId, { influencers: influencersLoaded, influenced: influencedLoaded })
      setMoreInfo({
        artistId,
        influencers: { loaded: influencersLoaded, total: influencersTotal },
        influenced: { loaded: influencedLoaded, total: influencedTotal },
      })

      if (newNodes.length > 0 || newEdges.length > 0) {
        cy.add([...newNodes, ...newEdges])
        const node = cy.getElementById(artistId)
        if (node.length) node.data('hasChildren', false)

        const layoutOpts = (skipLayoutAnim || isRoot) ? { ...LAYOUT_OPTIONS, animate: false } : LAYOUT_OPTIONS
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

  const loadMoreConnections = useCallback(async (artistId, direction) => {
    const cy = cyRef.current
    if (!cy) return

    const loaded = connectionLoadedRef.current.get(artistId)
    if (!loaded) return

    const currentOffset = direction === 'influencers' ? loaded.influencers : loaded.influenced
    const from = currentOffset
    const to = from + MAX_CONNECTIONS - 1

    setLoadingMore(true)

    try {
      const isInfluencers = direction === 'influencers'
      const { data, error: queryErr } = isInfluencers
        ? await supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influencer:influencer_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `)
            .eq('influenced_id', artistId)
            .range(from, to)
        : await supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influenced:influenced_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `)
            .eq('influencer_id', artistId)
            .range(from, to)

      if (queryErr || !data) {
        setLoadingMore(false)
        return
      }

      const newNodes = []
      const newEdges = []

      for (const inf of data) {
        const artist = isInfluencers ? inf.influencer : inf.influenced
        if (!artist) continue

        if (!cy.getElementById(artist.id).length) {
          newNodes.push({
            group: 'nodes',
            data: {
              id: artist.id,
              label: artist.name_ja || artist.name,
              name: artist.name,
              name_ja: artist.name_ja,
              genres: artist.genres,
              birth_year: artist.birth_year,
              image_url: artist.image_url,
              isRoot: false,
              hasChildren: !loadedNodesRef.current.has(artist.id),
              connectionCount: 1,
            },
          })
        }

        const edgeId = isInfluencers
          ? `${artist.id}->${artistId}`
          : `${artistId}->${artist.id}`

        if (!cy.getElementById(edgeId).length) {
          newEdges.push({
            group: 'edges',
            data: {
              id: edgeId,
              source: isInfluencers ? artist.id : artistId,
              target: isInfluencers ? artistId : artist.id,
              influence_type: inf.influence_type || 'musical',
              trust_level: inf.trust_level || 'wikidata',
            },
          })
        }
      }

      if (newNodes.length > 0 || newEdges.length > 0) {
        cy.add([...newNodes, ...newEdges])

        const layout = cy.layout({ ...LAYOUT_OPTIONS, animate: false })
        isLayoutRunningRef.current = true
        layout.on('layoutstop', () => {
          isLayoutRunningRef.current = false
          cy.nodes().forEach(n => n.data('connectionCount', n.degree()))
          onNodeCountChange(cy.nodes().length)
          if (selectedNodeRef.current) {
            applySemanticZoom(cy, selectedNodeRef.current, filterLevelRef.current, { fit: true })
          }
        })
        layout.run()
      }

      // Update loaded count
      const newLoaded = { ...loaded }
      newLoaded[direction] = currentOffset + data.length
      connectionLoadedRef.current.set(artistId, newLoaded)

      // Invalidate influence cache so re-select includes new data
      const infCacheKey = `influences:${artistId}`
      setCache(infCacheKey, null, 0)

      // Update moreInfo
      const totals = connectionTotalsRef.current.get(artistId)
      setMoreInfo({
        artistId,
        influencers: { loaded: newLoaded.influencers, total: totals.influencers },
        influenced: { loaded: newLoaded.influenced, total: totals.influenced },
      })
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }, [cyRef, applySemanticZoom, selectedNodeRef, filterLevelRef, isLayoutRunningRef, onNodeCountChange])

  const updateMoreInfo = useCallback((artistId) => {
    const totals = connectionTotalsRef.current.get(artistId)
    const loaded = connectionLoadedRef.current.get(artistId)
    if (totals && loaded) {
      setMoreInfo({
        artistId,
        influencers: { loaded: loaded.influencers, total: totals.influencers },
        influenced: { loaded: loaded.influenced, total: totals.influenced },
      })
    }
  }, [])

  const clearMoreInfo = useCallback(() => {
    setMoreInfo(null)
  }, [])

  const resetLoadedNodes = useCallback(() => {
    loadedNodesRef.current = new Set()
    connectionTotalsRef.current.clear()
    connectionLoadedRef.current.clear()
    setMoreInfo(null)
  }, [])

  return { loadArtistConnections, loadMoreConnections, resetLoadedNodes, moreInfo, loadingMore, updateMoreInfo, clearMoreInfo }
}
