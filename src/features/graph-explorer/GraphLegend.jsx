import { useTranslation } from 'react-i18next'

const LEGEND_ITEMS = [
  { type: 'musical', color: '#7da38d' },
  { type: 'lyrical', color: '#d4a753' },
  { type: 'philosophical', color: '#9ca3af' },
  { type: 'aesthetic', color: '#c25e5e' },
  { type: 'personal', color: '#8a8880' },
]

export default function GraphLegend({ activeEdgeFilter, onFilterEdge }) {
  const { t } = useTranslation()

  return (
    <div className="graph-legend" aria-label="Legend">
      {LEGEND_ITEMS.map(({ type, color }) => (
        <button
          key={type}
          className={`legend-item ${activeEdgeFilter === type ? 'legend-active' : ''}`}
          onClick={() => onFilterEdge(type)}
        >
          <span className="legend-dot" style={{ background: color }} /> {t(`influence_type.${type}`)}
        </button>
      ))}
    </div>
  )
}
