/**
 * Final classification: P106 (occupation) ONLY.
 * Reset all genres, then tag non-musicians based solely on occupation.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'

// Comprehensive music occupation IDs
const MUSIC_OCCUPATIONS = new Set([
  'Q177220',   // singer
  'Q639669',   // musician
  'Q36834',    // composer
  'Q753110',   // songwriter
  'Q488205',   // singer-songwriter
  'Q855091',   // guitarist
  'Q386854',   // rapper
  'Q130857',   // DJ
  'Q584301',   // pianist (as profession)
  'Q806349',   // bandleader
  'Q183945',   // record producer
  'Q2252262',  // conductor
  'Q1028181',  // drummer
  'Q158852',   // bass guitarist
  'Q486748',   // multi-instrumentalist
  'Q27939',    // opera singer
  'Q2865819',  // violinist
  'Q2643890',  // cellist
  'Q2405480',  // saxophonist
  'Q11774202', // trumpeter
  'Q15981151', // flautist
  'Q55960',    // tenor
  'Q4351403',  // soprano
  'Q10816969', // contralto
  'Q16145150', // baritone
  'Q2340047',  // mezzo-soprano
  'Q19546',    // organist
  'Q1198887',  // bass
  'Q3658608',  // music arranger
  'Q215380',   // film score composer
  'Q2259451',  // music director
  'Q18844224', // electronic musician
  'Q1075651',  // turntablist
  'Q2722764',  // harpist
  'Q15982858', // tuba player
  'Q3282637',  // accordionist
  'Q57231',    // singer (duplicate check)
  'Q4610556',  // choral conductor
  'Q66763670', // music pedagogue
  'Q1415090',  // music critic
  'Q3630699',  // mandolinist
  'Q765778',   // trombonist
  'Q16323111', // percussionist
  'Q12800682', // clarinetist
  'Q18545066', // oboist
  'Q1259917',  // harpsichordist
  'Q43343',    // music teacher
  'Q18814623', // horn player
  'Q5371902',  // blues musician
  'Q8341764',  // jazz musician
  'Q28018112', // rock musician
  'Q639669',   // musician (general)
])

async function fetchOccupations(wikidataIds) {
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT ?item ?occ WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P106 ?occ .
    }
  `
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'InfluenceMap/1.0 (music research)' }
  })

  if (!res.ok) return {}

  const data = await res.json()
  const result = {}

  for (const b of data.results.bindings) {
    const wdId = b.item.value.split('/').pop()
    const occId = b.occ.value.split('/').pop()
    if (!result[wdId]) result[wdId] = []
    result[wdId].push(occId)
  }
  return result
}

async function main() {
  // 1. Reset ALL genres to empty first
  console.log('Resetting all genres...')
  const { error: resetErr } = await supabase
    .from('artists')
    .update({ genres: [] })
    .not('id', 'is', null) // match all

  if (resetErr) console.error('Reset error:', resetErr)

  // 2. Fetch all artists
  const { data: artists } = await supabase
    .from('artists')
    .select('id, name, wikidata_id')
    .not('wikidata_id', 'is', null)

  console.log(`Artists with wikidata_id: ${artists.length}`)

  const artistMap = {}
  for (const a of artists) artistMap[a.wikidata_id] = a

  const allIds = Object.keys(artistMap)
  const musicianWdIds = new Set()

  // 3. Check P106 in batches
  const BATCH = 80
  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH)
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allIds.length/BATCH)}...`)

    const occs = await fetchOccupations(batch)
    for (const [wdId, occList] of Object.entries(occs)) {
      if (occList.some(o => MUSIC_OCCUPATIONS.has(o))) {
        musicianWdIds.add(wdId)
      }
    }

    if (i + BATCH < allIds.length) await new Promise(r => setTimeout(r, 2000))
  }

  console.log(`\nMusicians by P106: ${musicianWdIds.size}`)

  // 4. Tag non-musicians
  const nonMusicians = []
  for (const [wdId, artist] of Object.entries(artistMap)) {
    if (!musicianWdIds.has(wdId)) {
      nonMusicians.push(artist)
    }
  }

  console.log(`Non-musicians to tag: ${nonMusicians.length}`)

  // Sample
  const sample = nonMusicians.slice(0, 20).map(a => a.name)
  console.log('Sample:', sample.join(', '))

  // Update in DB
  const nmIds = nonMusicians.map(a => a.id)
  for (let i = 0; i < nmIds.length; i += 50) {
    const batch = nmIds.slice(i, i + 50)
    for (const id of batch) {
      await supabase
        .from('artists')
        .update({ genres: ['non-music'] })
        .eq('id', id)
    }
  }

  console.log('Tagged non-musicians.')

  // 5. Fix influence types
  let allInf = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('influences')
      .select('id, influencer_id, influenced_id, influence_type')
      .eq('influence_type', 'musical')
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    allInf = allInf.concat(data)
    offset += 1000
  }

  const nmSet = new Set(nmIds)
  const toFix = allInf.filter(inf =>
    nmSet.has(inf.influencer_id) && nmSet.has(inf.influenced_id)
  )

  console.log(`Fixing ${toFix.length} influence types...`)
  for (const inf of toFix) {
    await supabase
      .from('influences')
      .update({ influence_type: 'philosophical' })
      .eq('id', inf.id)
  }

  // Verify
  const { data: verify } = await supabase
    .from('artists')
    .select('name, genres')
    .in('name', ['Friedrich Nietzsche', 'Immanuel Kant', 'Marcel Proust', 'Aristotle', 'Bob Dylan', 'Jimi Hendrix'])

  console.log('\nVerification:')
  verify?.forEach(a => console.log(`  ${a.name}: ${JSON.stringify(a.genres)}`))

  console.log('\nDone!')
}

main().catch(console.error)
