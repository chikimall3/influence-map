const INFLUENCE_COLORS = {
  musical: '#7da38d',
  lyrical: '#d4a753',
  philosophical: '#9ca3af',
  aesthetic: '#c25e5e',
  personal: '#8a8880',
}

const TRUST_OPACITY = {
  self_stated: 1.0,
  expert_db: 0.85,
  wikidata: 0.7,
  academic: 0.8,
  community: 0.5,
}

export const graphStyles = [
  {
    selector: 'node',
    style: {
      'label': 'data(label)',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 8,
      'font-size': 12,
      'font-family': 'Noto Sans JP, system-ui, sans-serif',
      'font-weight': 600,
      'color': '#e8e4d9',
      'text-outline-color': '#121210',
      'text-outline-width': 2.5,
      'text-outline-opacity': 0.9,
      'background-color': '#2a2a26',
      'background-opacity': 0.8,
      'border-width': 1.5,
      'border-color': '#8a8880',
      'width': 'mapData(connectionCount, 1, 15, 42, 72)',
      'height': 'mapData(connectionCount, 1, 15, 42, 72)',
      'text-max-width': 110,
      'text-wrap': 'ellipsis',
      'transition-property': 'opacity, text-opacity',
      'transition-duration': '0.25s',
    },
  },
  // Nodes with images
  {
    selector: 'node[image_url]',
    style: {
      'background-image': 'data(image_url)',
      'background-fit': 'cover',
      'background-clip': 'node',
      'background-opacity': 1,
      'background-image-crossorigin': 'anonymous',
    },
  },
  {
    selector: 'node[?isRoot]',
    style: {
      'border-color': '#7da38d',
      'border-width': 3,
      'width': 65,
      'height': 65,
      'font-size': 14,
      'font-weight': 'bold',
      'background-opacity': 1,
    },
  },
  {
    selector: 'node[?hasChildren]',
    style: {
      'border-style': 'dashed',
      'border-color': '#8a8880',
    },
  },
  // Hover effect
  {
    selector: 'node:active',
    style: {
      'overlay-color': '#7da38d',
      'overlay-opacity': 0.15,
      'overlay-padding': 6,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#d4a753',
      'border-width': 2.5,
      'overlay-color': '#d4a753',
      'overlay-opacity': 0.08,
      'overlay-padding': 8,
    },
  },
  {
    selector: 'edge',
    style: {
      'width': 1.2,
      'line-color': '#8a8880',
      'target-arrow-color': '#8a8880',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'opacity': 0.5,
      'arrow-scale': 0.8,
      'transition-property': 'opacity',
      'transition-duration': '0.25s',
    },
  },
  // Connected edges highlight on node select
  {
    selector: 'node:selected ~ edge',
    style: {
      'opacity': 0.8,
      'width': 2,
    },
  },
  // Influence type colors
  ...Object.entries(INFLUENCE_COLORS).map(([type, color]) => ({
    selector: `edge[influence_type = "${type}"]`,
    style: {
      'line-color': color,
      'target-arrow-color': color,
    },
  })),
  // Trust level opacity
  ...Object.entries(TRUST_OPACITY).map(([level, opacity]) => ({
    selector: `edge[trust_level = "${level}"]`,
    style: {
      'opacity': opacity,
    },
  })),
  // --- Semantic zoom classes (MUST be last to override all above) ---
  {
    selector: 'node.sz-focus',
    style: {
      'opacity': 1,
      'border-color': '#d4a753',
      'border-width': 3,
      'z-index': 10,
    },
  },
  {
    selector: 'node.sz-neighbor',
    style: {
      'opacity': 1,
      'z-index': 5,
    },
  },
  {
    selector: 'node.sz-dimmed',
    style: {
      'opacity': 0.12,
      'text-opacity': 0,
    },
  },
  {
    selector: 'node.sz-hidden',
    style: {
      'opacity': 0,
      'text-opacity': 0,
      'events': 'no',
    },
  },
  {
    selector: 'edge.sz-visible-edge',
    style: {
      'opacity': 0.8,
      'width': 2,
    },
  },
  {
    selector: 'edge.sz-dimmed',
    style: {
      'opacity': 0.03,
    },
  },
  {
    selector: 'edge.sz-hidden',
    style: {
      'opacity': 0,
      'events': 'no',
    },
  },
  // --- Edge type filter ---
  {
    selector: 'edge.edge-dimmed',
    style: {
      'opacity': 0.06,
    },
  },
  {
    selector: 'node.node-dimmed-by-filter',
    style: {
      'opacity': 0.2,
      'text-opacity': 0.3,
    },
  },
  // --- Path highlight ---
  {
    selector: '.path-dimmed',
    style: {
      'opacity': 0.1,
      'text-opacity': 0,
    },
  },
  {
    selector: 'node.path-highlight',
    style: {
      'opacity': 1,
      'text-opacity': 1,
      'z-index': 10,
    },
  },
  {
    selector: 'edge.path-highlight',
    style: {
      'opacity': 1,
      'width': 3,
      'z-index': 10,
      'line-color': '#d4a753',
      'target-arrow-color': '#d4a753',
    },
  },
  {
    selector: 'node.path-start',
    style: {
      'border-color': '#7da38d',
      'border-width': 4,
    },
  },
  {
    selector: 'node.path-end',
    style: {
      'border-color': '#d4a753',
      'border-width': 4,
    },
  },
]
