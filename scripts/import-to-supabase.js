/**
 * Wikidata から取得したデータを Supabase にインポートする
 *
 * 使い方:
 *   1. .env に VITE_SUPABASE_URL と SUPABASE_SERVICE_KEY を設定
 *   2. node scripts/fetch-wikidata.js を先に実行
 *   3. node scripts/import-to-supabase.js
 *
 * 注意: インポートには service_role key が必要（anon key では書き込み不可）
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'output')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: VITE_SUPABASE_URL と SUPABASE_SERVICE_KEY を .env に設定してください')
  console.error('SUPABASE_SERVICE_KEY は Supabase > Settings > API > service_role key から取得')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function importData() {
  // データ読み込み
  const artists = JSON.parse(readFileSync(join(DATA_DIR, 'wikidata-artists.json'), 'utf-8'))
  const influences = JSON.parse(readFileSync(join(DATA_DIR, 'wikidata-influences.json'), 'utf-8'))

  console.log(`読み込み: ${artists.length} アーティスト, ${influences.length} 影響関係`)

  // アーティストをバッチインポート
  console.log('\nアーティストをインポート中...')
  const BATCH_SIZE = 100
  const wikidataToUuid = new Map()

  for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('artists')
      .upsert(
        batch.map((a) => ({
          name: a.name,
          name_ja: a.name_ja,
          genres: a.genres,
          birth_year: a.birth_year,
          death_year: a.death_year,
          image_url: a.image_url,
          wikidata_id: a.wikidata_id,
        })),
        { onConflict: 'wikidata_id' }
      )
      .select('id, wikidata_id')

    if (error) {
      console.error(`  バッチ ${i}-${i + BATCH_SIZE} エラー:`, error.message)
    } else {
      for (const row of data) {
        wikidataToUuid.set(row.wikidata_id, row.id)
      }
      process.stdout.write(`  ${Math.min(i + BATCH_SIZE, artists.length)}/${artists.length}\r`)
    }
  }
  console.log(`\nアーティスト完了: ${wikidataToUuid.size} 件`)

  // 影響関係をバッチインポート
  console.log('\n影響関係をインポート中...')
  let importedInfluences = 0
  let skippedInfluences = 0

  for (let i = 0; i < influences.length; i += BATCH_SIZE) {
    const batch = influences.slice(i, i + BATCH_SIZE)
    const rows = batch
      .map((inf) => {
        const influencerId = wikidataToUuid.get(inf.influencer_wikidata_id)
        const influencedId = wikidataToUuid.get(inf.influenced_wikidata_id)
        if (!influencerId || !influencedId) return null
        return {
          influencer_id: influencerId,
          influenced_id: influencedId,
          influence_type: inf.influence_type,
          trust_level: inf.trust_level,
        }
      })
      .filter(Boolean)

    if (rows.length === 0) {
      skippedInfluences += batch.length
      continue
    }

    const { error } = await supabase
      .from('influences')
      .upsert(rows, {
        onConflict: 'influencer_id,influenced_id,influence_type',
      })

    if (error) {
      console.error(`  バッチ ${i}-${i + BATCH_SIZE} エラー:`, error.message)
      skippedInfluences += rows.length
    } else {
      importedInfluences += rows.length
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, influences.length)}/${influences.length}\r`)
  }
  console.log(`\n影響関係完了: ${importedInfluences} 件 (スキップ: ${skippedInfluences} 件)`)

  console.log('\nインポート完了!')
}

importData().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
