/**
 * Classify artists using Wikidata occupations (P106)
 * - Tags musicians vs non-musicians (philosophers, writers, etc.)
 * - Updates genres field in Supabase
 * - Fixes influence_type for non-musician influences to 'philosophical'
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'

// Wikidata occupation IDs that indicate musicians
const MUSICIAN_OCCUPATIONS = new Set([
  'Q177220',  // singer
  'Q639669',  // musician
  'Q36834',   // composer
  'Q753110',  // songwriter
  'Q488205',  // singer-songwriter
  'Q855091',  // guitarist
  'Q386854',  // rapper
  'Q130857',  // DJ
  'Q855091',  // guitarist
  'Q584301',  // pianist
  'Q806349',  // bandleader
  'Q183945',  // record producer
  'Q2252262', // conductor
  'Q1028181', // drummer
  'Q158852',  // bass guitarist
  'Q11063',   // astronomer (not music, but sometimes classified)
  'Q486748',  // multi-instrumentalist
  'Q27939',   // opera singer
  'Q2865819', // violinist
  'Q2643890', // cellist
  'Q2405480', // saxophonist
  'Q11774202', // trumpeter
  'Q855091',  // guitarist
])

// Non-musician occupation categories
const PHILOSOPHER_OCCUPATIONS = new Set([
  'Q4964182', // philosopher
  'Q36180',   // writer
  'Q482980',  // author
  'Q49757',   // poet
  'Q1930187', // journalist
  'Q28389',   // screenwriter
  'Q37226',   // teacher
  'Q1622272', // university teacher
  'Q593644',  // chemist
  'Q169470',  // physicist
  'Q901',     // scientist
  'Q82955',   // politician
  'Q131524',  // entrepreneur
  'Q15949613', // short story writer
  'Q6625963', // novelist
  'Q214917',  // playwright
  'Q1234',    // statesman
  'Q3455803', // historian
])

async function fetchOccupations(wikidataIds) {
  // Query Wikidata SPARQL for occupations
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT ?item ?occupation WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P106 ?occupation .
    }
  `

  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'InfluenceMap/1.0 (music research)' }
  })

  if (!res.ok) {
    console.error(`SPARQL error: ${res.status}`)
    return {}
  }

  const data = await res.json()
  const occupations = {}

  for (const binding of data.results.bindings) {
    const wikidataId = binding.item.value.split('/').pop()
    const occupationId = binding.occupation.value.split('/').pop()

    if (!occupations[wikidataId]) occupations[wikidataId] = []
    occupations[wikidataId].push(occupationId)
  }

  return occupations
}

function classifyArtist(occupationIds) {
  if (!occupationIds || occupationIds.length === 0) return 'unknown'

  const isMusician = occupationIds.some(id => MUSICIAN_OCCUPATIONS.has(id))
  if (isMusician) return 'musician'

  const isPhilosopher = occupationIds.some(id => PHILOSOPHER_OCCUPATIONS.has(id))
  if (isPhilosopher) return 'non-musician'

  return 'unknown'
}

async function main() {
  // 1. Fetch all artists with wikidata_id
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, wikidata_id, genres')
    .not('wikidata_id', 'is', null)

  if (error || !artists) {
    console.error('Failed to fetch artists:', error)
    return
  }

  console.log(`Total artists with wikidata_id: ${artists.length}`)

  // 2. Process in batches (SPARQL has query length limits)
  const BATCH_SIZE = 100
  const artistMap = {}
  for (const a of artists) {
    if (a.wikidata_id) artistMap[a.wikidata_id] = a
  }

  const allWikidataIds = Object.keys(artistMap)
  const allOccupations = {}

  for (let i = 0; i < allWikidataIds.length; i += BATCH_SIZE) {
    const batch = allWikidataIds.slice(i, i + BATCH_SIZE)
    console.log(`Fetching occupations batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(allWikidataIds.length/BATCH_SIZE)}...`)

    const occupations = await fetchOccupations(batch)
    Object.assign(allOccupations, occupations)

    // Rate limit
    if (i + BATCH_SIZE < allWikidataIds.length) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // 3. Classify each artist
  let musicians = 0
  let nonMusicians = 0
  let unknowns = 0
  const nonMusicianIds = new Set()

  const updates = []

  for (const [wikidataId, artist] of Object.entries(artistMap)) {
    const category = classifyArtist(allOccupations[wikidataId])

    if (category === 'musician') {
      musicians++
    } else if (category === 'non-musician') {
      nonMusicians++
      nonMusicianIds.add(artist.id)
      // Tag non-musicians with a genre marker
      updates.push({
        id: artist.id,
        genres: ['non-music'],
      })
      console.log(`  Non-musician: ${artist.name}`)
    } else {
      unknowns++
    }
  }

  console.log(`\nClassification results:`)
  console.log(`  Musicians: ${musicians}`)
  console.log(`  Non-musicians: ${nonMusicians}`)
  console.log(`  Unknown: ${unknowns}`)

  // 4. Update genres for non-musicians
  if (updates.length > 0) {
    console.log(`\nUpdating ${updates.length} non-musicians in DB...`)
    for (const upd of updates) {
      const { error: updErr } = await supabase
        .from('artists')
        .update({ genres: upd.genres })
        .eq('id', upd.id)

      if (updErr) console.error(`  Failed to update ${upd.id}:`, updErr)
    }
    console.log('Done updating genres.')
  }

  // 5. Fix influence_type for non-musician <-> non-musician influences
  if (nonMusicianIds.size > 0) {
    const nmIds = [...nonMusicianIds]
    console.log(`\nFixing influence_type for non-musician influences...`)

    // Get all influences where both sides are non-musicians
    const { data: influences } = await supabase
      .from('influences')
      .select('id, influencer_id, influenced_id, influence_type')
      .in('influencer_id', nmIds)

    if (influences) {
      const toFix = influences.filter(inf =>
        nonMusicianIds.has(inf.influenced_id) && inf.influence_type === 'musical'
      )

      console.log(`  Found ${toFix.length} non-musician influences to fix to 'philosophical'`)

      for (const inf of toFix) {
        await supabase
          .from('influences')
          .update({ influence_type: 'philosophical' })
          .eq('id', inf.id)
      }

      // Also fix influences FROM non-musicians TO non-musicians (other direction)
      const { data: influences2 } = await supabase
        .from('influences')
        .select('id, influencer_id, influenced_id, influence_type')
        .in('influenced_id', nmIds)

      if (influences2) {
        const toFix2 = influences2.filter(inf =>
          nonMusicianIds.has(inf.influencer_id) && inf.influence_type === 'musical'
        )

        console.log(`  Found ${toFix2.length} additional non-musician influences to fix`)

        for (const inf of toFix2) {
          await supabase
            .from('influences')
            .update({ influence_type: 'philosophical' })
            .eq('id', inf.id)
        }
      }
    }

    console.log('Done fixing influence types.')
  }

  console.log('\nAll done!')
}

main().catch(console.error)
