/**
 * Wikidata SPARQL API から音楽アーティストの影響関係 (P737) を取得する
 * 2段階クエリ: 1) 影響関係を取得 → 2) アーティスト詳細を取得
 *
 * 使い方:
 *   node scripts/fetch-wikidata.js
 *
 * 出力:
 *   scripts/output/wikidata-artists.json
 *   scripts/output/wikidata-influences.json
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(__dirname, 'output')

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql'

// Step 1: 影響関係のみを取得（軽量 — 職業フィルタなしで取得し、後でフィルタ）
const QUERY_INFLUENCES = `
SELECT ?artist ?artistLabel ?influencer ?influencerLabel
WHERE {
  ?artist wdt:P737 ?influencer .
  ?artist wdt:P31 wd:Q5 .
  ?influencer wdt:P31 wd:Q5 .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 2000
`

// Step 2: アーティストIDリストから詳細を取得
function queryArtistDetails(ids) {
  const values = ids.map((id) => `wd:${id}`).join(' ')
  return `
SELECT ?item ?itemLabel ?itemLabelJa ?birth ?death ?image
WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P569 ?birth . }
  OPTIONAL { ?item wdt:P570 ?death . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item rdfs:label ?itemLabelJa FILTER(LANG(?itemLabelJa) = "ja") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`
}

async function fetchSparqlCSV(query, label) {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}`
  console.log(`${label}...`)

  const res = await fetch(url, {
    headers: {
      Accept: 'text/csv',
      'User-Agent': 'InfluenceMap/1.0 (mailto:contact@influence-map.app)',
    },
  })

  if (!res.ok) {
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText}`)
  }

  const text = await res.text()
  const lines = text.split('\n').filter((l) => l.trim())
  const headers = lines[0].split(',')

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length !== headers.length) continue
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]
    }
    rows.push(row)
  }

  return rows
}

function parseCSVLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        values.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  values.push(current)
  return values
}

function extractId(uri) {
  return uri?.value?.split('/').pop() || null
}

function extractYear(dateStr) {
  if (!dateStr?.value) return null
  const match = dateStr.value.match(/^-?(\d{4})/)
  return match ? parseInt(match[1]) : null
}

async function main() {
  try {
    // Step 1: 影響関係を取得
    const infBindings = await fetchSparqlCSV(QUERY_INFLUENCES, 'Step 1: 影響関係を取得中')
    console.log(`  ${infBindings.length} 件の結果`)

    // アーティストIDと影響関係を収集
    const artistIds = new Set()
    const influences = []
    const nameMap = new Map()
    const seenInfluences = new Set()

    for (const row of infBindings) {
      // CSV形式ではURIがそのまま返る
      const artistId = extractId({ value: row.artist })
      const influencerId = extractId({ value: row.influencer })
      if (!artistId || !influencerId) continue
      if (!artistId.startsWith('Q') || !influencerId.startsWith('Q')) continue

      artistIds.add(artistId)
      artistIds.add(influencerId)

      if (row.artistLabel) nameMap.set(artistId, row.artistLabel)
      if (row.influencerLabel) nameMap.set(influencerId, row.influencerLabel)

      const key = `${influencerId}->${artistId}`
      if (!seenInfluences.has(key)) {
        seenInfluences.add(key)
        influences.push({
          influencer_wikidata_id: influencerId,
          influenced_wikidata_id: artistId,
          influence_type: 'musical',
          trust_level: 'wikidata',
        })
      }
    }

    console.log(`  ユニークアーティスト: ${artistIds.size} 人`)
    console.log(`  ユニーク影響関係: ${influences.length} 件`)

    // Step 2: アーティスト詳細を取得（バッチ）
    const allIds = [...artistIds]
    const artistsMap = new Map()
    const BATCH = 200

    for (let i = 0; i < allIds.length; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH)
      const detailBindings = await fetchSparqlCSV(
        queryArtistDetails(batch),
        `Step 2: アーティスト詳細 ${i + 1}-${Math.min(i + BATCH, allIds.length)}/${allIds.length}`
      )

      for (const row of detailBindings) {
        const id = extractId({ value: row.item })
        if (!id) continue

        if (!artistsMap.has(id)) {
          artistsMap.set(id, {
            wikidata_id: id,
            name: row.itemLabel || nameMap.get(id) || id,
            name_ja: row.itemLabelJa || null,
            birth_year: extractYear({ value: row.birth }),
            death_year: extractYear({ value: row.death }),
            image_url: row.image || null,
            genres: [],
          })
        }
      }

      // 詳細が取れなかったアーティストも名前だけで追加
      for (const id of batch) {
        if (!artistsMap.has(id)) {
          artistsMap.set(id, {
            wikidata_id: id,
            name: nameMap.get(id) || id,
            name_ja: null,
            birth_year: null,
            death_year: null,
            image_url: null,
            genres: [],
          })
        }
      }

      // レート制限対策
      if (i + BATCH < allIds.length) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    const artists = [...artistsMap.values()]
    console.log(`\n最終結果: ${artists.length} アーティスト, ${influences.length} 影響関係`)

    mkdirSync(OUTPUT_DIR, { recursive: true })
    writeFileSync(join(OUTPUT_DIR, 'wikidata-artists.json'), JSON.stringify(artists, null, 2))
    writeFileSync(join(OUTPUT_DIR, 'wikidata-influences.json'), JSON.stringify(influences, null, 2))

    console.log(`\n出力先: ${OUTPUT_DIR}`)
    console.log('  - wikidata-artists.json')
    console.log('  - wikidata-influences.json')
  } catch (err) {
    console.error('エラー:', err.message)
    process.exit(1)
  }
}

main()
