import puppeteer from 'puppeteer'

const URL = 'http://localhost:5174/artist/515e6290-f7e0-443b-85a4-a7bceed6e261' // Bob Dylan

async function test() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  console.log('1. Navigating to Bob Dylan page...')
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

  // Wait for graph to load (the loading overlay should disappear)
  console.log('2. Waiting for graph to load...')
  await page.waitForSelector('.graph-view', { timeout: 15000 })
  await new Promise(r => setTimeout(r, 3000)) // wait for layout to finish

  // Check initial state: no sz- classes
  const initialSzCount = await page.evaluate(() => {
    return document.querySelectorAll('[class*="sz-"]').length
  })
  console.log(`3. Initial sz- elements: ${initialSzCount} (expected: 0)`)

  // Check number of nodes in cytoscape
  const nodeInfo = await page.evaluate(() => {
    // Access cytoscape instance through the container
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg) return { nodes: 0, edges: 0, zoom: 0 }
    const cy = container._cyreg.cy
    return { nodes: cy.nodes().length, edges: cy.edges().length, zoom: cy.zoom() }
  })
  console.log(`4. Graph state: ${nodeInfo.nodes} nodes, ${nodeInfo.edges} edges, zoom=${nodeInfo.zoom.toFixed(2)}`)

  // Click on a node by clicking in the graph area
  console.log('5. Clicking on first non-root node...')
  const clickResult = await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg) return 'no cytoscape'
    const cy = container._cyreg.cy

    // Find a non-root node
    const nonRootNodes = cy.nodes().filter(n => !n.data('isRoot'))
    if (nonRootNodes.length === 0) return 'no non-root nodes'

    const targetNode = nonRootNodes[0]

    // Simulate tap event
    targetNode.emit('tap')

    return `tapped: ${targetNode.data('label')}`
  })
  console.log(`   Result: ${clickResult}`)

  await new Promise(r => setTimeout(r, 500))

  // Check if semantic zoom classes are applied
  const szState = await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg) return null
    const cy = container._cyreg.cy

    const focus = cy.nodes('.sz-focus').length
    const neighbor = cy.nodes('.sz-neighbor').length
    const dimmed = cy.nodes('.sz-dimmed').length
    const hidden = cy.nodes('.sz-hidden').length
    const totalNodes = cy.nodes().length

    const edgeVisible = cy.edges('.sz-visible-edge').length
    const edgeDimmed = cy.edges('.sz-dimmed').length
    const edgeHidden = cy.edges('.sz-hidden').length
    const totalEdges = cy.edges().length

    return { focus, neighbor, dimmed, hidden, totalNodes, edgeVisible, edgeDimmed, edgeHidden, totalEdges }
  })

  if (szState) {
    console.log(`6. Semantic zoom state:`)
    console.log(`   Nodes: focus=${szState.focus}, neighbor=${szState.neighbor}, dimmed=${szState.dimmed}, hidden=${szState.hidden} (total=${szState.totalNodes})`)
    console.log(`   Edges: visible=${szState.edgeVisible}, dimmed=${szState.edgeDimmed}, hidden=${szState.edgeHidden} (total=${szState.totalEdges})`)

    const classified = szState.focus + szState.neighbor + szState.dimmed + szState.hidden
    console.log(`   Classified nodes: ${classified}/${szState.totalNodes}`)

    if (szState.focus === 0) {
      console.log('   ❌ FAIL: No sz-focus node found! Semantic zoom is NOT working.')
    } else if (szState.hidden === 0 && szState.dimmed === 0) {
      console.log('   ❌ FAIL: No hidden/dimmed nodes. All nodes are visible.')
    } else {
      console.log('   ✅ PASS: Semantic zoom classes are applied.')
    }
  } else {
    console.log('6. ❌ FAIL: Could not access cytoscape instance')
  }

  // Check if the indicator is shown
  const indicatorShown = await page.evaluate(() => {
    return !!document.querySelector('.sz-indicator')
  })
  console.log(`7. Semantic Zoom indicator visible: ${indicatorShown}`)

  // Test background tap (clear semantic zoom)
  console.log('8. Testing background tap to clear...')
  await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg) return
    const cy = container._cyreg.cy
    cy.emit('tap')
  })
  await new Promise(r => setTimeout(r, 300))

  const afterClear = await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg) return null
    const cy = container._cyreg.cy
    return {
      szElements: cy.elements('.sz-focus, .sz-neighbor, .sz-dimmed, .sz-hidden, .sz-visible-edge').length
    }
  })
  if (afterClear) {
    console.log(`   After clear: ${afterClear.szElements} elements with sz- classes (expected: 0)`)
    if (afterClear.szElements === 0) {
      console.log('   ✅ PASS: Background tap clears semantic zoom.')
    } else {
      console.log('   ❌ FAIL: sz- classes not cleared.')
    }
  }

  await browser.close()
  console.log('\nDone.')
}

test().catch(err => {
  console.error('Test error:', err.message)
  process.exit(1)
})
