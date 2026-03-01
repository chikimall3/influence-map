import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { graphStyles } from './graph-styles.js'
import { useSemanticZoom, FILTER_STEP } from './useSemanticZoom.js'
import { useGraphData } from './useGraphData.js'
import { usePathfinding } from './usePathfinding.js'
import GraphControls from './GraphControls.jsx'
import GraphLegend from './GraphLegend.jsx'
import GraphTooltip from './GraphTooltip.jsx'
import SZIndicator from './SZIndicator.jsx'
import './GraphView.css'

cytoscape.use(dagre)

export default function GraphView({ rootArtistId, onSelectArtist }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const selectedNodeRef = useRef(null)
  const filterLevelRef = useRef(0.5)
  const isLayoutRunningRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [semanticZoomActive, setSemanticZoomActive] = useState(false)
  const [filterLevel, setFilterLevel] = useState(0.5)
  const [tooltip, setTooltip] = useState(null)
  const tooltipTimerRef = useRef(null)
  const [activeEdgeFilter, setActiveEdgeFilter] = useState(null)

  // --- Hooks ---
  const {
    applySemanticZoom, clearSemanticZoom, exitSemanticZoomKeepResults,
    activateSemanticZoom, setupZoomGuard, setupWheelHandler, adjustFilterLevel, cleanup: szCleanup,
  } = useSemanticZoom({
    cyRef, selectedNodeRef, filterLevelRef, setFilterLevel, setSemanticZoomActive, isLayoutRunningRef,
  })

  const { loadArtistConnections, resetLoadedNodes } = useGraphData({
    cyRef, onSelectArtist,
    onNodeCountChange: setNodeCount,
    onLoadingChange: setLoading,
    onError: setError,
    applySemanticZoom, selectedNodeRef, filterLevelRef, isLayoutRunningRef, t,
  })

  const { pathMode, pathStartRef, handlePathNodeTap, togglePathMode, clearPathMode } = usePathfinding({
    cyRef, clearSemanticZoom, selectedNodeRef, loadArtistConnections,
  })

  // --- Edge filter ---
  const handleEdgeFilter = useCallback((type) => {
    const cy = cyRef.current
    if (!cy) return
    if (activeEdgeFilter === type) {
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
          if (connectedNodeIds.has(node.id())) node.removeClass('node-dimmed-by-filter')
          else node.addClass('node-dimmed-by-filter')
        })
      })
    }
  }, [activeEdgeFilter])

  // --- Zoom controls ---
  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) {
      adjustFilterLevel(FILTER_STEP)
    } else {
      cy.zoom({ level: cy.zoom() * 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
    }
  }, [adjustFilterLevel])

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) {
      adjustFilterLevel(-FILTER_STEP)
    } else {
      cy.zoom({ level: cy.zoom() / 2.0, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
    }
  }, [adjustFilterLevel])

  const handleFit = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeRef.current) clearSemanticZoom(cy)
    cy.fit(undefined, 40)
  }, [clearSemanticZoom])

  // --- Main effect: setup cytoscape ---
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
    resetLoadedNodes()

    if (containerRef.current) containerRef.current.__cy = cy

    // Node tap
    cy.on('tap', 'node', async (evt) => {
      const node = evt.target
      const nodeData = node.data()

      onSelectArtist?.({
        id: nodeData.id, name: nodeData.name, name_ja: nodeData.name_ja,
        genres: nodeData.genres, birth_year: nodeData.birth_year, image_url: nodeData.image_url,
      })

      // Path mode intercept
      const handled = await handlePathNodeTap(node, nodeData)
      if (handled) return

      // Semantic zoom activation
      const restoredLevel = activateSemanticZoom(cy, nodeData.id)
      if (nodeData.hasChildren !== false) {
        await loadArtistConnections(nodeData.id, { skipLayoutAnim: true })
      } else {
        applySemanticZoom(cy, nodeData.id, restoredLevel, { fit: true })
      }
    })

    // Background tap
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        exitSemanticZoomKeepResults(cy)
        onSelectArtist?.(null)
        clearPathMode()
        cy.batch(() => cy.elements().removeClass('path-highlight path-start path-end path-dimmed'))
      }
    })

    // Tooltip
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target
      const d = node.data()
      const pos = node.renderedPosition()
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = setTimeout(() => {
        setTooltip({
          x: pos.x, y: pos.y,
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

    setupZoomGuard(cy)
    const removeWheelHandler = setupWheelHandler(containerRef.current, cy)

    if (rootArtistId) loadArtistConnections(rootArtistId, { isRoot: true })

    return () => {
      szCleanup()
      removeWheelHandler()
      cy.destroy()
    }
  }, [rootArtistId, loadArtistConnections, onSelectArtist, applySemanticZoom, clearSemanticZoom, exitSemanticZoomKeepResults, activateSemanticZoom, setupZoomGuard, setupWheelHandler, szCleanup, resetLoadedNodes, handlePathNodeTap, clearPathMode])

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

      <GraphControls
        semanticZoomActive={semanticZoomActive}
        pathMode={pathMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onTogglePath={togglePathMode}
      />

      {pathMode && (
        <div className="path-hint">
          {pathStartRef.current === 'waiting' ? '始点のノードをクリック' : '終点のノードをクリック'}
        </div>
      )}

      {nodeCount > 0 && <div className="graph-info">{nodeCount} nodes</div>}

      {semanticZoomActive && <SZIndicator filterLevel={filterLevel} />}

      <GraphLegend activeEdgeFilter={activeEdgeFilter} onFilterEdge={handleEdgeFilter} />

      <GraphTooltip tooltip={tooltip} />

      <div className="graph-view" ref={containerRef} />
    </div>
  )
}
