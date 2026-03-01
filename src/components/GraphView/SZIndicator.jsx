import { getVisibleCount } from '../../utils/graph-utils.js'

export default function SZIndicator({ filterLevel }) {
  const visibleCount = getVisibleCount(filterLevel)

  return (
    <div className="sz-indicator">
      <span className="material-symbols-outlined">filter_list</span>
      <span className="sz-bar-track">
        <span className="sz-bar-fill" style={{ width: `${filterLevel * 100}%` }} />
      </span>
      <span className="sz-count">
        {visibleCount === Infinity ? 'ALL' : visibleCount}
      </span>
    </div>
  )
}
