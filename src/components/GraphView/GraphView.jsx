import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { supabase } from '../../lib/supabase.js'
import { getCached, setCache } from '../../lib/cache.js'
import { getVisibleCount } from '../../utils/graph-utils.js'
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

const FILTER_STEP = 0.08
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
  const [tooltip, setTooltip] = useState(null)
  const tooltipTimerRef = useRef(null)
  const [activeEdgeFilter, setActiveEdgeFilter] = useState(null)
  const [pathMode, setPathMode] = useState(false)
  const pathStartRef = useRef(null)
  const isLayoutRunningRef = useRef(false)
  const fitTimerRef = useRef(null)
  const szLockedZoomRef = useRef(null)
  const szFittingRef = useRef(false)

  const applySemanticZoom = useCallback((cy, selectedId, level, { fit = false } = {}) => {
    if (!cy || !selectedId) return

    const selectedNode = cy.getElementById(selectedId)
    if (!selectedNode.length) return

    const maxVisible = getVisibleCount(level != null ? level : filterLevelRef.current)
    const neighborhood = selectedNode.neighborhood().nodes()

    const sorted = neighborhood.toArray().sort((a, b) =>
      (b.data('connectionCount') || b.degree()) - (a.data('connectionCount') || a.degree())
    )

    // Separate influencers vs influenced BEFORE filtering
    const allInfluencers = []
    const allInfluenced = []
    sorted.forEach(node => {
      const hasEdgeToSelected = cy.edges().some(e =>
        e.source().id() === node.id() && e.target().id() === selectedId
      )
      if (hasEdgeToSelected) {
        allInfluencers.push(node)
      } else {
        allInfluenced.push(node)
      }
    })

    // Influencers: always show ALL. Filter only applies to influenced.
    const visibleInfluenced = allInfluenced.slice(0, maxVisible)
    const hiddenInfluenced = allInfluenced.slice(maxVisible)

    const visibleNeighborIds = new Set([
      ...allInfluencers.map(n => n.id()),
      ...visibleInfluenced.map(n => n.id()),
    ])
    const hiddenNeighborIds = new Set(hiddenInfluenced.map(n => n.id()))
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

    // Ensure zoom stays disabled during SZ mode
    cy.userZoomingEnabled(false)

    // Re-layout visible neighbors in centered tree form
    if (!isLayoutRunningRef.current) {
      const vertSpacing = 140
      const colSpacing = 100

      // Use focus node's current position as stable anchor
      const focusPos = selectedNode.position()
      const centerX = focusPos.x
      const centerY = focusPos.y

      // Place nodes from center outward: 0=center, 1=right, 2=left, 3=right2, ...
      const centerOutward = (nodes, cx, rowY) => {
        nodes.forEach((node, i) => {
          if (i === 0) {
            node.position({ x: cx, y: rowY })
          } else {
            const slot = Math.ceil(i / 2)
            const side = i % 2 === 1 ? 1 : -1
            node.position({ x: cx + side * slot * colSpacing, y: rowY })
          }
        })
      }

      // Influencers: row above (always all shown)
      if (allInfluencers.length > 0) {
        centerOutward(allInfluencers, centerX, centerY - vertSpacing)
      }

      // Influenced: row below (filtered by maxVisible)
      if (visibleInfluenced.length > 0) {
        centerOutward(visibleInfluenced, centerX, centerY + vertSpacing)
      }

      // On initial tap, center view on the visible nodes (pan only, no zoom change)
      if (fit) {
        clearTimeout(fitTimerRef.current)
        fitTimerRef.current = setTimeout(() => {
          const visibleNodes = cy.nodes('.sz-focus, .sz-neighbor')
          if (visibleNodes.length > 0) {
            cy.stop()
            cy.center(visibleNodes)
            szLockedZoomRef.current = cy.zoom()
          }
        }, 100)
      }
    }
  }, [])

  const clearSemanticZoom = useCallback((cy) => {
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass(SZ_CLASSES)
    })
    clearTimeout(fitTimerRef.current)
    selectedNodeRef.current = null
    filterLevelRef.current = 0.5
    setFilterLevel(0.5)
    setSemanticZoomActive(false)
    szLockedZoomRef.current = null
    szFittingRef.current = false
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

  const loadArtistConnections = useCallback(async (artistId, { isRoot = false, skipLayoutAnim = false } = {}) => {
    if (loadedNodesRef.current.has(artistId)) return
    loadedNodesRef.current.add(artistId)

    if (isRoot) setLoading(true)

    try {
      // Check cache first
      const cacheKey = `artist:${artistId}`
      let artist = getCached(cacheKey)
      if (!artist) {
        const { data, error: artistErr } = await supabase
          .from('artists')
          .select('*')
          .eq('id', artistId)
          .single()
        if (artistErr || !data) {
          if (isRoot) setError(t('graph.error_not_found'))
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
            .eq('influenced_id', artistId),
          supabase
            .from('influences')
            .select(`
              id, influence_type, trust_level,
              influenced:influenced_id (id, name, name_ja, genres, birth_year, death_year, image_url)
            `)
            .eq('influencer_id', artistId),
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

        const layoutOpts = skipLayoutAnim
          ? { ...LAYOUT_OPTIONS, animate: false }
          : LAYOUT_OPTIONS
        const layout = cy.layout(layoutOpts)
        isLayoutRunningRef.current = true
        layout.on('layoutstop', () => {
          isLayoutRunningRef.current = false
          cy.nodes().forEach(n => {
            n.data('connectionCount', n.degree())
          })
          setNodeCount(cy.nodes().length)

          if (isRoot) {
            cy.fit(undefined, 40)
          }

          if (selectedNodeRef.current) {
            applySemanticZoom(cy, selectedNodeRef.current, filterLevelRef.current, { fit: true })
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
      wheelSensitivity: 1.5,
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

      // Path mode handling (load with normal animation)
      if (pathStartRef.current === 'waiting') {
        if (nodeData.hasChildren !== false) {
          await loadArtistConnections(nodeData.id)
        }
        pathStartRef.current = nodeData.id
        cy.batch(() => {
          cy.elements().removeClass('path-highlight path-start path-end path-dimmed')
        })
        node.addClass('path-start')
        return
      }

      if (pathStartRef.current && pathStartRef.current !== 'waiting' && pathStartRef.current !== nodeData.id) {
        if (nodeData.hasChildren !== false) {
          await loadArtistConnections(nodeData.id)
        }
        const startNode = cy.getElementById(pathStartRef.current)
        const endNode = node
        if (startNode.length && endNode.length) {
          const result = cy.elements().aStar({
            root: startNode,
            goal: endNode,
            directed: false,
          })
          if (result.found) {
            cy.batch(() => {
              cy.elements().addClass('path-dimmed')
              result.path.removeClass('path-dimmed').addClass('path-highlight')
              startNode.addClass('path-start')
              endNode.addClass('path-end')
            })
            cy.animate({ fit: { eles: result.path, padding: 60 }, duration: 400 })
          }
        }
        pathStartRef.current = null
        setPathMode(false)
        return
      }

      // Normal mode: activate semantic zoom BEFORE loading
      selectedNodeRef.current = nodeData.id
      filterLevelRef.current = 0.5
      setFilterLevel(0.5)
      setSemanticZoomActive(true)
      cy.userZoomingEnabled(false)
      szLockedZoomRef.current = cy.zoom()
      szFittingRef.current = false

      if (nodeData.hasChildren !== false) {
        // Load with no dagre animation — layoutstop will apply SZ + fit
        await loadArtistConnections(nodeData.id, { skipLayoutAnim: true })
        // layoutstop already called applySemanticZoom, nothing more to do
      } else {
        // Already loaded, apply SZ with fit
        applySemanticZoom(cy, nodeData.id, 0.5, { fit: true })
      }
    })

    // Background tap: exit semantic zoom / path mode
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearSemanticZoom(cy)
        onSelectArtist?.(null)
        // Clear path highlight
        pathStartRef.current = null
        setPathMode(false)
        cy.batch(() => {
          cy.elements().removeClass('path-highlight path-start path-end path-dimmed')
        })
      }
    })

    // Tooltip on mouseover
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target
      const d = node.data()
      const pos = node.renderedPosition()
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = setTimeout(() => {
        setTooltip({
          x: pos.x,
          y: pos.y,
          name: d.name_ja || d.name,
          nameEn: d.name_ja ? d.name : null,
          genres: d.genres,
          birthYear: d.birth_year,
        })
      }, 300)
    })

    cy.on('mouseout', 'node', () => {
      clearTimeout(tooltipTimerRef.current)
      setTooltip(null)
    })

    // Zoom guard: forcibly reset zoom if something changes it during SZ mode
    cy.on('zoom', () => {
      if (selectedNodeRef.current && szLockedZoomRef.current != null && !szFittingRef.current) {
        const diff = Math.abs(cy.zoom() - szLockedZoomRef.current)
        if (diff > 0.001) {
          cy.zoom(szLockedZoomRef.current)
        }
      }
    })

    // Wheel handler: capture phase + stopImmediatePropagation to block ALL other listeners
    const container = containerRef.current
    const handleWheel = (e) => {
      if (!selectedNodeRef.current) return
      // stopImmediatePropagation blocks same-element listeners (Cytoscape's handler)
      e.preventDefault()
      e.stopImmediatePropagation()

      const delta = e.deltaY > 0 ? -FILTER_STEP : FILTER_STEP
      const newLevel = Math.max(0, Math.min(1, filterLevelRef.current + delta))
      if (newLevel === filterLevelRef.current) return // already at limit
      filterLevelRef.current = newLevel
      setFilterLevel(newLevel)
      applySemanticZoom(cy, selectedNodeRef.current, newLevel)
    }
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    if (rootArtistId) {
      loadArtistConnections(rootArtistId, { isRoot: true })
    }

    return () => {
      clearTimeout(fitTimerRef.current)
      container.removeEventListener('wheel', handleWheel, { capture: true })
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

  const handleEdgeFilter = (type) => {
    const cy = cyRef.current
    if (!cy) return
    if (activeEdgeFilter === type) {
      // Clear filter
      setActiveEdgeFilter(null)
      cy.batch(() => {
        cy.edges().removeClass('edge-dimmed')
        cy.nodes().removeClass('node-dimmed-by-filter')
      })
    } else {
      setActiveEdgeFilter(type)
      cy.batch(() => {
        const connectedNodeIds = new Set()
        cy.edges().forEach(edge => {
          if (edge.data('influence_type') === type) {
            edge.removeClass('edge-dimmed')
            connectedNodeIds.add(edge.source().id())
            connectedNodeIds.add(edge.target().id())
          } else {
            edge.addClass('edge-dimmed')
          }
        })
        cy.nodes().forEach(node => {
          if (connectedNodeIds.has(node.id())) {
            node.removeClass('node-dimmed-by-filter')
          } else {
            node.addClass('node-dimmed-by-filter')
          }
        })
      })
    }
  }

  const togglePathMode = () => {
    const cy = cyRef.current
    if (!cy) return
    if (pathMode) {
      // Exit path mode
      setPathMode(false)
      pathStartRef.current = null
      cy.batch(() => {
        cy.elements().removeClass('path-highlight path-start path-end')
      })
    } else {
      // Enter path mode, clear semantic zoom
      if (selectedNodeRef.current) clearSemanticZoom(cy)
      setPathMode(true)
      pathStartRef.current = 'waiting'
    }
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
        <div className="divider" />
        <button onClick={togglePathMode} title="経路探索" aria-label="経路探索" className={pathMode ? 'active' : ''}>
          <span className="material-symbols-outlined">route</span>
        </button>
      </div>

      {pathMode && (
        <div className="path-hint">
          {pathStartRef.current === 'waiting' ? '始点のノードをクリック' : '終点のノードをクリック'}
        </div>
      )}

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
        {[
          { type: 'musical', color: '#7da38d' },
          { type: 'lyrical', color: '#d4a753' },
          { type: 'philosophical', color: '#9ca3af' },
          { type: 'aesthetic', color: '#c25e5e' },
          { type: 'personal', color: '#8a8880' },
        ].map(({ type, color }) => (
          <button
            key={type}
            className={`legend-item ${activeEdgeFilter === type ? 'legend-active' : ''}`}
            onClick={() => handleEdgeFilter(type)}
          >
            <span className="legend-dot" style={{ background: color }} /> {t(`influence_type.${type}`)}
          </button>
        ))}
      </div>

      {tooltip && (
        <div
          className="graph-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="tooltip-name">{tooltip.name}</div>
          {tooltip.nameEn && <div className="tooltip-name-en">{tooltip.nameEn}</div>}
          {tooltip.genres?.length > 0 && (
            <div className="tooltip-genre">{tooltip.genres.slice(0, 2).join(', ')}</div>
          )}
          {tooltip.birthYear && <div className="tooltip-year">{tooltip.birthYear}–</div>}
        </div>
      )}

      <div className="graph-view" ref={containerRef} />
    </div>
  )
}
