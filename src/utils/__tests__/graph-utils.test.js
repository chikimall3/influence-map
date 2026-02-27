import { describe, it, expect } from 'vitest'
import { getVisibleCount } from '../graph-utils.js'

describe('getVisibleCount', () => {
  it('returns 3 for filterLevel < 0.2', () => {
    expect(getVisibleCount(0)).toBe(3)
    expect(getVisibleCount(0.1)).toBe(3)
    expect(getVisibleCount(0.19)).toBe(3)
  })
  it('returns 5 for filterLevel 0.2-0.4', () => {
    expect(getVisibleCount(0.2)).toBe(5)
    expect(getVisibleCount(0.3)).toBe(5)
  })
  it('returns 10 for filterLevel 0.4-0.6', () => {
    expect(getVisibleCount(0.4)).toBe(10)
    expect(getVisibleCount(0.5)).toBe(10)
  })
  it('returns 20 for filterLevel 0.6-0.8', () => {
    expect(getVisibleCount(0.6)).toBe(20)
    expect(getVisibleCount(0.7)).toBe(20)
  })
  it('returns Infinity for filterLevel >= 0.8', () => {
    expect(getVisibleCount(0.8)).toBe(Infinity)
    expect(getVisibleCount(1.0)).toBe(Infinity)
  })
  it('handles edge cases', () => {
    expect(getVisibleCount(-1)).toBe(3)
    expect(getVisibleCount(1)).toBe(Infinity)
  })
})
