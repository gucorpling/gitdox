/**
 * jsPlumb adapter for the RST tree: the only place that talks to jsPlumb.
 *
 * jsPlumb 1.7.x (the standalone DOM build, no jQuery) draws the connectors, arrowheads and positions the label
 * overlays exactly as legacy rstWeb did. React owns everything else: the layer is a small external store that
 * - draws the edges it is given (setEdges), reusing connections whose definition did not change,
 * - creates one empty overlay element per labelled edge, which React fills through a portal (see getSnapshot).
 * It can later be replaced by an SVG implementation with the same interface.
 */

let loading = null;

/** Loads jsPlumb lazily. Its source expects `this` to be the global object in each wrapper, so it is evaluated as a plain script. */
function loadJsPlumb() {
  loading ||= import('jsplumb/dist/js/jsPlumb-1.7.9-min.js?raw').then(({ default: source }) => {
    if (!window.jsPlumb) new Function(source).call(window);
    return window.jsPlumb;
  });
  return loading;
}

// Look of rstWeb: grey 2px bezier curves with tiny dot endpoints, arrowheads close to the target
const DEFAULTS = {
  PaintStyle: { lineWidth: 2, strokeStyle: 'rgba(0,0,0,0.5)' },
  Endpoints: [['Dot', { radius: 1 }], ['Dot', { radius: 1 }]],
  EndpointStyles: [{ fillStyle: '#000000' }, { fillStyle: '#000000' }],
  Anchor: 'Top',
  Connector: ['Bezier', { curviness: 50 }]
};

const arrow = () => ['Arrow', { width: 12, length: 12, location: 0.95 }];

function connectionParams(spec, source, target, overlayElement) {
  const label = (location) => ['Custom', { create: () => overlayElement, location, id: 'customOverlay' }];
  switch (spec.kind) {
    case 'span':
      return { source, target, connector: 'Straight', anchors: ['Top', 'Bottom'] };
    case 'multinuc':
      return { source, target, connector: 'Straight', anchors: ['Top', 'Bottom'], overlays: [label(0.2)] };
    case 'secedge':
      return {
        source,
        target,
        scope: 'secedge',
        connector: ['Bezier', { curviness: spec.curviness }],
        paintStyle: { lineWidth: 2, strokeStyle: 'rgba(0,0,255,1)' },
        overlays: [arrow(), label(0.5)]
      };
    default:
      return { source, target, overlays: [arrow(), label(0.1)] };
  }
}

const definitionOf = (spec) => `${spec.kind}|${spec.source}|${spec.target}|${spec.curviness ?? ''}`;

export function createEdgeLayer() {
  let container = null;
  let attachment = 0;
  let instance = null;
  let wanted = [];
  const live = new Map();
  const listeners = new Set();
  let snapshot = { overlays: new Map() };

  const publish = () => {
    snapshot = { overlays: new Map([...live].filter(([, entry]) => entry.overlay).map(([key, entry]) => [key, entry.overlay])) };
    listeners.forEach((listener) => listener());
  };

  let applied = false;
  let frame = 0;
  let fallback = 0;

  const findNode = (id) => container.querySelector(`[data-rst-node="${id}"]`);

  /**
   * Nodes glide to their new place through CSS transitions (as legacy rstWeb animated them with jQuery). While any
   * transition runs, the connectors are redrawn every frame and the container gets the class rstweb-animating, which
   * disables pointer events so that nothing can be clicked mid-move.
   */
  function settle() {
    if (!instance || !container || !container.getAnimations) return;
    cancelAnimationFrame(frame);
    const started = performance.now();
    const running = () => container.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
    if (!running()) return;
    container.classList.add('rstweb-animating');
    // Animation frames are paused in hidden tabs, so the class must not depend on them to be cleared
    clearTimeout(fallback);
    fallback = setTimeout(() => container?.classList.remove('rstweb-animating'), 1600);
    const tick = () => {
      if (!instance || !container) return;
      instance.repaintEverything();
      if (running() && performance.now() - started < 1500) {
        frame = requestAnimationFrame(tick);
      } else {
        container.classList.remove('rstweb-animating');
      }
    };
    tick();
  }

  const drop = (key) => {
    const entry = live.get(key);
    if (!entry) return;
    try { instance.detach({ connection: entry.connection, fireEvent: false }); } catch { /* element may be gone already */ }
    live.delete(key);
  };

  function apply() {
    if (!instance || !container) return;
    let changed = false;
    const specs = new Map(wanted.map((spec) => [spec.key, spec]));

    instance.setSuspendDrawing(true);
    [...live.keys()].forEach((key) => {
      const entry = live.get(key);
      const spec = specs.get(key);
      const stale = !spec || entry.definition !== definitionOf(spec)
        || !container.contains(entry.source) || !container.contains(entry.target)
        || entry.source !== findNode(spec.source) || entry.target !== findNode(spec.target);
      if (stale) { drop(key); changed = true; }
    });
    wanted.forEach((spec) => {
      if (live.has(spec.key)) return;
      const source = findNode(spec.source);
      const target = findNode(spec.target);
      if (!source || !target) return;
      const overlay = spec.kind === 'span' ? null : document.createElement('div');
      const connection = instance.connect(connectionParams(spec, source, target, overlay));
      live.set(spec.key, { definition: definitionOf(spec), connection, source, target, overlay });
      changed = true;
    });
    instance.setSuspendDrawing(false, true);
    instance.repaintEverything();
    if (changed) publish();
    if (applied) settle();
    applied = true;
  }

  return {
    /** Starts drawing inside `element` (must be position:relative and contain the nodes marked with data-rst-node) */
    async attach(element) {
      container = element;
      const mine = ++attachment;
      const jsPlumb = await loadJsPlumb();
      if (mine !== attachment) return;
      instance = jsPlumb.getInstance({ ...DEFAULTS, Container: element });
      apply();
    },

    detach() {
      attachment += 1;
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      applied = false;
      if (instance) instance.reset();
      instance = null;
      container = null;
      live.clear();
      publish();
    },

    /** Declares the edges to draw: [{ key, kind, source, target, curviness? }]; nodes are looked up by data-rst-node */
    setEdges(edges) {
      wanted = edges;
      apply();
    },

    /** Keeps the connectors in step with running CSS transitions (e.g. when the signal drawer resizes things) */
    settle,

    // External store interface for useSyncExternalStore: snapshot.overlays maps edge key -> element to render into
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot
  };
}
