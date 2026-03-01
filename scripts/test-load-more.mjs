/**
 * test-load-more.mjs
 *
 * E2E test for the "Load More" (もっと読み込む) feature.
 * Verifies that:
 *   1. The load-more bar appears when an artist has >15 connections
 *   2. Clicking load-more adds more nodes to the graph
 *   3. The counts update correctly after loading
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BOB_DYLAN_URL =
  'http://localhost:5174/artist/515e6290-f7e0-443b-85a4-a7bceed6e261'

let viteProcess = null
let browser = null
const results = []

function record(name, passed, detail = '') {
  results.push({ name, passed, detail })
  const tag = passed ? 'PASS' : 'FAIL'
  const msg = detail ? ` -- ${detail}` : ''
  console.log(`  [${tag}] ${name}${msg}`)
}

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
      if (!resolved) { resolved = true; reject(new Error('Vite timeout')) }
    }, 30_000)
    const onData = (chunk) => {
      const text = chunk.toString()
      process.stdout.write(text)
      if (!resolved && text.replace(/\x1b\[[0-9;]*m/g, '').includes('localhost:5174')) {
        resolved = true
        clearTimeout(timer)
        setTimeout(() => resolve(), 1000)
      }
    }
    viteProcess.stdout.on('data', onData)
    viteProcess.stderr.on('data', onData)
    viteProcess.on('error', (err) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(err) } })
  })
}

async function cleanup() {
  if (browser) { try { await browser.close() } catch {} browser = null }
  if (viteProcess) {
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(viteProcess.pid), '/T', '/F'], { stdio: 'ignore', shell: true }) } catch {}
    } else {
      try { viteProcess.kill('SIGTERM') } catch {}
    }
    viteProcess = null
  }
}

async function run() {
  const puppeteer = (await import('puppeteer')).default

  console.log('\n--- Starting Vite dev server ---\n')
  await startVite()
  console.log('\n--- Vite is ready ---\n')

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  console.log(`Navigating to: ${BOB_DYLAN_URL}\n`)
  await page.goto(BOB_DYLAN_URL, { waitUntil: 'networkidle2', timeout: 30_000 })
  await page.waitForSelector('.graph-view', { timeout: 15_000 })
  try { await page.waitForSelector('.graph-loading', { hidden: true, timeout: 10_000 }) } catch {}

  console.log('Waiting 5s for graph to settle...\n')
  await sleep(5_000)

  // -----------------------------------------------------------------------
  // TEST 1: Load-more bar appears after initial load (root has >15 connections)
  // -----------------------------------------------------------------------
  console.log('--- Running tests ---\n')

  const initialState = await page.evaluate(() => {
    const loadMoreBar = document.querySelector('.load-more-bar')
    const btns = loadMoreBar ? loadMoreBar.querySelectorAll('.load-more-btn') : []
    return {
      barVisible: !!loadMoreBar,
      buttonCount: btns.length,
      buttonTexts: Array.from(btns).map(b => b.textContent.trim()),
    }
  })

  record(
    'TEST 1: Load-more bar visible after root load',
    initialState.barVisible && initialState.buttonCount > 0,
    `bar=${initialState.barVisible}, buttons=${initialState.buttonCount}, texts=${JSON.stringify(initialState.buttonTexts)}`
  )

  // -----------------------------------------------------------------------
  // TEST 2: Button shows correct loaded/total counts
  // -----------------------------------------------------------------------
  const countsMatch = await page.evaluate(() => {
    const btns = document.querySelectorAll('.load-more-btn')
    // Check that at least one button has a "15/X" pattern where X > 15
    for (const btn of btns) {
      const text = btn.textContent
      const match = text.match(/(\d+)\/(\d+)/)
      if (match) {
        const loaded = parseInt(match[1])
        const total = parseInt(match[2])
        if (loaded === 15 && total > 15) return { ok: true, loaded, total, text: text.trim() }
      }
    }
    return { ok: false, texts: Array.from(btns).map(b => b.textContent.trim()) }
  })

  record(
    'TEST 2: Button shows 15/total count',
    countsMatch.ok,
    countsMatch.ok
      ? `${countsMatch.loaded}/${countsMatch.total} found in "${countsMatch.text}"`
      : `no matching pattern, texts=${JSON.stringify(countsMatch.texts)}`
  )

  // -----------------------------------------------------------------------
  // TEST 3: Clicking load-more adds nodes to the graph
  // -----------------------------------------------------------------------
  const nodesBefore = await page.evaluate(() => {
    return document.querySelector('.graph-view')._cyreg.cy.nodes().length
  })

  // Click the first load-more button
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('.load-more-btn')
    if (!btn) return false
    btn.click()
    return true
  })

  if (!clicked) {
    record('TEST 3: Load-more adds nodes', false, 'no button to click')
  } else {
    // Wait for data to load and layout to finish
    await sleep(3_000)

    const nodesAfter = await page.evaluate(() => {
      return document.querySelector('.graph-view')._cyreg.cy.nodes().length
    })

    record(
      'TEST 3: Load-more adds nodes',
      nodesAfter > nodesBefore,
      `before=${nodesBefore}, after=${nodesAfter}, added=${nodesAfter - nodesBefore}`
    )
  }

  // -----------------------------------------------------------------------
  // TEST 4: Counts update after loading more
  // -----------------------------------------------------------------------
  const updatedCounts = await page.evaluate(() => {
    const btns = document.querySelectorAll('.load-more-btn')
    const counts = []
    for (const btn of btns) {
      const match = btn.textContent.match(/(\d+)\/(\d+)/)
      if (match) counts.push({ loaded: parseInt(match[1]), total: parseInt(match[2]) })
    }
    return counts
  })

  const hasUpdated = updatedCounts.some(c => c.loaded > 15)
  record(
    'TEST 4: Counts update after load-more',
    hasUpdated,
    `counts=${JSON.stringify(updatedCounts)}`
  )

  // -----------------------------------------------------------------------
  // TEST 5: Background tap hides load-more bar
  // -----------------------------------------------------------------------
  await page.evaluate(() => {
    const cy = document.querySelector('.graph-view')._cyreg.cy
    cy.emit('tap')
  })
  await sleep(500)

  const barGone = await page.evaluate(() => {
    return !document.querySelector('.load-more-bar')
  })

  record(
    'TEST 5: Background tap hides load-more bar',
    barGone,
    `bar gone = ${barGone}`
  )

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n========================================')
  console.log('         LOAD MORE TEST SUMMARY')
  console.log('========================================\n')

  let passed = 0, failed = 0
  for (const r of results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}`)
    if (r.passed) passed++; else failed++
  }
  console.log(`\n  ${passed} passed, ${failed} failed, ${results.length} total\n`)
  if (failed > 0) console.log('  Some tests FAILED.\n')
  else console.log('  All tests PASSED.\n')

  await cleanup()
  process.exit(failed > 0 ? 1 : 0)
}

process.on('SIGINT', async () => { await cleanup(); process.exit(130) })
process.on('unhandledRejection', async (err) => { console.error(err); await cleanup(); process.exit(1) })
run().catch(async (err) => { console.error(err); await cleanup(); process.exit(1) })
