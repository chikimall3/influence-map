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

function getVisibleCount(zoomLevel) {
  if (zoomLevel < 0.7) return 5
  if (zoomLevel < 1.2) return 10
  if (zoomLevel < 2.0) return 20
  return Infinity
}

const SZ_CLASSES = 'sz-focus sz-neighbor sz-dimmed sz-hidden sz-visible-edge'

export default function GraphView({ rootArtistId, onSelectArtist }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const loadedNodesRef = useRef(new Set())
  const selectedNodeRef = useRef(null)
  const zoomTimerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [semanticZoomActive, setSemanticZoomActive] = useState(false)

  const applySemanticZoom = useCallback((cy, selectedId) => {
    if (!cy || !selectedId) return

    const selectedNode = cy.getElementById(selectedId)
    if (!selectedNode.length) return

    const maxVisible = getVisibleCount(cy.zoom())
    const neighborhood = selectedNode.neighborhood().nodes()

    // Sort neighbors by degree descending (most connected first)
    const sorted = neighborhood.toArray().sort((a, b) =>
      (b.data('connectionCount') || b.degree()) - (a.data('connectionCount') || a.degree())
    )

    const visibleNeighborIds = new Set(sorted.slice(0, maxVisible).map(n => n.id()))
    const hiddenNeighborIds = new Set(sorted.slice(maxVisible).map(n => n.id()))
    const fullyVisible = new Set([selectedId, ...visibleNeighborIds])

    cy.batch(() => {
      cy.elements().removeClass(SZ_CLASSES)

      // Classify nodes
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

      // Classify edges based on node sets
      cy.edges().forEach(edge => {
        const srcId = edge.source().id()
        const tgtId = edge.target().id()

        // If either end is hidden → hide edge
        if (hiddenNeighborIds.has(srcId) || hiddenNeighborIds.has(tgtId)) {
          edge.addClass('sz-hidden')
        } else if (fullyVisible.has(srcId) && fullyVisible.has(tgtId)) {
          // Both ends fully visible → show edge
          edge.addClass('sz-visible-edge')
        } else {
          // Otherwise dim (connects to dimmed nodes)
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
    setSemanticZoomActive(false)
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

      // Fetch both directions in parallel
      const [influencersRes, influencedRes] = await Promise.all([
        // Who influenced this artist (influencer → this)
        supabase
          .from('influences')
          .select(`
            id, influence_type, trust_level,
            influencer:influencer_id (id, name, name_ja, genres, birth_year, death_year, image_url)
          `)
          .eq('influenced_id', artistId),
        // Who this artist influenced (this → influenced)
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

      // Process influencers (upstream)
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

      // Process influenced (downstream)
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
          // Update node sizes based on actual connection count
          cy.nodes().forEach(n => {
            n.data('connectionCount', n.degree())
          })
          setNodeCount(cy.nodes().length)

          // Fit graph into view after layout completes
          if (isRoot) {
            cy.fit(undefined, 40)
          }

          // Re-apply semantic zoom if active
          if (selectedNodeRef.current) {
            applySemanticZoom(cy, selectedNodeRef.current)
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

      // Activate semantic zoom for this node
      selectedNodeRef.current = nodeData.id
      setSemanticZoomActive(true)
      applySemanticZoom(cy, nodeData.id)
    })

    // Background tap: exit semantic zoom
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearSemanticZoom(cy)
        onSelectArtist?.(null)
      }
    })

    // Zoom event: recalculate semantic zoom with debounce
    cy.on('zoom', () => {
      if (!selectedNodeRef.current) return
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => {
        applySemanticZoom(cy, selectedNodeRef.current)
      }, 80)
    })

    if (rootArtistId) {
      loadArtistConnections(rootArtistId, true)
    }

    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      cy.destroy()
    }
  }, [rootArtistId, loadArtistConnections, onSelectArtist, applySemanticZoom, clearSemanticZoom])

  const handleZoomIn = () => {
    const cy = cyRef.current
    if (cy) cy.zoom({ level: cy.zoom() * 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  }

  const handleZoomOut = () => {
    const cy = cyRef.current
    if (cy) cy.zoom({ level: cy.zoom() / 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  }

  const handleFit = () => {
    const cy = cyRef.current
    if (cy) cy.fit(undefined, 40)
  }

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
        <button onClick={handleZoomIn} title="拡大" aria-label="拡大">
          <span className="material-symbols-outlined">add</span>
        </button>
        <button onClick={handleZoomOut} title="縮小" aria-label="縮小">
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
          <span className="material-symbols-outlined">zoom_in_map</span>
          Semantic Zoom
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
