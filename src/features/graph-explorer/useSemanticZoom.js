import { useCallback, useRef } from 'react'
import { getVisibleCount } from '../../shared/utils/graph-utils.js'

const FILTER_STEP = 0.02
const SZ_CLASSES = 'sz-focus sz-neighbor sz-dimmed sz-hidden sz-visible-edge'

export { FILTER_STEP, SZ_CLASSES }

export function useSemanticZoom({ cyRef, selectedNodeRef, filterLevelRef, setFilterLevel, setSemanticZoomActive, isLayoutRunningRef }) {
  const fitTimerRef = useRef(null)
  const szLockedZoomRef = useRef(null)
  const szFittingRef = useRef(false)
  const savedFilterLevels = useRef(new Map())

  const applySemanticZoom = useCallback((cy, selectedId, level, { fit = false } = {}) => {
    if (!cy || !selectedId) return

    const selectedNode = cy.getElementById(selectedId)
    if (!selectedNode.length) return

    const maxVisible = getVisibleCount(level != null ? level : filterLevelRef.current)
    const neighborhood = selectedNode.neighborhood().nodes()

    const sorted = neighborhood.toArray().sort((a, b) =>
      (b.data('connectionCount') || b.degree()) - (a.data('connectionCount') || a.degree())
    )

    const allInfluencers = []
    const allInfluenced = []
    sorted.forEach(node => {
      const hasEdgeToSelected = cy.edges().some(e =>
        e.source().id() === node.id() && e.target().id() === selectedId
      )
      if (hasEdgeToSelected) allInfluencers.push(node)
      else allInfluenced.push(node)
    })

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
        if (visibleNeighborIds.has(id)) node.addClass('sz-neighbor')
        else if (hiddenNeighborIds.has(id)) node.addClass('sz-hidden')
        else node.addClass('sz-dimmed')
      })
      cy.edges().forEach(edge => {
        const srcId = edge.source().id()
        const tgtId = edge.target().id()
        if (hiddenNeighborIds.has(srcId) || hiddenNeighborIds.has(tgtId)) edge.addClass('sz-hidden')
        else if (fullyVisible.has(srcId) && fullyVisible.has(tgtId)) edge.addClass('sz-visible-edge')
        else edge.addClass('sz-dimmed')
      })
    })

    cy.userZoomingEnabled(false)

    if (!isLayoutRunningRef.current) {
      const vertSpacing = 140
      const colSpacing = 100
      const focusPos = selectedNode.position()
      const centerX = focusPos.x
      const centerY = focusPos.y

      const centerOutward = (nodes, cx, rowY) => {
        nodes.forEach((node, i) => {
          if (i === 0) node.position({ x: cx, y: rowY })
          else {
            const slot = Math.ceil(i / 2)
            const side = i % 2 === 1 ? 1 : -1
            node.position({ x: cx + side * slot * colSpacing, y: rowY })
          }
        })
      }

      if (allInfluencers.length > 0) centerOutward(allInfluencers, centerX, centerY - vertSpacing)
      if (visibleInfluenced.length > 0) centerOutward(visibleInfluenced, centerX, centerY + vertSpacing)

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
  }, [filterLevelRef, isLayoutRunningRef])

  const clearSemanticZoom = useCallback((cy) => {
    if (!cy) return
    cy.batch(() => cy.elements().removeClass(SZ_CLASSES))
    clearTimeout(fitTimerRef.current)
    selectedNodeRef.current = null
    filterLevelRef.current = 0.5
    setFilterLevel(0.5)
    setSemanticZoomActive(false)
    szLockedZoomRef.current = null
    szFittingRef.current = false
    cy.userZoomingEnabled(true)
    cy.userPanningEnabled(true)
  }, [selectedNodeRef, filterLevelRef, setFilterLevel, setSemanticZoomActive])

  const exitSemanticZoomKeepResults = useCallback((cy) => {
    if (!cy) return
    if (selectedNodeRef.current) {
      savedFilterLevels.current.set(selectedNodeRef.current, filterLevelRef.current)
    }
    clearTimeout(fitTimerRef.current)
    selectedNodeRef.current = null
    setSemanticZoomActive(false)
    szLockedZoomRef.current = null
    szFittingRef.current = false
    cy.userZoomingEnabled(true)
    cy.userPanningEnabled(true)
  }, [selectedNodeRef, filterLevelRef, setSemanticZoomActive])

  const activateSemanticZoom = useCallback((cy, nodeId) => {
    selectedNodeRef.current = nodeId
    const restoredLevel = savedFilterLevels.current.get(nodeId) ?? 0.5
    filterLevelRef.current = restoredLevel
    setFilterLevel(restoredLevel)
    setSemanticZoomActive(true)
    cy.userZoomingEnabled(false)
    szLockedZoomRef.current = cy.zoom()
    szFittingRef.current = false
    return restoredLevel
  }, [selectedNodeRef, filterLevelRef, setFilterLevel, setSemanticZoomActive])

  const setupZoomGuard = useCallback((cy) => {
    cy.on('zoom', () => {
      if (selectedNodeRef.current && szLockedZoomRef.current != null && !szFittingRef.current) {
        const diff = Math.abs(cy.zoom() - szLockedZoomRef.current)
        if (diff > 0.001) cy.zoom(szLockedZoomRef.current)
      }
    })
  }, [selectedNodeRef])

  const setupWheelHandler = useCallback((container, cy) => {
    const handleWheel = (e) => {
      if (!selectedNodeRef.current) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const delta = e.deltaY > 0 ? -FILTER_STEP : FILTER_STEP
      const newLevel = Math.max(0, Math.min(1, filterLevelRef.current + delta))
      if (newLevel === filterLevelRef.current) return
      filterLevelRef.current = newLevel
      setFilterLevel(newLevel)
      applySemanticZoom(cy, selectedNodeRef.current, newLevel)
    }
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', handleWheel, { capture: true })
  }, [selectedNodeRef, filterLevelRef, setFilterLevel, applySemanticZoom])

  const adjustFilterLevel = useCallback((delta) => {
    const cy = cyRef.current
    if (!cy || !selectedNodeRef.current) return
    const newLevel = Math.max(0, Math.min(1, filterLevelRef.current + delta))
    filterLevelRef.current = newLevel
    setFilterLevel(newLevel)
    applySemanticZoom(cy, selectedNodeRef.current, newLevel)
  }, [cyRef, selectedNodeRef, filterLevelRef, setFilterLevel, applySemanticZoom])

  const cleanup = useCallback(() => {
    clearTimeout(fitTimerRef.current)
  }, [])

  return {
    applySemanticZoom,
    clearSemanticZoom,
    exitSemanticZoomKeepResults,
    activateSemanticZoom,
    setupZoomGuard,
    setupWheelHandler,
    adjustFilterLevel,
    cleanup,
  }
}
