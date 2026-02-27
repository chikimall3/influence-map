import { describe, it, expect } from 'vitest'
import { getVisibleCount } from '../graph-utils.js'

describe('getVisibleCount', () => {
  it('returns 3 at level 0', () => {
    expect(getVisibleCount(0)).toBe(3)
  })
  it('returns Infinity at level >= 0.95', () => {
    expect(getVisibleCount(0.95)).toBe(Infinity)
    expect(getVisibleCount(1.0)).toBe(Infinity)
  })
  it('increases monotonically', () => {
    let prev = getVisibleCount(0)
    for (let l = 0.1; l < 0.95; l += 0.1) {
      const cur = getVisibleCount(l)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })
  it('returns ~26 at level 0.5', () => {
    const count = getVisibleCount(0.5)
    expect(count).toBeGreaterThanOrEqual(25)
    expect(count).toBeLessThanOrEqual(28)
  })
  it('handles edge cases', () => {
    expect(getVisibleCount(-1)).toBe(3)
    expect(getVisibleCount(1)).toBe(Infinity)
  })
})
