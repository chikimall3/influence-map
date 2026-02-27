// filterLevel 0.0-1.0 -> visible neighbor count
// Smooth continuous mapping: 3 at level 0 → all at level 1
export function getVisibleCount(filterLevel) {
  const level = Math.max(0, Math.min(1, filterLevel))
  if (level >= 0.95) return Infinity
  // Continuous curve: 3 → 50
  return Math.round(3 + level * 47)
}
