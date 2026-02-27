/**
 * Supabase の artists テーブルで name_ja が NULL のアーティストに対して
 * Wikidata SPARQL から日本語ラベルを取得して更新する
 *
 * 使い方:
 *   node scripts/fix-japanese-names.js
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: VITE_SUPABASE_URL と SUPABASE_SERVICE_KEY を .env に設定してください')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql'
const BATCH_SIZE = 10
const RATE_LIMIT_MS = 1000

/**
 * Wikidata SPARQL で複数エンティティの日本語ラベルを取得する
 */
async function fetchJapaneseLabels(wikidataIds) {
  const values = wikidataIds.map((id) => `wd:${id}`).join(' ')
  const query = `
SELECT ?item ?label WHERE {
  VALUES ?item { ${values} }
  ?item rdfs:label ?label .
  FILTER(LANG(?label) = "ja")
}
`

  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'InfluenceMap/1.0 (mailto:contact@influence-map.app)',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`)
  }

  const json = await res.json()
  const labelMap = new Map()

  for (const binding of json.results.bindings) {
    const wikidataId = binding.item.value.split('/').pop()
    const label = binding.label.value
    labelMap.set(wikidataId, label)
  }

  return labelMap
}

async function main() {
  console.log('name_ja が NULL のアーティストを取得中...')

  // Query all artists where name_ja is NULL and wikidata_id is not NULL
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, wikidata_id')
    .is('name_ja', null)
    .not('wikidata_id', 'is', null)

  if (error) {
    console.error('Supabase クエリエラー:', error.message)
    process.exit(1)
  }

  console.log(`対象アーティスト: ${artists.length} 人`)

  if (artists.length === 0) {
    console.log('更新対象がありません。')
    return
  }

  let totalUpdated = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(artists.length / BATCH_SIZE)

    console.log(`\nバッチ ${batchNum}/${totalBatches}: ${batch.length} 件を処理中...`)

    const wikidataIds = batch.map((a) => a.wikidata_id)

    try {
      const labelMap = await fetchJapaneseLabels(wikidataIds)

      for (const artist of batch) {
        const jaName = labelMap.get(artist.wikidata_id)
        if (jaName) {
          const { error: updateError } = await supabase
            .from('artists')
            .update({ name_ja: jaName })
            .eq('id', artist.id)

          if (updateError) {
            console.error(`  ✗ ${artist.name} (${artist.wikidata_id}): 更新エラー - ${updateError.message}`)
            totalErrors++
          } else {
            console.log(`  ✓ ${artist.name} → ${jaName}`)
            totalUpdated++
          }
        } else {
          console.log(`  - ${artist.name} (${artist.wikidata_id}): 日本語ラベルなし`)
          totalSkipped++
        }
      }
    } catch (err) {
      console.error(`  バッチエラー: ${err.message}`)
      totalErrors += batch.length
    }

    // Rate limiting: wait between batches
    if (i + BATCH_SIZE < artists.length) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS))
    }
  }

  console.log('\n===== 結果 =====')
  console.log(`更新成功: ${totalUpdated} 件`)
  console.log(`日本語ラベルなし: ${totalSkipped} 件`)
  console.log(`エラー: ${totalErrors} 件`)
  console.log(`合計処理: ${artists.length} 件`)
}

main()
