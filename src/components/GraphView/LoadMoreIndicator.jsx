import { MAX_CONNECTIONS } from './useGraphData.js'

export default function LoadMoreIndicator({ moreInfo, loadingMore, onLoadMore }) {
  if (!moreInfo) return null

  const { artistId, influencers, influenced } = moreInfo
  const hasMoreInfluencers = influencers.loaded < influencers.total
  const hasMoreInfluenced = influenced.loaded < influenced.total

  if (!hasMoreInfluencers && !hasMoreInfluenced) return null

  return (
    <div className="load-more-bar">
      {hasMoreInfluencers && (
        <button
          className="load-more-btn"
          onClick={() => onLoadMore(artistId, 'influencers')}
          disabled={loadingMore}
        >
          <span className="material-symbols-outlined">arrow_upward</span>
          <span>影響元 {influencers.loaded}/{influencers.total}</span>
          <span className="load-more-plus">
            {loadingMore ? '...' : `+${Math.min(MAX_CONNECTIONS, influencers.total - influencers.loaded)}`}
          </span>
        </button>
      )}
      {hasMoreInfluenced && (
        <button
          className="load-more-btn"
          onClick={() => onLoadMore(artistId, 'influenced')}
          disabled={loadingMore}
        >
          <span className="material-symbols-outlined">arrow_downward</span>
          <span>影響先 {influenced.loaded}/{influenced.total}</span>
          <span className="load-more-plus">
            {loadingMore ? '...' : `+${Math.min(MAX_CONNECTIONS, influenced.total - influenced.loaded)}`}
          </span>
        </button>
      )}
    </div>
  )
}
