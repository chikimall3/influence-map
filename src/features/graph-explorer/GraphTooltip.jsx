export default function GraphTooltip({ tooltip }) {
  if (!tooltip) return null

  return (
    <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <div className="tooltip-name">{tooltip.name}</div>
      {tooltip.nameEn && <div className="tooltip-name-en">{tooltip.nameEn}</div>}
      {tooltip.genres?.length > 0 && (
        <div className="tooltip-genre">{tooltip.genres.slice(0, 2).join(', ')}</div>
      )}
      {tooltip.birthYear && <div className="tooltip-year">{tooltip.birthYear}–</div>}
    </div>
  )
}
