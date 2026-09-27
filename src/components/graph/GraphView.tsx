import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useNotes } from "../../context/NotesContext";
import { getLinkGraph, type LinkGraph } from "../../services/graph";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "../icons";
import { IconButton } from "../ui";
import { isWindows } from "../../lib/platform";

type GNode = LinkGraph["nodes"][number] & SimulationNodeDatum;
type GEdge = LinkGraph["edges"][number] & SimulationLinkDatum<GNode>;

interface Transform {
  tx: number;
  ty: number;
  k: number;
}

const MIN_K = 0.05;
const MAX_K = 3;
// Vaults larger than this skip the live simulation and lay out instantly
const LIVE_SIM_MAX_NODES = 600;
// Perpetual low simmer so nodes float gently instead of freezing solid
const FLOAT_ALPHA = 0.05;
const DRAG_ALPHA = 0.3;

function radiusFor(node: GNode, degree: Map<string, number>) {
  if (node.unresolved) return 4;
  return Math.min(4 + Math.sqrt(degree.get(node.id) ?? 0) * 2.4, 15);
}

function degreeMapOf(edges: LinkGraph["edges"]) {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return degree;
}

function prepareGraph(
  data: LinkGraph,
  prevPositions: Map<string, { x: number; y: number }>,
): { nodes: GNode[]; links: GEdge[] } {
  const nodes: GNode[] = data.nodes.map((n) => {
    const prev = prevPositions.get(n.id);
    return { ...n, x: prev?.x, y: prev?.y };
  });
  const links: GEdge[] = data.edges.map((e) => ({ ...e }));
  return { nodes, links };
}

function buildSimulation(nodes: GNode[], links: GEdge[], degree: Map<string, number>) {
  return forceSimulation<GNode>(nodes)
    .force(
      "link",
      forceLink<GNode, GEdge>(links).id((d) => d.id).distance(60).strength(0.6),
    )
    .force("charge", forceManyBody<GNode>().strength(-120))
    // Weak gravity keeps orphan notes near the connected cluster instead of
    // being flung to the edges by the charge force
    .force("x", forceX(0).strength(0.05))
    .force("y", forceY(0).strength(0.05))
    .force(
      "collide",
      forceCollide<GNode>().radius((d) => radiusFor(d, degree) + 6),
    );
}

