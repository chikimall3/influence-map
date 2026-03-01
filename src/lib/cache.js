import localforage from 'localforage'

const memCache = new Map()
const DEFAULT_TTL = 10 * 60 * 1000 // 10 minutes

const store = localforage.createInstance({
  name: 'influence-map',
  storeName: 'api_cache',
})

// Hydrate memory cache from IndexedDB on startup
let hydrated = false
async function hydrate() {
  if (hydrated) return
  hydrated = true
  try {
    const keys = await store.keys()
    const now = Date.now()
    for (const key of keys) {
      const entry = await store.getItem(key)
      if (entry && entry.expires > now) {
        memCache.set(key, entry)
      } else {
        store.removeItem(key)
      }
    }
  } catch {
    // IndexedDB unavailable, memory-only fallback
  }
}

// Start hydration immediately
hydrate()

export function getCached(key) {
  const entry = memCache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expires) {
    memCache.delete(key)
    store.removeItem(key).catch(() => {})
    return null
  }
  return entry.data
}

export function setCache(key, data, ttl = DEFAULT_TTL) {
  const entry = { data, expires: Date.now() + ttl }
  memCache.set(key, entry)
  store.setItem(key, entry).catch(() => {})
}

export function clearCache() {
  memCache.clear()
  store.clear().catch(() => {})
}

// Async version for cases where hydration must complete first
export async function getCachedAsync(key) {
  await hydrate()
  return getCached(key)
}
