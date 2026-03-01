export default function GraphControls({ semanticZoomActive, pathMode, onZoomIn, onZoomOut, onFit, onTogglePath }) {
  return (
    <div className="graph-controls" role="toolbar" aria-label="Graph controls">
      <button onClick={onZoomIn} title={semanticZoomActive ? "表示を増やす" : "拡大"} aria-label={semanticZoomActive ? "表示を増やす" : "拡大"}>
        <span className="material-symbols-outlined">add</span>
      </button>
      <button onClick={onZoomOut} title={semanticZoomActive ? "表示を減らす" : "縮小"} aria-label={semanticZoomActive ? "表示を減らす" : "縮小"}>
        <span className="material-symbols-outlined">remove</span>
      </button>
      <div className="divider" />
      <button onClick={onFit} title="全体表示" aria-label="全体表示">
        <span className="material-symbols-outlined">center_focus_strong</span>
      </button>
      <div className="divider" />
      <button onClick={onTogglePath} title="経路探索" aria-label="経路探索" className={pathMode ? 'active' : ''}>
        <span className="material-symbols-outlined">route</span>
      </button>
    </div>
  )
}
