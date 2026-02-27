/**
 * test-semantic-zoom-v2.mjs
 *
 * End-to-end test for the GraphView semantic zoom behavior.
 *
 * Prerequisites:
 *   npm install --save-dev puppeteer
 *
 * Usage:
 *   node scripts/test-semantic-zoom-v2.mjs
 *
 * The script will:
 *   1. Start a Vite dev server on port 5174
 *   2. Launch Puppeteer and navigate to the Bob Dylan artist page
 *   3. Run seven test cases against the semantic zoom feature
 *   4. Print PASS/FAIL for each test and a summary
 *   5. Clean up (close browser, kill dev server)
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOB_DYLAN_URL =
  'http://localhost:5174/artist/515e6290-f7e0-443b-85a4-a7bceed6e261'

const VITE_READY_TIMEOUT = 30_000   // ms to wait for Vite to print its URL
const PAGE_LOAD_TIMEOUT  = 30_000   // ms to wait for navigation
const GRAPH_SETTLE_MS    = 5_000    // ms to wait for layout + data fetch

let viteProcess = null
let browser = null

const results = []

function record(name, passed, detail = '') {
  results.push({ name, passed, detail })
  const tag = passed ? 'PASS' : 'FAIL'
  const msg = detail ? ` -- ${detail}` : ''
  console.log(`  [${tag}] ${name}${msg}`)
}

// ---------------------------------------------------------------------------
// 1. Start Vite dev server
// ---------------------------------------------------------------------------

async function startVite() {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const cmd = isWindows ? 'npx.cmd' : 'npx'

    viteProcess = spawn(cmd, ['vite', '--port', '5174', '--strictPort'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    })

    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('Vite did not start within timeout'))
      }
    }, VITE_READY_TIMEOUT)

    const onData = (chunk) => {
      const text = chunk.toString()
      process.stdout.write(text)  // mirror vite output
      // Strip ANSI escape codes before matching
      const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
      if (!resolved && clean.includes('localhost:5174')) {
        resolved = true
        clearTimeout(timer)
        // Give Vite a moment to stabilise
        setTimeout(() => resolve(), 1000)
      }
    }

    viteProcess.stdout.on('data', onData)
    viteProcess.stderr.on('data', onData)

    viteProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        reject(err)
      }
    })

    viteProcess.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        reject(new Error(`Vite exited prematurely with code ${code}`))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// 2. Cleanup helpers
// ---------------------------------------------------------------------------

async function cleanup() {
  if (browser) {
    try { await browser.close() } catch { /* ignore */ }
    browser = null
  }
  if (viteProcess) {
    // On Windows, spawn with shell needs tree-kill or taskkill
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(viteProcess.pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: true,
        })
      } catch { /* ignore */ }
    } else {
      try { viteProcess.kill('SIGTERM') } catch { /* ignore */ }
    }
    viteProcess = null
  }
}

// ---------------------------------------------------------------------------
// 3. Main test runner
// ---------------------------------------------------------------------------

