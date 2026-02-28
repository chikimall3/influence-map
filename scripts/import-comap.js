/**
 * COMAP (ICM 2021 Problem D) データセットを Supabase にインポートする
 *
 * データソース: AllMusic + Spotify (42,770件の影響関係、5,854アーティスト)
 *
 * 使い方:
 *   1. .env に VITE_SUPABASE_URL と SUPABASE_SERVICE_KEY を設定
 *   2. data/influence_data.csv を配置
 *   3. node scripts/import-comap.js
 *
 * 動作:
 *   - 既存アーティストを名前で照合し、一致すれば既存レコードを使用
 *   - 一致しなければ新規アーティストを作成
 *   - 影響関係を trust_level='expert_db' でインポート
 *   - 既存の影響関係 (同じ influencer_id + influenced_id + influence_type) はスキップ
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const CSV_PATH = join(__dirname, '..', 'data', 'influence_data.csv')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: VITE_SUPABASE_URL と SUPABASE_SERVICE_KEY を .env に設定してください')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const BATCH_SIZE = 100

// ジャンルをDBのgenres配列形式にマッピング
function mapGenre(comapGenre) {
  if (!comapGenre || comapGenre === 'Unknown') return []
  // COMAP uses broad categories like "Pop/Rock", "R&B", "Electronic", etc.
  const mapping = {
    'Pop/Rock': ['pop', 'rock'],
    'R&B': ['r&b'],
    'Electronic': ['electronic'],
    'Jazz': ['jazz'],
    'Country': ['country'],
    'Latin': ['latin'],
    'Rap': ['hip hop'],
    'Blues': ['blues'],
    'Reggae': ['reggae'],
    'Folk': ['folk'],
    'New Age': ['new age'],
    'Classical': ['classical'],
    'Comedy/Spoken': ['comedy'],
    'Vocal': ['vocal'],
    'Religious': ['religious'],
    'Stage & Screen': ['soundtrack'],
    'International': ['world'],
    'Children\'s': ['children'],
    'Easy Listening': ['easy listening'],
    'Avant-Garde': ['avant-garde'],
  }
  return mapping[comapGenre] || [comapGenre.toLowerCase()]
}

// 活動開始年代から推定birth_yearを算出 (活動開始-20歳と仮定)
function estimateBirthYear(activeStart) {
  if (!activeStart) return null
  const year = parseInt(activeStart)
  if (isNaN(year)) return null
  return year - 20
}

function parseCSV(content) {
  const lines = content.trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map(line => {
    // Handle CSV fields (simple - no quoted commas in this dataset)
    const vals = line.split(',')
    const row = {}
    header.forEach((col, i) => {
      row[col.trim()] = vals[i]?.trim() || ''
    })
    return row
  })
}

async function run() {
  console.log('=== COMAP データセット インポート ===\n')

  // 1. CSVを読み込み
  const csv = readFileSync(CSV_PATH, 'utf-8')
  const rows = parseCSV(csv)
  console.log(`CSV読み込み: ${rows.length} 行\n`)

  // 2. ユニークアーティストを抽出
  const artistMap = new Map() // comapId -> { name, genre, activeStart }
  for (const row of rows) {
    if (!artistMap.has(row.influencer_id)) {
      artistMap.set(row.influencer_id, {
        name: row.influencer_name,
        genre: row.influencer_main_genre,
        activeStart: row.influencer_active_start,
      })
    }
    if (!artistMap.has(row.follower_id)) {
      artistMap.set(row.follower_id, {
        name: row.follower_name,
        genre: row.follower_main_genre,
        activeStart: row.follower_active_start,
      })
    }
  }
  console.log(`ユニークアーティスト: ${artistMap.size} 人\n`)

  // 3. 既存アーティストを名前で取得
  console.log('既存アーティストを取得中...')
  const { data: existingArtists, error: fetchErr } = await supabase
    .from('artists')
    .select('id, name')

  if (fetchErr) {
    console.error('既存アーティスト取得エラー:', fetchErr.message)
    process.exit(1)
  }

  // 名前 -> UUID のマッピング (大文字小文字を正規化)
  const nameToUuid = new Map()
  for (const a of existingArtists) {
    nameToUuid.set(a.name.toLowerCase(), a.id)
  }
  console.log(`既存アーティスト: ${existingArtists.length} 人\n`)

  // 4. 新規アーティストを特定・作成
  const comapIdToUuid = new Map() // comapId -> supabase UUID
  const newArtists = []

  for (const [comapId, info] of artistMap) {
    const existingId = nameToUuid.get(info.name.toLowerCase())
    if (existingId) {
      comapIdToUuid.set(comapId, existingId)
    } else {
      newArtists.push({ comapId, ...info })
    }
  }

  const matchedCount = artistMap.size - newArtists.length
  console.log(`既存アーティストと照合: ${matchedCount} 人`)
  console.log(`新規アーティスト: ${newArtists.length} 人\n`)

  // 新規アーティストをバッチ挿入
  if (newArtists.length > 0) {
    console.log('新規アーティストをインポート中...')
    for (let i = 0; i < newArtists.length; i += BATCH_SIZE) {
      const batch = newArtists.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('artists')
        .insert(
          batch.map(a => ({
            name: a.name,
            genres: mapGenre(a.genre),
            birth_year: estimateBirthYear(a.activeStart),
          }))
        )
        .select('id, name')

      if (error) {
        console.error(`  バッチ ${i}-${i + BATCH_SIZE} エラー:`, error.message)
      } else {
        for (let j = 0; j < data.length; j++) {
          comapIdToUuid.set(batch[j].comapId, data[j].id)
          nameToUuid.set(data[j].name.toLowerCase(), data[j].id)
        }
      }
      process.stdout.write(`  ${Math.min(i + BATCH_SIZE, newArtists.length)}/${newArtists.length}\r`)
    }
    console.log(`\n新規アーティスト完了: ${comapIdToUuid.size - matchedCount} 件\n`)
  }

  // 5. 影響関係をインポート
  console.log('影響関係をインポート中...')
  let imported = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const infRows = batch
      .map(row => {
        const influencerId = comapIdToUuid.get(row.influencer_id)
        const influencedId = comapIdToUuid.get(row.follower_id)
        if (!influencerId || !influencedId) return null
        if (influencerId === influencedId) return null // self-influence
        return {
          influencer_id: influencerId,
          influenced_id: influencedId,
          influence_type: 'musical',
          trust_level: 'expert_db',
        }
      })
      .filter(Boolean)

    if (infRows.length === 0) {
      skipped += batch.length
      continue
    }

    const { error } = await supabase
      .from('influences')
      .upsert(infRows, {
        onConflict: 'influencer_id,influenced_id,influence_type',
      })

    if (error) {
      console.error(`  バッチ ${i} エラー:`, error.message)
      errors += infRows.length
    } else {
      imported += infRows.length
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`)
  }

  console.log(`\n影響関係完了: ${imported} 件 (スキップ: ${skipped}, エラー: ${errors})\n`)

  // 6. サマリー
  const { count: totalArtists } = await supabase
    .from('artists')
    .select('*', { count: 'exact', head: true })
  const { count: totalInfluences } = await supabase
    .from('influences')
    .select('*', { count: 'exact', head: true })

  console.log('=== インポート完了 ===')
  console.log(`  アーティスト合計: ${totalArtists} 人`)
  console.log(`  影響関係合計: ${totalInfluences} 件`)
}

run().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
