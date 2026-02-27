import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { supabase } from '../../lib/supabase.js'
import { graphStyles } from './graph-styles.js'
import './GraphView.css'

cytoscape.use(dagre)

const LAYOUT_OPTIONS = {
  name: 'dagre',
  rankDir: 'TB',
  nodeSep: 60,
  rankSep: 80,
  animate: true,
  animationDuration: 400,
}

// filterLevel 0.0–1.0 → visible neighbor count
function getVisibleCount(filterLevel) {
  if (filterLevel < 0.2) return 3
  if (filterLevel < 0.4) return 5
  if (filterLevel < 0.6) return 10
  if (filterLevel < 0.8) return 20
  return Infinity
}

const FILTER_STEP = 0.15
const SZ_CLASSES = 'sz-focus sz-neighbor sz-dimmed sz-hidden sz-visible-edge'

export default function GraphView({ rootArtistId, onSelectArtist }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const loadedNodesRef = useRef(new Set())
  const selectedNodeRef = useRef(null)
  const filterLevelRef = useRef(0.5)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [semanticZoomActive, setSemanticZoomActive] = useState(false)
  const [filterLevel, setFilterLevel] = useState(0.5)

  const applySemanticZoom = useCallback((cy, selectedId, level) => {
    if (!cy || !selectedId) return

    const selectedNode = cy.getElementById(selectedId)
    if (!selectedNode.length) return

    const maxVisible = getVisibleCount(level != null ? level : filterLevelRef.current)
    const neighborhood = selectedNode.neighborhood().nodes()

    const sorted = neighborhood.toArray().sort((a, b) =>
      (b.data('connectionCount') || b.degree()) - (a.data('connectionCount') || a.degree())
    )

    const visibleNeighborIds = new Set(sorted.slice(0, maxVisible).map(n => n.id()))
    const hiddenNeighborIds = new Set(sorted.slice(maxVisible).map(n => n.id()))
    const fullyVisible = new Set([selectedId, ...visibleNeighborIds])

    cy.batch(() => {
      cy.elements().removeClass(SZ_CLASSES)

      selectedNode.addClass('sz-focus')

      cy.nodes().forEach(node => {
        const id = node.id()
        if (id === selectedId) return
        if (visibleNeighborIds.has(id)) {
          node.addClass('sz-neighbor')
        } else if (hiddenNeighborIds.has(id)) {
          node.addClass('sz-hidden')
        } else {
          node.addClass('sz-dimmed')
        }
      })

      cy.edges().forEach(edge => {
        const srcId = edge.source().id()
        const tgtId = edge.target().id()

        if (hiddenNeighborIds.has(srcId) || hiddenNeighborIds.has(tgtId)) {
          edge.addClass('sz-hidden')
        } else if (fullyVisible.has(srcId) && fullyVisible.has(tgtId)) {
          edge.addClass('sz-visible-edge')
        } else {
          edge.addClass('sz-dimmed')
        }
      })
    })
  }, [])

  const clearSemanticZoom = useCallback((cy) => {
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass(SZ_CLASSES)
    })
    selectedNodeRef.current = null
    filterLevelRef.current = 0.5
    setFilterLevel(0.5)
    setSemanticZoomActive(false)
    // Re-enable normal zoom
    cy.userZoomingEnabled(true)
    cy.userPanningEnabled(true)
  }, [])

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

  const loadArtistConnections = useCallback(async (artistId, isRoot = false) => {
    if (loadedNodesRef.current.has(artistId)) return
    loadedNodesRef.current.add(artistId)

    if (isRoot) setLoading(true)

    try {
      const { data: artist, error: artistErr } = await supabase
        .from('artists')
        .select('*')
        .eq('id', artistId)
        .single()

      if (artistErr || !artist) {
        if (isRoot) setError(t('graph.error_not_found'))
        return
      }

      const cy = cyRef.current
      if (!cy) return

      addArtistNode(cy, artist, isRoot)

      const [influencersRes, influencedRes] = await Promise.all([
        supabase
          .from('influences')
          .select(`
            id, influence_type, trust_level,
            influencer:influencer_id (id, name, name_ja, genres, birth_year, death_year, image_url)
          `)
          .eq('influenced_id', artistId),
        supabase
          .from('influences')
          .select(`
            id, influence_type, trust_level,
            influenced:influenced_id (id, name, name_ja, genres, birth_year, death_year, image_url)
          `)
          .eq('influencer_id', artistId),
      ])

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
              data: {
                id: edgeId,
                source: influencer.id,
                target: artistId,
                influence_type: inf.influence_type || 'musical',
                trust_level: inf.trust_level || 'wikidata',
              },
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
              data: {
                id: edgeId,
                source: artistId,
                target: influenced.id,
                influence_type: inf.influence_type || 'musical',
                trust_level: inf.trust_level || 'wikidata',
              },
            })
          }
        }
      }

      if (newNodes.length > 0 || newEdges.length > 0) {
        cy.add([...newNodes, ...newEdges])

        const node = cy.getElementById(artistId)
        if (node.length) {
          node.data('hasChildren', false)
        }

        const layout = cy.layout(LAYOUT_OPTIONS)
        layout.on('layoutstop', () => {
          cy.nodes().forEach(n => {
            n.data('connectionCount', n.degree())
          })
          setNodeCount(cy.nodes().length)

          if (isRoot) {
            cy.fit(undefined, 40)
          }

          if (selectedNodeRef.current) {
            applySemanticZoom(cy, selectedNodeRef.current, filterLevelRef.current)
          }
        })
        layout.run()
      }

      if (isRoot) {
        setLoading(false)
        onSelectArtist?.({
          id: artist.id,
          name: artist.name,
          name_ja: artist.name_ja,
          genres: artist.genres,
          birth_year: artist.birth_year,
          death_year: artist.death_year,
          image_url: artist.image_url,
          spotify_url: artist.spotify_url,
          youtube_url: artist.youtube_url,
          wikidata_id: artist.wikidata_id,
        })
      }
    } catch (err) {
      if (isRoot) setError(t('graph.error_load_failed'))
      setLoading(false)
    }
  }, [rootArtistId, onSelectArtist, addArtistNode, applySemanticZoom])

  useEffect(() => {
    if (!containerRef.current) return

    setLoading(true)
    setError(null)
    setNodeCount(0)

    const cy = cytoscape({
      container: containerRef.current,
      style: graphStyles,
      layout: { name: 'preset' },
      minZoom: 0.1,
      maxZoom: 6,
      wheelSensitivity: 0.8,
    })

    cyRef.current = cy
    loadedNodesRef.current = new Set()

    // Expose cy for testing (dev only)
    if (containerRef.current) {
      containerRef.current.__cy = cy
    }

    cy.on('tap', 'node', async (evt) => {
      const node = evt.target
      const nodeData = node.data()

      onSelectArtist?.({
        id: nodeData.id,
        name: nodeData.name,
        name_ja: nodeData.name_ja,
        genres: nodeData.genres,
        birth_year: nodeData.birth_year,
        image_url: nodeData.image_url,
      })

      if (nodeData.hasChildren !== false) {
        await loadArtistConnections(nodeData.id)
      }

      cy.animate({
        center: { eles: node },
        duration: 300,
      })

      // Activate semantic zoom — lock graph zoom, use filterLevel instead
      selectedNodeRef.current = nodeData.id
      filterLevelRef.current = 0.5
      setFilterLevel(0.5)
      setSemanticZoomActive(true)
      cy.userZoomingEnabled(false)
      applySemanticZoom(cy, nodeData.id, 0.5)
    })

    // Background tap: exit semantic zoom
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearSemanticZoom(cy)
        onSelectArtist?.(null)
      }
    })

    // Wheel handler: when semantic zoom active, change filter level instead of zoom
    const container = containerRef.current
    const handleWheel = (e) => {
      if (!selectedNodeRef.current) return
      e.preventDefault()

      const delta = e.deltaY > 0 ? -FILTER_STEP : FILTER_STEP
      const newLevel = Math.max(0, Math.min(1, filterLevelRef.current + delta))
      filterLevelRef.current = newLevel
      setFilterLevel(newLevel)
      applySemanticZoom(cy, selectedNodeRef.current, newLevel)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })

    if (rootArtistId) {
      loadArtistConnections(rootArtistId, true)
    }

    return () => {
      container.removeEventListener('wheel', handleWheel)
      cy.destroy()
    }
  }, [rootArtistId, loadArtistConnections, onSelectArtist, applySemanticZoom, clearSemanticZoom])

  const handleZoomIn = () => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) {
      // Semantic zoom active: increase filter level
      const newLevel = Math.min(1, filterLevelRef.current + FILTER_STEP)
      filterLevelRef.current = newLevel
      setFilterLevel(newLevel)
      applySemanticZoom(cy, selectedNodeRef.current, newLevel)
    } else {
      cy.zoom({ level: cy.zoom() * 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
    }
  }

  const handleZoomOut = () => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) {
      // Semantic zoom active: decrease filter level
      const newLevel = Math.max(0, filterLevelRef.current - FILTER_STEP)
      filterLevelRef.current = newLevel
      setFilterLevel(newLevel)
      applySemanticZoom(cy, selectedNodeRef.current, newLevel)
    } else {
      cy.zoom({ level: cy.zoom() / 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
    }
  }

  const handleFit = () => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) {
      clearSemanticZoom(cy)
    }
    cy.fit(undefined, 40)
  }

  const visibleCount = getVisibleCount(filterLevel)

  return (
    <div className="graph-wrapper">
      {loading && (
        <div className="graph-loading">
          <div className="graph-spinner" />
          <span>{t('graph.loading')}</span>
        </div>
      )}

      {error && (
        <div className="graph-error">
          <span className="material-symbols-outlined">error_outline</span>
          <span>{error}</span>
        </div>
      )}

      <div className="graph-controls" role="toolbar" aria-label="Graph controls">
        <button onClick={handleZoomIn} title={semanticZoomActive ? "表示を増やす" : "拡大"} aria-label={semanticZoomActive ? "表示を増やす" : "拡大"}>
          <span className="material-symbols-outlined">add</span>
        </button>
        <button onClick={handleZoomOut} title={semanticZoomActive ? "表示を減らす" : "縮小"} aria-label={semanticZoomActive ? "表示を減らす" : "縮小"}>
          <span className="material-symbols-outlined">remove</span>
        </button>
        <div className="divider" />
        <button onClick={handleFit} title="全体表示" aria-label="全体表示">
          <span className="material-symbols-outlined">center_focus_strong</span>
        </button>
      </div>

      {nodeCount > 0 && (
        <div className="graph-info">
          {nodeCount} nodes
        </div>
      )}

      {semanticZoomActive && (
        <div className="sz-indicator">
          <span className="material-symbols-outlined">filter_list</span>
          <span className="sz-bar-track">
            <span className="sz-bar-fill" style={{ width: `${filterLevel * 100}%` }} />
          </span>
          <span className="sz-count">
            {visibleCount === Infinity ? 'ALL' : visibleCount}
          </span>
        </div>
      )}

      <div className="graph-legend" aria-label="Legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#7da38d' }} /> {t('influence_type.musical')}
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#d4a753' }} /> {t('influence_type.lyrical')}
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#9ca3af' }} /> {t('influence_type.philosophical')}
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#c25e5e' }} /> {t('influence_type.aesthetic')}
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#8a8880' }} /> {t('influence_type.personal')}
        </div>
      </div>

      <div className="graph-view" ref={containerRef} />
    </div>
  )
}
