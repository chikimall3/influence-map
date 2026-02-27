import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
const BATCH_SIZE = 100

function toThumbUrl(commonsFilePath, width = 200) {
  // commonsFilePath: http://commons.wikimedia.org/wiki/Special:FilePath/Filename.jpg
  const filename = decodeURIComponent(commonsFilePath.split('/Special:FilePath/').pop() || '')
  if (!filename) return commonsFilePath
  const encoded = filename.replace(/ /g, '_')
  const hash = createHash('md5').update(encoded).digest('hex')
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash.substring(0, 2)}/${encoded}/${width}px-${encoded}`
}

async function main() {
  console.log('Fetching artists with wikidata_id from Supabase...')

  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, wikidata_id, image_url')
    .not('wikidata_id', 'is', null)
    .is('image_url', null)

  if (error) {
    console.error('Supabase error:', error)
    return
  }

  console.log(`Found ${artists.length} artists without images`)

  let totalUpdated = 0

  for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE)
    const wikidataIds = batch.map(a => a.wikidata_id).filter(Boolean)

    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(artists.length / BATCH_SIZE)}: Querying ${wikidataIds.length} artists...`)

    try {
      const values = wikidataIds.map(id => `wd:${id}`).join(' ')
      const query = `SELECT ?item ?image WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?image . }`

      const res = await fetch(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'InfluenceMap/1.0 (contact@example.com)'
        }
      })

      if (!res.ok) {
        console.error(`  SPARQL error: ${res.status}`)
        if (res.status === 429) {
          console.log('  Rate limited. Waiting 30s...')
          await new Promise(r => setTimeout(r, 30000))
          i -= BATCH_SIZE
        }
        continue
      }

      const json = await res.json()
      const imageMap = {}

      for (const binding of json.results.bindings) {
        const wid = binding.item.value.split('/').pop()
        // Only keep first image per artist
        if (!imageMap[wid]) {
          imageMap[wid] = toThumbUrl(binding.image.value, 200)
        }
      }

      console.log(`  Found ${Object.keys(imageMap).length} images`)

      for (const artist of batch) {
        const imageUrl = imageMap[artist.wikidata_id]
        if (imageUrl) {
          const { error: err } = await supabase
            .from('artists')
            .update({ image_url: imageUrl })
            .eq('id', artist.id)

          if (!err) totalUpdated++
          else console.error(`  Error: ${artist.name}: ${err.message}`)
        }
      }

      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      console.error(`  Batch error:`, err.message)
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  console.log(`\nDone! Updated ${totalUpdated} artists with images.`)
}

main()
