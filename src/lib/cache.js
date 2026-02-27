const cache = new Map()
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

export function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCache(key, data, ttl = DEFAULT_TTL) {
  cache.set(key, { data, expires: Date.now() + ttl })
}

export function clearCache() {
  cache.clear()
}