export function GraphView({ onBack }: { onBack: () => void }) {
  const { selectNote, selectedNoteId } = useNotes();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const firstLoadDone = useRef(false);
  const simRef = useRef<Simulation<GNode, GEdge> | null>(null);
  // Mirror of the graph state for use inside stable callbacks (avoids
  // re-subscribing the fetch/file-change effects on every render)
  const graphRef = useRef<{ nodes: GNode[]; links: GEdge[] } | null>(null);
  const interaction = useRef<
    | { type: "pan"; startX: number; startY: number; startTx: number; startTy: number }
    | { type: "drag"; nodeId: string; dx: number; dy: number; moved: boolean }
    | null
  >(null);
  const suppressClickRef = useRef(false);

  const [graph, setGraph] = useState<{ nodes: GNode[]; links: GEdge[] } | null>(null);
  graphRef.current = graph;
  const [loading, setLoading] = useState(true);
  const [transform, setTransform] = useState<Transform>({ tx: 0, ty: 0, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hideOrphans, setHideOrphans] = useState(false);
  // Node positions are mutated in place (d3 ticks, drags); bumping this
  // version forces the SVG to re-render with the updated coordinates
  const [renderVersion, setRenderVersion] = useState(0);

  const degreeById = useMemo(() => {
    const degree = new Map<string, number>();
    if (graph) {
      for (const e of graph.links) {
        const s = e.source as GNode;
        const t = e.target as GNode;
        degree.set(s.id, (degree.get(s.id) ?? 0) + 1);
        degree.set(t.id, (degree.get(t.id) ?? 0) + 1);
      }
    }
    return degree;
  }, [graph]);

  const neighborIds = useMemo(() => {
    if (!hoveredId || !graph) return null;
    const set = new Set<string>([hoveredId]);
    for (const e of graph.links) {
      const s = e.source as GNode;
      const t = e.target as GNode;
      if (s.id === hoveredId) set.add(t.id);
      if (t.id === hoveredId) set.add(s.id);
    }
    return set;
  }, [hoveredId, graph]);

  const fitNodes = useCallback((nodes: GNode[]) => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;
    const rect = container.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x ?? 0);
      maxX = Math.max(maxX, n.x ?? 0);
      minY = Math.min(minY, n.y ?? 0);
      maxY = Math.max(maxY, n.y ?? 0);
    }
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const k = Math.min(Math.min((rect.width - 80) / bw, (rect.height - 80) / bh), 1.6);
    const clamped = Math.max(MIN_K, Math.min(MAX_K, k));
    setTransform({
      tx: rect.width / 2 - clamped * (minX + bw / 2),
      ty: rect.height / 2 - clamped * (minY + bh / 2),
      k: clamped,
    });
  }, []);

  const fitView = useCallback(() => {
    if (graph) fitNodes(graph.nodes);
  }, [graph, fitNodes]);

  const centerView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTransform((prev) => ({ ...prev, tx: rect.width / 2, ty: rect.height / 2 }));
  }, []);

  const savePositions = useCallback((nodes: GNode[]) => {
    for (const n of nodes) {
      if (n.x != null && n.y != null) {
        prevPositions.current.set(n.id, { x: n.x, y: n.y });
      }
    }
  }, []);

  const fetchGraph = useCallback(async () => {
    try {
      const isFirst = !firstLoadDone.current;
      const data = await getLinkGraph();
      // Seed new nodes from previous positions (drags, drift from the live sim)
      const seed = new Map(prevPositions.current);
      const current = graphRef.current;
      if (current) {
        for (const n of current.nodes) {
          if (n.x != null && n.y != null) {
            seed.set(n.id, { x: n.x, y: n.y });
          }
        }
      }
      const { nodes, links } = prepareGraph(data, seed);
      firstLoadDone.current = true;
      const degree = degreeMapOf(data.edges);

      simRef.current?.stop();
      simRef.current = null;
      const sim = buildSimulation(nodes, links, degree);

      if (nodes.length <= LIVE_SIM_MAX_NODES) {
        // Live simulation: entrance settles into a perpetual gentle float
        let fitted = false;
        sim.alphaTarget(FLOAT_ALPHA).on("tick", () => {
          if (!fitted && sim.alpha() <= 0.09) {
            fitted = true;
            fitNodes(nodes);
          }
          setRenderVersion((v) => v + 1);
        });
        setGraph({ nodes, links });
        sim.alpha(isFirst ? 1 : 0.35).alphaDecay(0.045);
        if (isFirst) centerView();
        sim.restart();
        simRef.current = sim;
      } else {
        // Large vault: static pre-ticked layout, no ongoing CPU cost
        sim.stop().alphaDecay(0.05);
        for (let i = 0; i < 100; i++) {
          sim.tick();
        }
        savePositions(nodes);
        setGraph({ nodes, links });
        if (isFirst) fitNodes(nodes);
      }
    } catch (err) {
      console.error("Failed to load link graph:", err);
      toast.error("Failed to load link graph");
    } finally {
      setLoading(false);
    }
  }, [fitNodes, centerView, savePositions]);

  useEffect(() => {
    fetchGraph();
    return () => {
      simRef.current?.stop();
    };
  }, [fetchGraph]);

  // Stay live: refetch (debounced) when files change on disk while the view is open
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: number | null = null;
    let cancelled = false;
    listen("file-change", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (!cancelled) fetchGraph();
      }, 1000);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [fetchGraph]);

  // Wheel zoom at cursor — non-passive listener so preventDefault works
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setTransform((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * factor));
        const scale = k / prev.k;
        return {
          k,
          tx: px - (px - prev.tx) * scale,
          ty: py - (py - prev.ty) * scale,
        };
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTransform((prev) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * factor));
      const scale = k / prev.k;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        k,
        tx: cx - (cx - prev.tx) * scale,
        ty: cy - (cy - prev.ty) * scale,
      };
    });
  }, []);

  // Global pointer handlers for pan and node drag
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const action = interaction.current;
      if (!action) return;
      if (action.type === "pan") {
        setTransform((prev) => ({
          ...prev,
          tx: action.startTx + (e.clientX - action.startX),
          ty: action.startTy + (e.clientY - action.startY),
        }));
      } else {
        const container = containerRef.current;
        if (!container || !graph) return;
        const rect = container.getBoundingClientRect();
        const wx = (e.clientX - rect.left - transform.tx) / transform.k;
        const wy = (e.clientY - rect.top - transform.ty) / transform.k;
        const node = graph.nodes.find((n) => n.id === action.nodeId);
        if (node) {
          node.x = wx - action.dx;
          node.y = wy - action.dy;
          node.fx = node.x;
          node.fy = node.y;
          prevPositions.current.set(node.id, { x: node.x, y: node.y });
          action.moved = true;
          setRenderVersion((v) => v + 1);
        }
      }
    };
    const onPointerUp = () => {
      const action = interaction.current;
      if (action?.type === "drag") {
        if (action.moved) {
          suppressClickRef.current = true;
        }
        // Release the node so it floats with the rest of the graph again
        const dragged = graphRef.current?.nodes.find((n) => n.id === action.nodeId);
        if (dragged) {
          dragged.fx = null;
          dragged.fy = null;
        }
        // Small reheat for a settling wobble after the drag
        simRef.current?.alpha(FLOAT_ALPHA + 0.15).alphaTarget(FLOAT_ALPHA);
      }
      interaction.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [graph, transform]);

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    interaction.current = {
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      startTx: transform.tx,
      startTy: transform.ty,
    };
  };

  const handleNodePointerDown = (e: React.PointerEvent, node: GNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const wx = (e.clientX - rect.left - transform.tx) / transform.k;
    const wy = (e.clientY - rect.top - transform.ty) / transform.k;
    interaction.current = {
      type: "drag",
      nodeId: node.id,
      dx: wx - (node.x ?? 0),
      dy: wy - (node.y ?? 0),
      moved: false,
    };
    // Reheat the simulation so the graph wobbles while dragging
    node.fx = node.x;
    node.fy = node.y;
    simRef.current?.alphaTarget(DRAG_ALPHA).restart();
  };

  const handleNodeClick = async (node: GNode) => {
    // Suppress navigation right after a node drag
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (node.unresolved) {
      toast.info(`Note "${node.title}" does not exist yet`);
      return;
    }
    await selectNote(node.id);
    onBack();
  };

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    if (!hideOrphans) return graph.nodes;
    return graph.nodes.filter((n) => (degreeById.get(n.id) ?? 0) > 0);
  }, [graph, hideOrphans, degreeById]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const nodeRadius = (node: GNode) => radiusFor(node, degreeById);

  const isDimmed = (id: string) => neighborIds !== null && !neighborIds.has(id);

  void renderVersion;

  return (
    <div className="h-full flex bg-bg w-full relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-1 px-3 pt-2 pb-1 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1">
          <IconButton onClick={onBack} title="Back (Esc)">
            <ArrowLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
          <div className="font-medium text-base">
            Graph
            {graph && (
              <span className="text-text-muted font-normal text-sm ml-2">
                {graph.nodes.length} notes · {graph.links.length} links
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-bg-secondary cursor-grab active:cursor-grabbing"
        onPointerDown={handleBackgroundPointerDown}
      >
        {!isWindows && <div className="absolute top-0 left-0 right-0 h-11 z-10" data-tauri-drag-region />}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted/70 text-sm">
            Building graph...
          </div>
        )}

        {!loading && graph && graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            No notes yet — create a few and link them with [[wikilinks]]
          </div>
        )}

        {graph && graph.nodes.length > 0 && (
          <svg className="w-full h-full select-none" data-graph-canvas>
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-muted)" />
              </marker>
              <marker
                id="graph-arrow-active"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text)" />
              </marker>
            </defs>
            <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.k})`}>
              {graph.links.map((e, i) => {
                const s = e.source as GNode;
                const t = e.target as GNode;
                if (!visibleIds.has(s.id) || !visibleIds.has(t.id)) return null;
                const x1c = s.x ?? 0;
                const y1c = s.y ?? 0;
                const x2c = t.x ?? 0;
                const y2c = t.y ?? 0;
                const dx = x2c - x1c;
                const dy = y2c - y1c;
                const len = Math.hypot(dx, dy) || 1;
                // Stop lines at the node borders so the arrowhead stays visible
                const pad1 = nodeRadius(s) + 3;
                const pad2 = nodeRadius(t) + 4;
                if (len <= pad1 + pad2 + 2) return null;
                const x1 = x1c + (dx / len) * pad1;
                const y1 = y1c + (dy / len) * pad1;
                const x2 = x2c - (dx / len) * pad2;
                const y2 = y2c - (dy / len) * pad2;
                const active = hoveredId !== null && (s.id === hoveredId || t.id === hoveredId);
                const dim = hoveredId !== null && !active;
                return (
                  <line
                    key={`e${i}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={active ? "var(--color-text)" : "var(--color-text-muted)"}
                    strokeWidth={active ? 1.25 : 0.75}
                    opacity={dim ? 0.06 : active ? 0.85 : 0.3}
                    markerEnd={active ? "url(#graph-arrow-active)" : "url(#graph-arrow)"}
                  />
                );
              })}
              {visibleNodes.map((n) => {
                const dim = isDimmed(n.id);
                const r = nodeRadius(n);
                const isCurrent = n.id === selectedNoteId;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                    opacity={dim && !isCurrent ? 0.15 : 1}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId((prev) => (prev === n.id ? null : prev))}
                    onPointerDown={(e) => handleNodePointerDown(e, n)}
                    onClick={() => handleNodeClick(n)}
                  >
                    {n.unresolved ? (
                      <circle
                        r={r}
                        fill="var(--color-bg-secondary)"
                        stroke="var(--color-text-muted)"
                        strokeWidth={1.5}
                        strokeDasharray="2 2"
                      />
                    ) : (
                      <>
                        {isCurrent && (
                          <circle r={r + 5} fill="var(--color-selection)" />
                        )}
                        <circle
                          r={r}
                          fill="var(--color-accent)"
                          stroke={isCurrent ? "var(--color-text)" : "transparent"}
                          strokeWidth={isCurrent ? 1.5 : 3}
                          opacity={0.9}
                        />
                      </>
                    )}
                    <text
                      y={r + 11}
                      textAnchor="middle"
                      fontSize={10}
                      fill={isCurrent ? "var(--color-text)" : "var(--color-text-muted)"}
                      opacity={isCurrent ? 1 : 0.85}
                      stroke="var(--color-bg-secondary)"
                      strokeWidth={3.5}
                      paintOrder="stroke"
                      className="pointer-events-none"
                      style={{ fontWeight: isCurrent ? 700 : 500 }}
                    >
                      {n.title.length > 28 ? `${n.title.slice(0, 28)}…` : n.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Floating controls */}
        {graph && graph.nodes.length > 0 && (
          <div
            className="absolute bottom-4 right-4 flex flex-col gap-1 bg-bg border border-border rounded-lg shadow-lg p-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconButton title="Zoom in" onClick={() => zoomBy(1.25)}>
              <PlusIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
            <IconButton title="Zoom out" onClick={() => zoomBy(0.8)}>
              <MinusIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
            <IconButton title="Fit graph" onClick={fitView}>
              <svg
                className="w-4.5 h-4.5 stroke-[1.5]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </IconButton>
            <IconButton
              title={hideOrphans ? "Show orphan notes" : "Hide orphan notes"}
              onClick={() => setHideOrphans((v) => !v)}
              className={hideOrphans ? "bg-bg-emphasis" : undefined}
            >
              <svg
                className="w-4.5 h-4.5 stroke-[1.5]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="2.5" />
                <path d="M12 9.5V4" />
                <path d="M14.5 12h5.5" />
                <path d="M12 14.5V20" />
                <path d="M9.5 12H4" />
              </svg>
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
