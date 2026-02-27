/**
 * Fix influence_type for non-musician influences.
 * Any influence where BOTH influencer AND influenced are non-musicians
 * should be 'philosophical' instead of 'musical'.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function main() {
  // 1. Get all non-musician artist IDs
  const { data: nonMusicians, error } = await supabase
    .from('artists')
    .select('id, name')
    .contains('genres', ['non-music'])

  if (error) {
    console.error('Failed to fetch non-musicians:', error)
    return
  }

  console.log(`Non-musicians in DB: ${nonMusicians.length}`)
  const nonMusicianIds = new Set(nonMusicians.map(a => a.id))

  // 2. Fetch ALL influences with influence_type = 'musical'
  let allInfluences = []
  let offset = 0
  const BATCH = 1000

  while (true) {
    const { data, error: fetchErr } = await supabase
      .from('influences')
      .select('id, influencer_id, influenced_id, influence_type')
      .eq('influence_type', 'musical')
      .range(offset, offset + BATCH - 1)

    if (fetchErr) {
      console.error('Fetch error:', fetchErr)
      break
    }

    if (!data || data.length === 0) break
    allInfluences = allInfluences.concat(data)
    offset += BATCH
    console.log(`Fetched ${allInfluences.length} musical influences...`)
  }

  console.log(`Total musical influences: ${allInfluences.length}`)

  // 3. Find influences where BOTH sides are non-musicians
  const toFix = allInfluences.filter(inf =>
    nonMusicianIds.has(inf.influencer_id) && nonMusicianIds.has(inf.influenced_id)
  )

  console.log(`Influences to fix (both non-musicians): ${toFix.length}`)

  // Also find where non-musician influences musician (should be 'philosophical' for philosophical influence)
  const nmToMusician = allInfluences.filter(inf =>
    nonMusicianIds.has(inf.influencer_id) && !nonMusicianIds.has(inf.influenced_id)
  )
  console.log(`Non-musician → musician influences: ${nmToMusician.length} (keeping as musical - these are cross-domain influences)`)

  // 4. Update in batches
  let updated = 0
  for (const inf of toFix) {
    const { error: updErr } = await supabase
      .from('influences')
      .update({ influence_type: 'philosophical' })
      .eq('id', inf.id)

    if (updErr) {
      console.error(`Failed to update ${inf.id}:`, updErr)
    } else {
      updated++
    }
  }

  console.log(`Updated ${updated}/${toFix.length} influences to 'philosophical'`)
  console.log('Done!')
}

main().catch(console.error)
