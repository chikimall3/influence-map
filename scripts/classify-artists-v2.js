/**
 * v2: Classify ALL artists using Wikidata P106 (occupation) + P136 (genre).
 * Strategy: If artist has ANY music genre or music occupation → musician.
 * Everyone else → non-music.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'

async function sparqlQuery(query) {
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'InfluenceMap/1.0 (music research)' }
  })
  if (!res.ok) {
    console.error(`SPARQL error: ${res.status} ${await res.text()}`)
    return null
  }
  return res.json()
}

async function fetchMusiciansByOccupation(wikidataIds) {
  // Find artists who have ANY music-related occupation
  // Using broader search: anyone whose occupation is a subclass of musician/singer/composer
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P106 ?occ .
      VALUES ?musicOcc {
        wd:Q177220 wd:Q639669 wd:Q36834 wd:Q753110 wd:Q488205
        wd:Q855091 wd:Q386854 wd:Q130857 wd:Q584301 wd:Q806349
        wd:Q183945 wd:Q2252262 wd:Q1028181 wd:Q158852 wd:Q486748
        wd:Q27939 wd:Q2865819 wd:Q2643890 wd:Q2405480 wd:Q11774202
        wd:Q15981151 wd:Q55960 wd:Q4351403 wd:Q10816969 wd:Q16145150
        wd:Q2340047 wd:Q19546 wd:Q1198887 wd:Q3658608 wd:Q215380
        wd:Q49757 wd:Q2259451 wd:Q18844224 wd:Q1075651 wd:Q2722764
        wd:Q15982858 wd:Q3282637 wd:Q57231 wd:Q4610556 wd:Q66763670
      }
      FILTER(?occ = ?musicOcc)
    }
  `
  const data = await sparqlQuery(query)
  if (!data) return new Set()

  return new Set(
    data.results.bindings.map(b => b.item.value.split('/').pop())
  )
}

async function fetchMusiciansByGenre(wikidataIds) {
  // Find artists who have ANY music genre (P136)
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P136 ?genre .
    }
  `
  const data = await sparqlQuery(query)
  if (!data) return new Set()

  return new Set(
    data.results.bindings.map(b => b.item.value.split('/').pop())
  )
}

async function fetchMusiciansByInstrument(wikidataIds) {
  // Find artists who play an instrument (P1303)
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P1303 ?instrument .
    }
  `
  const data = await sparqlQuery(query)
  if (!data) return new Set()

  return new Set(
    data.results.bindings.map(b => b.item.value.split('/').pop())
  )
}

async function fetchMusiciansByVoiceType(wikidataIds) {
  // Find artists who have voice type (P412) - singers
  const values = wikidataIds.map(id => `wd:${id}`).join(' ')
  const query = `
    SELECT DISTINCT ?item WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P412 ?voice .
    }
  `
  const data = await sparqlQuery(query)
  if (!data) return new Set()

  return new Set(
    data.results.bindings.map(b => b.item.value.split('/').pop())
  )
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

  const artistMap = {}
  for (const a of artists) {
    if (a.wikidata_id) artistMap[a.wikidata_id] = a
  }

  const allWikidataIds = Object.keys(artistMap)
  const allMusicians = new Set()

  // Process in batches
  const BATCH_SIZE = 80

  for (let i = 0; i < allWikidataIds.length; i += BATCH_SIZE) {
    const batch = allWikidataIds.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(allWikidataIds.length / BATCH_SIZE)
    console.log(`\nBatch ${batchNum}/${totalBatches}...`)

    // Run all 4 checks in parallel
    const [byOcc, byGenre, byInstr, byVoice] = await Promise.all([
      fetchMusiciansByOccupation(batch),
      fetchMusiciansByGenre(batch),
      fetchMusiciansByInstrument(batch),
      fetchMusiciansByVoiceType(batch),
    ])

    for (const id of byOcc) allMusicians.add(id)
    for (const id of byGenre) allMusicians.add(id)
    for (const id of byInstr) allMusicians.add(id)
    for (const id of byVoice) allMusicians.add(id)

    console.log(`  +${byOcc.size} occupation, +${byGenre.size} genre, +${byInstr.size} instrument, +${byVoice.size} voice`)

    // Rate limit
    if (i + BATCH_SIZE < allWikidataIds.length) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  console.log(`\nTotal musicians identified: ${allMusicians.size}`)

  // 2. Classify and update
  const nonMusicianUpdates = []
  const musicianFixes = []

  for (const [wikidataId, artist] of Object.entries(artistMap)) {
    const isMusician = allMusicians.has(wikidataId)

    if (!isMusician && !artist.genres?.includes('non-music')) {
      // Not a musician, not yet tagged → tag as non-music
      nonMusicianUpdates.push({ id: artist.id, name: artist.name })
    } else if (isMusician && artist.genres?.includes('non-music')) {
      // Was wrongly tagged as non-music → fix
      musicianFixes.push({ id: artist.id, name: artist.name })
    }
  }

  console.log(`\nNew non-musicians to tag: ${nonMusicianUpdates.length}`)
  console.log(`Wrongly tagged musicians to fix: ${musicianFixes.length}`)

  // Update non-musicians
  for (const upd of nonMusicianUpdates) {
    const { error: e } = await supabase
      .from('artists')
      .update({ genres: ['non-music'] })
      .eq('id', upd.id)
    if (e) console.error(`  Failed: ${upd.name}`, e)
  }

  // Fix wrongly tagged musicians
  for (const fix of musicianFixes) {
    const { error: e } = await supabase
      .from('artists')
      .update({ genres: [] })
      .eq('id', fix.id)
    if (e) console.error(`  Failed: ${fix.name}`, e)
    else console.log(`  Fixed musician: ${fix.name}`)
  }

  // 3. Also fix influence_type for newly tagged non-musicians
  const allNonMusicIds = new Set()
  // Refresh full list
  const { data: allNM } = await supabase
    .from('artists')
    .select('id')
    .contains('genres', ['non-music'])

  if (allNM) {
    for (const a of allNM) allNonMusicIds.add(a.id)
  }

  console.log(`\nTotal non-musicians in DB now: ${allNonMusicIds.size}`)

  // Fix influence types
  let allInfluences = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('influences')
      .select('id, influencer_id, influenced_id, influence_type')
      .eq('influence_type', 'musical')
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    allInfluences = allInfluences.concat(data)
    offset += 1000
  }

  const toFix = allInfluences.filter(inf =>
    allNonMusicIds.has(inf.influencer_id) && allNonMusicIds.has(inf.influenced_id)
  )

  console.log(`Influence types to fix: ${toFix.length}`)
  for (const inf of toFix) {
    await supabase
      .from('influences')
      .update({ influence_type: 'philosophical' })
      .eq('id', inf.id)
  }

  console.log('Done!')
}

main().catch(console.error)
