import { useCallback, useRef, useState } from 'react'

export function usePathfinding({ cyRef, clearSemanticZoom, selectedNodeRef, loadArtistConnections }) {
  const [pathMode, setPathMode] = useState(false)
  const pathStartRef = useRef(null)

  const handlePathNodeTap = useCallback(async (node, nodeData) => {
    const cy = cyRef.current
    if (!cy) return false

    if (pathStartRef.current === 'waiting') {
      if (nodeData.hasChildren !== false) {
        await loadArtistConnections(nodeData.id)
      }
      pathStartRef.current = nodeData.id
      cy.batch(() => cy.elements().removeClass('path-highlight path-start path-end path-dimmed'))
      node.addClass('path-start')
      return true
    }

    if (pathStartRef.current && pathStartRef.current !== 'waiting' && pathStartRef.current !== nodeData.id) {
      if (nodeData.hasChildren !== false) {
        await loadArtistConnections(nodeData.id)
      }
      const startNode = cy.getElementById(pathStartRef.current)
      if (startNode.length && node.length) {
        const result = cy.elements().aStar({ root: startNode, goal: node, directed: false })
        if (result.found) {
          cy.batch(() => {
            cy.elements().addClass('path-dimmed')
            result.path.removeClass('path-dimmed').addClass('path-highlight')
            startNode.addClass('path-start')
            node.addClass('path-end')
          })
          cy.animate({ fit: { eles: result.path, padding: 60 }, duration: 400 })
        }
      }
      pathStartRef.current = null
      setPathMode(false)
      return true
    }

    return false
  }, [cyRef, loadArtistConnections])

  const togglePathMode = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    if (pathMode) {
      setPathMode(false)
      pathStartRef.current = null
      cy.batch(() => cy.elements().removeClass('path-highlight path-start path-end'))
    } else {
      if (selectedNodeRef.current) clearSemanticZoom(cy)
      setPathMode(true)
      pathStartRef.current = 'waiting'
    }
  }, [cyRef, pathMode, selectedNodeRef, clearSemanticZoom])

  const clearPathMode = useCallback(() => {
    pathStartRef.current = null
    setPathMode(false)
  }, [])

  return { pathMode, pathStartRef, handlePathNodeTap, togglePathMode, clearPathMode }
}
