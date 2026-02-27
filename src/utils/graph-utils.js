// filterLevel 0.0-1.0 -> visible neighbor count
export function getVisibleCount(filterLevel) {
  if (filterLevel < 0.2) return 3
  if (filterLevel < 0.4) return 5
  if (filterLevel < 0.6) return 10
  if (filterLevel < 0.8) return 20
  return Infinity
}
