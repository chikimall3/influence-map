import { describe, it, expect, beforeEach } from 'vitest'
import { getCached, setCache, clearCache } from '../cache.js'

describe('cache', () => {
  beforeEach(() => { clearCache() })
  it('returns null for missing key', () => {
    expect(getCached('missing')).toBeNull()
  })
  it('stores and retrieves data', () => {
    setCache('key1', { name: 'test' })
    expect(getCached('key1')).toEqual({ name: 'test' })
  })
  it('returns null for expired entries', () => {
    setCache('key2', { name: 'old' }, 0)
    expect(getCached('key2')).toBeNull()
  })
  it('clears all entries', () => {
    setCache('a', 1)
    setCache('b', 2)
    clearCache()
    expect(getCached('a')).toBeNull()
    expect(getCached('b')).toBeNull()
  })
})