async function run() {
  // -----------------------------------------------------------------------
  // Import puppeteer (gives a clear error if not installed)
  // -----------------------------------------------------------------------
  let puppeteer
  try {
    puppeteer = (await import('puppeteer')).default
  } catch {
    console.error(
      '\nError: puppeteer is not installed.\n' +
      'Run:  npm install --save-dev puppeteer\n'
    )
    process.exit(1)
  }

  // -----------------------------------------------------------------------
  // Start Vite
  // -----------------------------------------------------------------------
  console.log('\n--- Starting Vite dev server on port 5174 ---\n')
  try {
    await startVite()
  } catch (err) {
    console.error('Failed to start Vite:', err.message)
    await cleanup()
    process.exit(1)
  }
  console.log('\n--- Vite is ready ---\n')

  // -----------------------------------------------------------------------
  // Launch Puppeteer
  // -----------------------------------------------------------------------
  console.log('--- Launching browser ---\n')
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  // -----------------------------------------------------------------------
  // Navigate to the Bob Dylan page
  // -----------------------------------------------------------------------
  console.log(`Navigating to: ${BOB_DYLAN_URL}\n`)
  await page.goto(BOB_DYLAN_URL, {
    waitUntil: 'networkidle2',
    timeout: PAGE_LOAD_TIMEOUT,
  })

  // Wait for the .graph-view container to be in the DOM
  await page.waitForSelector('.graph-view', { timeout: 15_000 })

  // Wait for loading overlay to disappear (or timeout after 10s)
  try {
    await page.waitForSelector('.graph-loading', {
      hidden: true,
      timeout: 10_000,
    })
  } catch {
    // If the loading overlay never appeared or is already gone, that is fine
  }

  // Extra settle time for layout animation + data fetch
  console.log(`Waiting ${GRAPH_SETTLE_MS / 1000}s for graph to settle...\n`)
  await sleep(GRAPH_SETTLE_MS)

  // -----------------------------------------------------------------------
  // TEST 1: Graph loads with nodes
  // -----------------------------------------------------------------------
  console.log('--- Running tests ---\n')

  const graphState = await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    if (!container || !container._cyreg || !container._cyreg.cy) {
      return null
    }
    const cy = container._cyreg.cy
    return {
      nodes: cy.nodes().length,
      edges: cy.edges().length,
      zoom: cy.zoom(),
    }
  })

  if (!graphState) {
    record('TEST 1: Graph loads with nodes', false,
      'Could not access Cytoscape instance via ._cyreg.cy')
    // Remaining tests cannot run without cy -- abort early
    printSummary()
    await cleanup()
    process.exit(1)
  }

  record(
    'TEST 1: Graph loads with nodes',
    graphState.nodes > 0,
    `${graphState.nodes} nodes, ${graphState.edges} edges, zoom=${graphState.zoom.toFixed(3)}`
  )

  // -----------------------------------------------------------------------
  // TEST 2: Initially no sz- classes on any elements
  // -----------------------------------------------------------------------
  const initialSzCount = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    return cy.elements('.sz-focus, .sz-neighbor, .sz-dimmed, .sz-hidden, .sz-visible-edge').length
  })

  record(
    'TEST 2: Initially no sz- classes',
    initialSzCount === 0,
    `sz- elements count = ${initialSzCount} (expected 0)`
  )

  // -----------------------------------------------------------------------
  // TEST 3: After tapping a non-root node, sz-focus class on exactly 1 node
  // -----------------------------------------------------------------------
  const tapResult = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    const nonRoot = cy.nodes().filter(n => !n.data('isRoot'))
    if (nonRoot.length === 0) return { ok: false, reason: 'no non-root nodes' }

    const target = nonRoot[0]
    target.emit('tap')
    return { ok: true, label: target.data('label') }
  })

  // Give React and the event handler time to process
  await sleep(800)

  if (!tapResult.ok) {
    record('TEST 3: sz-focus after tapping non-root node', false, tapResult.reason)
  } else {
    const focusCount = await page.evaluate(() => {
      const cy = document.querySelector('.graph-view')._cyreg.cy
      return cy.nodes('.sz-focus').length
    })
    record(
      'TEST 3: sz-focus after tapping non-root node',
      focusCount === 1,
      `tapped "${tapResult.label}", sz-focus count = ${focusCount} (expected 1)`
    )
  }

  // -----------------------------------------------------------------------
  // TEST 4: .sz-indicator DOM element is visible
  // -----------------------------------------------------------------------
  const indicatorVisible = await page.evaluate(() => {
    const el = document.querySelector('.sz-indicator')
    if (!el) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })

  record(
    'TEST 4: .sz-indicator DOM element visible',
    indicatorVisible,
    indicatorVisible ? 'indicator is present and visible' : 'indicator NOT found or hidden'
  )

  // -----------------------------------------------------------------------
  // TEST 5: User zooming is disabled while semantic zoom is active
  // -----------------------------------------------------------------------
  const userZoomDisabled = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    return cy.userZoomingEnabled() === false
  })

  record(
    'TEST 5: User zooming disabled during semantic zoom',
    userZoomDisabled,
    `cy.userZoomingEnabled() = ${!userZoomDisabled}`
  )

  // -----------------------------------------------------------------------
  // TEST 6: Node visibility changed after wheel events
  // -----------------------------------------------------------------------
  // Capture hidden count BEFORE additional wheel events
  const hiddenBefore = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    return cy.nodes('.sz-hidden').length
  })

  // Dispatch more aggressive wheel events in the opposite direction
  await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    for (let i = 0; i < 10; i++) {
      container.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 200,
          bubbles: true,
          cancelable: true,
        })
      )
    }
  })
  await sleep(600)

  const hiddenAfter = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    return cy.nodes('.sz-hidden').length
  })

  // Either the hidden count changed, or the neighbor/dimmed distribution
  // shifted. We check the broader set.
  const szStateBefore = { hidden: hiddenBefore }
  const szStateAfter  = { hidden: hiddenAfter }
  const visibilityChanged = hiddenBefore !== hiddenAfter

  record(
    'TEST 6: Node visibility changes after wheel',
    visibilityChanged,
    `hidden before=${szStateBefore.hidden}, hidden after=${szStateAfter.hidden}`
  )

  // -----------------------------------------------------------------------
  // TEST 7: Background tap clears all sz- classes
  // -----------------------------------------------------------------------
  await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    // Emit tap on the core (background). When evt.target === cy the handler
    // calls clearSemanticZoom.
    cy.emit('tap')
  })

  await sleep(500)

  const szAfterClear = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    return cy.elements('.sz-focus, .sz-neighbor, .sz-dimmed, .sz-hidden, .sz-visible-edge').length
  })

  const indicatorGone = await page.evaluate(() => {
    return !document.querySelector('.sz-indicator')
  })

  record(
    'TEST 7: Background tap clears all sz- classes',
    szAfterClear === 0 && indicatorGone,
    `remaining sz- elements = ${szAfterClear}, indicator gone = ${indicatorGone}`
  )

  // -----------------------------------------------------------------------
  // TEST 8: Viewport stability after node tap (no shaking)
  // -----------------------------------------------------------------------
  // Re-enter semantic zoom by tapping a non-root node
  const tapResult2 = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    const nonRoot = cy.nodes().filter(n => !n.data('isRoot'))
    if (nonRoot.length === 0) return { ok: false, reason: 'no non-root nodes' }
    const target = nonRoot[0]
    target.emit('tap')
    return { ok: true, label: target.data('label') }
  })

  // Wait for ALL animations to fully complete (layout 400ms + debounce 150ms + fit 300ms + margin)
  await sleep(1500)

  if (!tapResult2.ok) {
    record('TEST 8: Viewport stable after node tap', false, tapResult2.reason)
  } else {
    // Sample viewport at two points separated by 500ms — if stable, they should match
    const snap1 = await page.evaluate(() => {
      const cy = document.querySelector('.graph-view')._cyreg.cy
      const p = cy.pan()
      return { px: Math.round(p.x * 100) / 100, py: Math.round(p.y * 100) / 100, z: Math.round(cy.zoom() * 1000) / 1000 }
    })

    await sleep(600)

    const snap2 = await page.evaluate(() => {
      const cy = document.querySelector('.graph-view')._cyreg.cy
      const p = cy.pan()
      return { px: Math.round(p.x * 100) / 100, py: Math.round(p.y * 100) / 100, z: Math.round(cy.zoom() * 1000) / 1000 }
    })

    const panDrift = Math.abs(snap1.px - snap2.px) + Math.abs(snap1.py - snap2.py)
    const zoomDrift = Math.abs(snap1.z - snap2.z)
    const isStable = panDrift < 1 && zoomDrift < 0.01

    record(
      'TEST 8: Viewport stable after node tap',
      isStable,
      `snap1=(${snap1.px},${snap1.py},z${snap1.z}) snap2=(${snap2.px},${snap2.py},z${snap2.z}) drift=pan:${panDrift.toFixed(2)},zoom:${zoomDrift.toFixed(4)}`
    )
  }

  // -----------------------------------------------------------------------
  // TEST 9: Viewport stability after rapid wheel events (no shaking)
  // -----------------------------------------------------------------------
  // Send 5 rapid wheel events
  await page.evaluate(() => {
    const container = document.querySelector('.graph-view')
    for (let i = 0; i < 5; i++) {
      container.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
      )
    }
  })

  // Wait for debounce (150ms) + fit animation (300ms) + margin
  await sleep(1000)

  const wSnap1 = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    const p = cy.pan()
    return { px: Math.round(p.x * 100) / 100, py: Math.round(p.y * 100) / 100, z: Math.round(cy.zoom() * 1000) / 1000 }
  })

  await sleep(600)

  const wSnap2 = await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    const p = cy.pan()
    return { px: Math.round(p.x * 100) / 100, py: Math.round(p.y * 100) / 100, z: Math.round(cy.zoom() * 1000) / 1000 }
  })

  const wPanDrift = Math.abs(wSnap1.px - wSnap2.px) + Math.abs(wSnap1.py - wSnap2.py)
  const wZoomDrift = Math.abs(wSnap1.z - wSnap2.z)
  const wIsStable = wPanDrift < 1 && wZoomDrift < 0.01

  record(
    'TEST 9: Viewport stable after rapid wheel',
    wIsStable,
    `snap1=(${wSnap1.px},${wSnap1.py},z${wSnap1.z}) snap2=(${wSnap2.px},${wSnap2.py},z${wSnap2.z}) drift=pan:${wPanDrift.toFixed(2)},zoom:${wZoomDrift.toFixed(4)}`
  )

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  printSummary()
  await cleanup()
}

function printSummary() {
  console.log('\n========================================')
  console.log('            TEST SUMMARY')
  console.log('========================================\n')

  let passed = 0
  let failed = 0
  for (const r of results) {
    const tag = r.passed ? 'PASS' : 'FAIL'
    console.log(`  [${tag}] ${r.name}`)
    if (r.passed) passed++
    else failed++
  }

  console.log(`\n  ${passed} passed, ${failed} failed, ${results.length} total\n`)

  if (failed > 0) {
    console.log('  Some tests FAILED.\n')
  } else {
    console.log('  All tests PASSED.\n')
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

process.on('SIGINT', async () => {
  console.log('\nInterrupted. Cleaning up...')
  await cleanup()
  process.exit(130)
})

process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(143)
})

process.on('unhandledRejection', async (err) => {
  console.error('\nUnhandled rejection:', err)
  await cleanup()
  process.exit(1)
})

run().catch(async (err) => {
  console.error('\nFatal error:', err)
  await cleanup()
  process.exit(1)
})
