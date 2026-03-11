import { algorithmDefinitions, algorithmMap } from "./algorithms";
import { getDefaultGraph, getSampleGraph, sampleDefinitions } from "./samples";
import type {
  AlgorithmId,
  AlgorithmRun,
  Edge,
  Graph,
  Table,
  ToolMode,
  Vertex
} from "./types";

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 760;
const VERTEX_RADIUS = 34;
const COMPONENT_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#22c55e",
  "#7c3aed",
  "#f43f5e",
  "#14b8a6",
  "#84cc16",
  "#f59e0b"
];

interface AppState {
  graph: Graph;
  tool: ToolMode;
  selectedVertexId: string | null;
  selectedEdgeId: string | null;
  edgeDraftStartId: string | null;
  edgeDraftPointer: { x: number; y: number } | null;
  algorithmId: AlgorithmId;
  sourceId: string | null;
  targetId: string | null;
  trace: AlgorithmRun | null;
  stepIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  randomVertexCount: number;
  randomEdgeCount: number;
  historyPast: Graph[];
  historyFuture: Graph[];
  sampleId: string;
}

interface DragState {
  vertexId: string;
  beforeGraph: Graph;
  moved: boolean;
}

const editorPanelEl = document.querySelector<HTMLElement>("#editor-panel");
const graphSvgEl = document.querySelector<SVGSVGElement>("#graph-svg");
const graphStageEl = document.querySelector<HTMLElement>("#graph-stage");
const importInputEl = document.querySelector<HTMLInputElement>("#import-file");

if (
  !editorPanelEl ||
  !graphSvgEl ||
  !graphStageEl ||
  !importInputEl
) {
  throw new Error("Graph visualizer failed to bootstrap because required DOM nodes are missing.");
}

const initialGraph = normalizeGraph(getDefaultGraph());
const initialVertexIds = initialGraph.vertices.map((vertex) => vertex.id);

const state: AppState = {
  graph: initialGraph,
  tool: "select",
  selectedVertexId: null,
  selectedEdgeId: null,
  edgeDraftStartId: null,
  edgeDraftPointer: null,
  algorithmId: "dfs",
  sourceId: initialVertexIds[0] ?? null,
  targetId: initialVertexIds[1] ?? initialVertexIds[0] ?? null,
  trace: null,
  stepIndex: 0,
  isPlaying: false,
  playbackSpeed: 60,
  randomVertexCount: 7,
  randomEdgeCount: 10,
  historyPast: [],
  historyFuture: [],
  sampleId: "showcase"
};

let dragState: DragState | null = null;
let suppressNextGraphClick = false;
let playbackTimer: number | null = null;
let idCounter = 0;

function currentAlgorithm() {
  return algorithmMap.get(state.algorithmId) ?? algorithmDefinitions[0];
}

function currentStep() {
  if (!state.trace) {
    return null;
  }

  const safeIndex = clamp(state.stepIndex, 0, Math.max(state.trace.steps.length - 1, 0));
  state.stepIndex = safeIndex;
  return state.trace.steps[safeIndex] ?? null;
}

function componentColor(index: number | undefined) {
  if (index === undefined) {
    return COMPONENT_COLORS[0];
  }

  return COMPONENT_COLORS[index % COMPONENT_COLORS.length];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function speedToDelay(speed: number) {
  const normalized = clamp(speed, 1, 100);
  return Math.round(1700 - ((normalized - 1) * 1500) / 99);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createId(prefix: "v" | "e") {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function cloneGraph(graph: Graph) {
  return structuredClone(graph);
}

function alphaLabelToNumber(label: string) {
  let value = 0;
  const normalized = label.toUpperCase();
  for (const character of normalized) {
    value = value * 26 + (character.charCodeAt(0) - 64);
  }
  return value;
}

function numberToAlphaLabel(value: number) {
  let current = value;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label || "A";
}

function nextVertexLabel(vertices: Vertex[]) {
  const alphaLabels = vertices
    .map((vertex) => vertex.label.trim())
    .filter((label) => /^[A-Za-z]+$/.test(label));

  if (alphaLabels.length > 0) {
    const maxValue = Math.max(...alphaLabels.map((label) => alphaLabelToNumber(label)));
    return numberToAlphaLabel(maxValue + 1);
  }

  return numberToAlphaLabel(vertices.length + 1);
}

function buildFallbackPosition(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  const radius = Math.min(SVG_WIDTH, SVG_HEIGHT) * 0.32;
  return {
    x: SVG_WIDTH / 2 + Math.cos(angle) * radius,
    y: SVG_HEIGHT / 2 + Math.sin(angle) * radius
  };
}

function normalizeGraph(graph: Graph): Graph {
  const rawVertices = Array.isArray(graph.vertices) ? graph.vertices : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const settings = {
    directed: Boolean(graph.settings?.directed),
    weighted: Boolean(graph.settings?.weighted)
  };

  const seenVertexIds = new Set<string>();
  const vertices: Vertex[] = rawVertices.map((vertex, index) => {
    const fallbackPosition = buildFallbackPosition(index, rawVertices.length || 1);
    let id = `${vertex?.id ?? createId("v")}`;
    while (seenVertexIds.has(id)) {
      id = createId("v");
    }
    seenVertexIds.add(id);
    return {
      id,
      label: `${vertex?.label ?? numberToAlphaLabel(index + 1)}`.trim() || numberToAlphaLabel(index + 1),
      x: clamp(Number(vertex?.x) || fallbackPosition.x, 90, SVG_WIDTH - 90),
      y: clamp(Number(vertex?.y) || fallbackPosition.y, 90, SVG_HEIGHT - 90)
    };
  });

  const vertexIds = new Set(vertices.map((vertex) => vertex.id));
  const edges = new Map<string, Edge>();
  for (const edge of rawEdges) {
    const source = `${edge?.source ?? ""}`;
    const target = `${edge?.target ?? ""}`;
    if (!source || !target || source === target) {
      continue;
    }
    if (!vertexIds.has(source) || !vertexIds.has(target)) {
      continue;
    }

    const key = settings.directed
      ? `${source}->${target}`
      : [source, target].sort().join("--");
    const weight = settings.weighted && Number.isFinite(Number(edge?.weight)) ? Number(edge.weight) : 1;
    const existing = edges.get(key);
    if (!existing || weight < existing.weight) {
      edges.set(key, {
        id: existing?.id ?? `${edge?.id ?? createId("e")}`,
        source,
        target,
        weight
      });
    }
  }

  return {
    settings,
    vertices,
    edges: [...edges.values()]
  };
}

function ensureValidSelections() {
  const vertexIds = state.graph.vertices.map((vertex) => vertex.id);
  const edgeIds = state.graph.edges.map((edge) => edge.id);

  if (!vertexIds.includes(state.selectedVertexId ?? "")) {
    state.selectedVertexId = null;
  }
  if (!edgeIds.includes(state.selectedEdgeId ?? "")) {
    state.selectedEdgeId = null;
  }
  if (!vertexIds.includes(state.edgeDraftStartId ?? "")) {
    state.edgeDraftStartId = null;
  }
  if (!vertexIds.includes(state.sourceId ?? "")) {
    state.sourceId = vertexIds[0] ?? null;
  }
  if (!vertexIds.includes(state.targetId ?? "")) {
    state.targetId = vertexIds[1] ?? vertexIds[0] ?? null;
  }
}

function stopPlayback() {
  state.isPlaying = false;
  if (playbackTimer !== null) {
    window.clearTimeout(playbackTimer);
    playbackTimer = null;
  }
}

function clearTrace() {
  stopPlayback();
  state.trace = null;
  state.stepIndex = 0;
}

function stopTrace() {
  clearTrace();
  renderApp();
}

function pushHistory(snapshot: Graph) {
  state.historyPast.push(cloneGraph(snapshot));
  if (state.historyPast.length > 60) {
    state.historyPast.shift();
  }
  state.historyFuture = [];
}

function commitGraph(nextGraph: Graph, options: { recordHistory?: boolean; sampleId?: string } = {}) {
  const normalized = normalizeGraph(nextGraph);
  if (options.recordHistory !== false) {
    pushHistory(state.graph);
  }

  state.graph = normalized;
  state.sampleId = options.sampleId ?? "custom";
  ensureValidSelections();
  clearTrace();
  renderApp();
}

function loadGraph(graph: Graph, sampleId = "custom") {
  state.graph = normalizeGraph(graph);
  state.sampleId = sampleId;
  state.selectedVertexId = null;
  state.selectedEdgeId = null;
  state.edgeDraftStartId = null;
  state.edgeDraftPointer = null;
  ensureValidSelections();
  clearTrace();
  renderApp();
}

function toolLabel(tool: ToolMode) {
  switch (tool) {
    case "add-edge":
      return "Add Edge";
    case "add-vertex":
      return "Add Vertex";
    case "delete":
      return "Delete";
    default:
      return "Select";
  }
}

function graphStats() {
  const { vertices, edges } = state.graph;
  const maxEdges =
    vertices.length <= 1
      ? 0
      : state.graph.settings.directed
        ? vertices.length * (vertices.length - 1)
        : (vertices.length * (vertices.length - 1)) / 2;
  const density = maxEdges === 0 ? 0 : edges.length / maxEdges;
  return {
    vertices: vertices.length,
    edges: edges.length,
    density
  };
}

function vertexById(vertexId: string) {
  return state.graph.vertices.find((vertex) => vertex.id === vertexId) ?? null;
}

function edgeById(edgeId: string) {
  return state.graph.edges.find((edge) => edge.id === edgeId) ?? null;
}

function labelForVertex(vertexId: string | null) {
  return vertexId ? vertexById(vertexId)?.label ?? vertexId : "-";
}

function edgeKey(source: string, target: string) {
  return state.graph.settings.directed
    ? `${source}->${target}`
    : [source, target].sort().join("--");
}

function addVertex(position: { x: number; y: number }) {
  const nextGraph = cloneGraph(state.graph);
  nextGraph.vertices.push({
    id: createId("v"),
    label: nextVertexLabel(nextGraph.vertices),
    x: clamp(position.x, 90, SVG_WIDTH - 90),
    y: clamp(position.y, 90, SVG_HEIGHT - 90)
  });
  commitGraph(nextGraph);
}

function addEdge(sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    return;
  }

  const key = edgeKey(sourceId, targetId);
  const existing = state.graph.edges.find((edge) => edgeKey(edge.source, edge.target) === key);
  if (existing) {
    state.selectedEdgeId = existing.id;
    state.selectedVertexId = null;
    state.edgeDraftStartId = null;
    state.edgeDraftPointer = null;
    renderApp();
    return;
  }

  const nextGraph = cloneGraph(state.graph);
  const edge = {
    id: createId("e"),
    source: sourceId,
    target: targetId,
    weight: 1
  };
  nextGraph.edges.push(edge);
  state.selectedEdgeId = edge.id;
  state.selectedVertexId = null;
  state.edgeDraftStartId = null;
  state.edgeDraftPointer = null;
  commitGraph(nextGraph);
}

function deleteSelectedEntity() {
  if (state.selectedVertexId) {
    const nextGraph = cloneGraph(state.graph);
    nextGraph.vertices = nextGraph.vertices.filter((vertex) => vertex.id !== state.selectedVertexId);
    nextGraph.edges = nextGraph.edges.filter(
      (edge) => edge.source !== state.selectedVertexId && edge.target !== state.selectedVertexId
    );
    state.selectedVertexId = null;
    commitGraph(nextGraph);
    return;
  }

  if (state.selectedEdgeId) {
    const nextGraph = cloneGraph(state.graph);
    nextGraph.edges = nextGraph.edges.filter((edge) => edge.id !== state.selectedEdgeId);
    state.selectedEdgeId = null;
    commitGraph(nextGraph);
  }
}

function setGraphMode(mode: "directed" | "weighted") {
  const nextGraph = cloneGraph(state.graph);
  nextGraph.settings[mode] = !nextGraph.settings[mode];
  if (mode === "weighted" && !nextGraph.settings.weighted) {
    nextGraph.edges = nextGraph.edges.map((edge) => ({ ...edge, weight: 1 }));
  }
  commitGraph(nextGraph);
}

function setTool(tool: ToolMode) {
  state.tool = tool;
  state.edgeDraftPointer = null;
  if (tool !== "add-edge") {
    state.edgeDraftStartId = null;
  }
  renderApp();
}

function runAndPlaySelectedAlgorithm() {
  const definition = currentAlgorithm();
  const result = definition.run(state.graph, {
    startId: state.sourceId ?? undefined,
    targetId: state.targetId ?? undefined
  });
  state.trace = result;
  state.stepIndex = 0;
  stopPlayback();
  state.isPlaying = result.steps.length > 1;
  renderApp();
}

function goToStep(index: number) {
  if (!state.trace) {
    return;
  }

  stopPlayback();
  state.stepIndex = clamp(index, 0, Math.max(state.trace.steps.length - 1, 0));
  renderApp();
}

function togglePlayback() {
  if (!state.trace) {
    runAndPlaySelectedAlgorithm();
    return;
  }

  if (state.stepIndex >= state.trace.steps.length - 1) {
    state.stepIndex = 0;
  }

  state.isPlaying = !state.isPlaying;
  renderApp();
}

function setPlaybackSpeed(nextSpeed: number) {
  state.playbackSpeed = clamp(nextSpeed, 1, 100);
  if (playbackTimer !== null) {
    window.clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  const speedLabelEl = editorPanelEl.querySelector<HTMLElement>("#playback-speed-label");
  if (speedLabelEl) {
    speedLabelEl.textContent = `Speed: ${state.playbackSpeed}`;
  }
  syncPlayback();
}

function syncPlayback() {
  if (!state.trace || !state.isPlaying) {
    if (playbackTimer !== null) {
      window.clearTimeout(playbackTimer);
      playbackTimer = null;
    }
    return;
  }

  if (state.stepIndex >= state.trace.steps.length - 1) {
    stopPlayback();
    renderEditorPanel();
    return;
  }

  if (playbackTimer !== null) {
    return;
  }

  playbackTimer = window.setTimeout(() => {
    playbackTimer = null;
    state.stepIndex += 1;
    renderApp();
  }, speedToDelay(state.playbackSpeed));
}

function undo() {
  if (state.historyPast.length === 0) {
    return;
  }

  const previous = state.historyPast.pop() as Graph;
  state.historyFuture.push(cloneGraph(state.graph));
  state.graph = normalizeGraph(previous);
  state.sampleId = "custom";
  ensureValidSelections();
  clearTrace();
  renderApp();
}

function redo() {
  if (state.historyFuture.length === 0) {
    return;
  }

  const next = state.historyFuture.pop() as Graph;
  state.historyPast.push(cloneGraph(state.graph));
  state.graph = normalizeGraph(next);
  state.sampleId = "custom";
  ensureValidSelections();
  clearTrace();
  renderApp();
}

function exportGraph() {
  const blob = new Blob([JSON.stringify(state.graph, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "graph-visualizer.json";
  link.click();
  URL.revokeObjectURL(url);
}

function triggerImport() {
  importInputEl.value = "";
  importInputEl.click();
}

function createRandomGraph() {
  const vertexCount = clamp(Math.round(state.randomVertexCount), 2, 16);
  const vertices: Vertex[] = Array.from({ length: vertexCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / vertexCount;
    const radius = index % 2 === 0 ? 250 : 305;
    return {
      id: `v${index + 1}`,
      label: numberToAlphaLabel(index + 1),
      x: SVG_WIDTH / 2 + Math.cos(angle) * radius,
      y: SVG_HEIGHT / 2 + Math.sin(angle) * radius
    };
  });

  const possiblePairs: Array<[string, string]> = [];
  for (let index = 0; index < vertices.length; index += 1) {
    for (let other = 0; other < vertices.length; other += 1) {
      if (index === other) {
        continue;
      }

      if (!state.graph.settings.directed && other <= index) {
        continue;
      }

      possiblePairs.push([vertices[index].id, vertices[other].id]);
    }
  }

  const usedKeys = new Set<string>();
  const edges: Edge[] = [];
  const addRandomEdge = (source: string, target: string) => {
    const key = state.graph.settings.directed
      ? `${source}->${target}`
      : [source, target].sort().join("--");
    if (usedKeys.has(key)) {
      return false;
    }
    usedKeys.add(key);
    edges.push({
      id: createId("e"),
      source,
      target,
      weight: state.graph.settings.weighted ? Math.floor(Math.random() * 9) + 1 : 1
    });
    return true;
  };

  for (let index = 1; index < vertices.length; index += 1) {
    const otherIndex = Math.floor(Math.random() * index);
    const [source, target] = state.graph.settings.directed && Math.random() > 0.5
      ? [vertices[index].id, vertices[otherIndex].id]
      : [vertices[otherIndex].id, vertices[index].id];
    addRandomEdge(source, target);
  }

  const maxPossible = possiblePairs.length;
  const targetEdges = clamp(Math.round(state.randomEdgeCount), edges.length, maxPossible);
  const shuffled = [...possiblePairs].sort(() => Math.random() - 0.5);
  for (const [source, target] of shuffled) {
    if (edges.length >= targetEdges) {
      break;
    }
    addRandomEdge(source, target);
  }

  loadGraph(
    {
      settings: {
        directed: state.graph.settings.directed,
        weighted: state.graph.settings.weighted
      },
      vertices,
      edges
    },
    "custom"
  );
}

function adjacencyList() {
  const list = new Map<string, string[]>();
  for (const vertex of state.graph.vertices) {
    list.set(vertex.id, []);
  }

  for (const edge of state.graph.edges) {
    const weightText = state.graph.settings.weighted ? ` (${edge.weight})` : "";
    list.get(edge.source)?.push(`${labelForVertex(edge.target)}${weightText}`);
    if (!state.graph.settings.directed) {
      list.get(edge.target)?.push(`${labelForVertex(edge.source)}${weightText}`);
    }
  }

  return state.graph.vertices.map((vertex) => ({
    vertex: vertex.label,
    neighbors: list.get(vertex.id) ?? []
  }));
}

function adjacencyMatrix() {
  const ids = state.graph.vertices.map((vertex) => vertex.id);
  const matrix = ids.map(() => ids.map(() => "0"));

  for (const edge of state.graph.edges) {
    const sourceIndex = ids.indexOf(edge.source);
    const targetIndex = ids.indexOf(edge.target);
    const value = state.graph.settings.weighted ? `${edge.weight}` : "1";
    matrix[sourceIndex][targetIndex] = value;
    if (!state.graph.settings.directed) {
      matrix[targetIndex][sourceIndex] = value;
    }
  }

  return {
    headers: state.graph.vertices.map((vertex) => vertex.label),
    rows: matrix
  };
}

function edgeGeometry(edge: Edge) {
  const source = vertexById(edge.source) as Vertex;
  const target = vertexById(edge.target) as Vertex;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  const startOffset = VERTEX_RADIUS + 4;
  const endOffset = state.graph.settings.directed ? VERTEX_RADIUS + 8 : VERTEX_RADIUS + 4;
  const x1 = source.x + unitX * startOffset;
  const y1 = source.y + unitY * startOffset;
  const x2 = target.x - unitX * endOffset;
  const y2 = target.y - unitY * endOffset;
  const normalX = -unitY;
  const normalY = unitX;
  const labelX = (x1 + x2) / 2 + normalX * 18;
  const labelY = (y1 + y2) / 2 + normalY * 18;
  return {
    path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    labelX,
    labelY
  };
}

function edgePopoverPosition(edge: Edge) {
  const geometry = edgeGeometry(edge);
  const stageRect = graphStageEl.getBoundingClientRect();
  const svgRect = graphSvgEl.getBoundingClientRect();
  const scaleX = svgRect.width / SVG_WIDTH;
  const scaleY = svgRect.height / SVG_HEIGHT;
  const localX = svgRect.left - stageRect.left + geometry.labelX * scaleX;
  const localY = svgRect.top - stageRect.top + geometry.labelY * scaleY;
  return {
    x: localX,
    y: localY
  };
}

function renderEdgePopover() {
  const existing = graphStageEl.querySelector<HTMLElement>("[data-edge-popover]");
  const selectedEdge =
    state.tool === "select" && state.graph.settings.weighted && state.selectedEdgeId
      ? edgeById(state.selectedEdgeId)
      : null;

  if (!selectedEdge) {
    existing?.remove();
    return;
  }

  const popover = existing ?? document.createElement("div");
  if (!existing) {
    popover.dataset.edgePopover = "true";
    popover.className = "edge-popover";
    graphStageEl.append(popover);
  }

  const position = edgePopoverPosition(selectedEdge);
  const popoverHalfWidth = 108;
  const left = clamp(position.x, popoverHalfWidth + 12, graphStageEl.clientWidth - popoverHalfWidth - 12);
  const top = clamp(position.y - 92, 12, graphStageEl.clientHeight - 122);
  const edgeLabel = `${labelForVertex(selectedEdge.source)} ${state.graph.settings.directed ? "->" : "-"} ${labelForVertex(selectedEdge.target)}`;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.innerHTML = `
    <div class="edge-popover__title">${escapeHtml(edgeLabel)}</div>
    <label class="edge-popover__field">
      <span>Weight</span>
      <input id="edge-popover-weight" type="number" step="1" value="${selectedEdge.weight}" />
    </label>
    <button class="ghost-button edge-popover__delete" data-action="delete-selected">Delete</button>
  `;
}

function renderMetricBadges(metrics: Array<{ label: string; value: string }>) {
  return metrics
    .map(
      (metric) => `
        <div class="metric-chip">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderNotes(notes: Note[]) {
  if (notes.length === 0) {
    return "";
  }

  return `
    <div class="note-stack">
      ${notes
        .map(
          (entry) => `
            <div class="note note--${entry.tone}">
              ${escapeHtml(entry.text)}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTable(table: Table) {
  return `
    <section class="data-block">
      <div class="section-heading">
        <h3>${escapeHtml(table.title)}</h3>
      </div>
      ${
        table.rows.length > 0
          ? `
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${table.rows
                    .map(
                      (row) => `
                        <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `<div class="empty-state">${escapeHtml(table.emptyMessage ?? "No rows to display.")}</div>`
      }
    </section>
  `;
}

function renderGraphDataContent() {
  const list = adjacencyList();
  const matrix = adjacencyMatrix();
  const step = currentStep();

  return `
    <section class="data-block">
      <div class="section-heading">
        <h3>Live structures</h3>
      </div>
      <div class="sequence-grid">
        <div class="sequence-card">
          <span>Queue</span>
          <strong>${step?.queue?.join(" -> ") || "-"}</strong>
        </div>
        <div class="sequence-card">
          <span>Stack</span>
          <strong>${step?.stack?.join(" -> ") || "-"}</strong>
        </div>
        <div class="sequence-card sequence-card--full">
          <span>Order</span>
          <strong>${step?.order?.join(" -> ") || "-"}</strong>
        </div>
      </div>
    </section>

    <section class="data-block">
      <div class="section-heading">
        <h3>Adjacency list</h3>
      </div>
      <div class="micro-list">
        ${list
          .map(
            (entry) => `
              <div><strong>${escapeHtml(entry.vertex)}</strong>: ${escapeHtml(
                entry.neighbors.join(", ") || "none"
              )}</div>
            `
          )
          .join("")}
      </div>
    </section>

    ${renderTable({
      title: "Adjacency matrix",
      columns: ["", ...matrix.headers],
      rows: matrix.rows.map((row, index) => [matrix.headers[index], ...row])
    })}
  `;
}

function renderHero() {}

function renderEditorPanel() {
  const selectedVertex = state.selectedVertexId ? vertexById(state.selectedVertexId) : null;
  const selectedEdge = state.selectedEdgeId ? edgeById(state.selectedEdgeId) : null;
  const definition = currentAlgorithm();
  const step = currentStep();
  const hasTrace = Boolean(state.trace);
  const optionFieldCount = Number(Boolean(definition.requiresStart)) + Number(Boolean(definition.requiresTarget));
  const optionFieldClass = optionFieldCount <= 1 ? "field-grid field-grid--single" : "field-grid";
  const selectionActionCount = Number(Boolean(definition.requiresStart)) + Number(Boolean(definition.requiresTarget));
  const selectionActionClass = selectionActionCount <= 1 ? "action-grid action-grid--single" : "action-grid";
  const algorithmOptionFields = [
    definition.requiresStart
      ? `
        <label class="field">
          <span>Source</span>
          <select id="source-select">
            ${state.graph.vertices
              .map(
                (vertex) => `
                  <option value="${vertex.id}" ${vertex.id === state.sourceId ? "selected" : ""}>${escapeHtml(vertex.label)}</option>
                `
              )
              .join("")}
          </select>
        </label>
      `
      : "",
    definition.requiresTarget
      ? `
        <label class="field">
          <span>Target</span>
          <select id="target-select">
            <option value="">None</option>
            ${state.graph.vertices
              .map(
                (vertex) => `
                  <option value="${vertex.id}" ${vertex.id === state.targetId ? "selected" : ""}>${escapeHtml(vertex.label)}</option>
                `
              )
              .join("")}
          </select>
        </label>
      `
      : ""
  ]
    .filter(Boolean)
    .join("");
  const selectionActionButtons = [
    definition.requiresStart ? `<button class="ghost-button" data-action="assign-source">Set Source</button>` : "",
    definition.requiresTarget ? `<button class="ghost-button" data-action="assign-target">Set Target</button>` : ""
  ]
    .filter(Boolean)
    .join("");
  const primaryLabel = !hasTrace
    ? `Run ${definition.name}`
    : state.isPlaying
      ? "Pause"
      : state.stepIndex >= Math.max((state.trace?.steps.length ?? 1) - 1, 0)
        ? "Replay"
        : "Play";

  const toolButtons = [
    { id: "select", label: "Select" },
    { id: "add-vertex", label: "Add Vertex" },
    { id: "add-edge", label: "Add Edge" },
    { id: "delete", label: "Delete" }
  ];

  editorPanelEl.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Controls</p>
        <h2>Graph Visualizer</h2>
      </div>
      <span class="status-dot ${state.edgeDraftStartId ? "status-dot--active" : ""}"></span>
    </div>

    <section class="control-section">
      <div class="section-heading">
        <h3>Mode</h3>
      </div>
      <div class="mode-toggle-grid">
        <button class="toggle-card ${state.graph.settings.directed ? "is-active" : ""}" data-action="toggle-directed">
          <span>Direction</span>
          <strong>${state.graph.settings.directed ? "Directed" : "Undirected"}</strong>
        </button>
        <button class="toggle-card ${state.graph.settings.weighted ? "is-active" : ""}" data-action="toggle-weighted">
          <span>Weighting</span>
          <strong>${state.graph.settings.weighted ? "Weighted" : "Unweighted"}</strong>
        </button>
      </div>
    </section>

    <section class="control-section">
      <div class="section-heading">
        <h3>Edit</h3>
      </div>
      <div class="tool-grid">
        ${toolButtons
          .map(
            (tool) => `
              <button
                class="tool-button ${state.tool === tool.id ? "is-active" : ""}"
                data-action="set-tool"
                data-tool="${tool.id}"
              >
                ${escapeHtml(tool.label)}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="action-grid action-grid--edit">
        <button class="ghost-button" data-action="generate-random-graph">Random Graph</button>
        <button class="ghost-button" data-action="clear-graph">Clear All</button>
      </div>
      <p class="microcopy">Drag in Select mode. Add Edge connects two clicked vertices.</p>
    </section>

    <section class="control-section">
      <div class="section-heading">
        <h3>Algorithm</h3>
      </div>
      <label class="field">
        <span>Algorithm</span>
        <select id="algorithm-select">
          ${algorithmDefinitions
            .map(
              (algorithm) => `
                <option value="${algorithm.id}" ${algorithm.id === state.algorithmId ? "selected" : ""}>
                  ${escapeHtml(algorithm.name)}
                </option>
              `
            )
            .join("")}
        </select>
      </label>
      ${algorithmOptionFields ? `<div class="${optionFieldClass}">${algorithmOptionFields}</div>` : ""}
      <button class="primary-button primary-button--play" data-action="run-or-toggle-playback">${escapeHtml(primaryLabel)}</button>
      <div class="transport-row transport-row--sidebar">
        <button class="ghost-button" data-action="stop-trace" ${!hasTrace ? "disabled" : ""}>Stop</button>
        <button class="ghost-button" data-action="restart-trace" ${!hasTrace ? "disabled" : ""}>Restart</button>
        <button class="ghost-button" data-action="prev-step" ${!hasTrace || state.stepIndex === 0 ? "disabled" : ""}>Prev</button>
        <button class="ghost-button" data-action="next-step" ${
          !hasTrace || state.stepIndex >= Math.max((state.trace?.steps.length ?? 1) - 1, 0) ? "disabled" : ""
        }>Next</button>
      </div>
      <label class="field">
        <span id="playback-speed-label">Speed: ${state.playbackSpeed}</span>
        <input id="playback-speed" max="100" min="1" step="1" type="range" value="${state.playbackSpeed}" />
      </label>
      ${
        hasTrace && step
          ? `
            <label class="field">
              <span>Step ${state.stepIndex + 1} of ${state.trace?.steps.length ?? 0}</span>
              <input id="trace-step" max="${Math.max((state.trace?.steps.length ?? 1) - 1, 0)}" min="0" step="1" type="range" value="${state.stepIndex}" />
            </label>
            <div class="playback-card">
              <strong>${escapeHtml(step.title)}</strong>
              <p>${escapeHtml(step.description)}</p>
            </div>
          `
          : `
            <div class="empty-state">
              Press ${escapeHtml(`Run ${definition.name}`)} to start the visualization.
            </div>
          `
      }
      <div class="mini-metrics">
        <span>Time: <strong>${escapeHtml(definition.time)}</strong></span>
        <span>Space: <strong>${escapeHtml(definition.space)}</strong></span>
      </div>
      <p class="microcopy">${escapeHtml(definition.description)}</p>
    </section>

    <section class="control-section">
      <div class="section-heading">
        <h3>Selection</h3>
      </div>
      ${
        selectedVertex
          ? `
            <div class="inspector-card">
              <p class="inspector-title">${escapeHtml(selectedVertex.label)}</p>
              <label class="field">
                <span>Label</span>
                <input id="vertex-label" type="text" value="${escapeHtml(selectedVertex.label)}" />
              </label>
              ${selectionActionButtons ? `<div class="${selectionActionClass}">${selectionActionButtons}</div>` : ""}
            </div>
          `
          : selectedEdge
            ? `
              <div class="inspector-card">
                <p class="inspector-title">${escapeHtml(
                  `${labelForVertex(selectedEdge.source)} ${state.graph.settings.directed ? "->" : "-"} ${labelForVertex(selectedEdge.target)}`
                )}</p>
                <div class="mini-metrics">
                  <span>${state.graph.settings.weighted ? `Weight: ${selectedEdge.weight}` : "Unweighted edge"}</span>
                </div>
              </div>
            `
            : `
              <div class="empty-state">
                Select a vertex or edge to edit it.
              </div>
            `
      }
    </section>

    <details class="control-disclosure">
      <summary>More tools</summary>
      <div class="disclosure-body">
        <section class="control-section control-section--tight">
          <div class="section-heading">
            <h3>Random graph</h3>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Vertices</span>
              <input id="random-vertices" min="2" max="16" step="1" type="number" value="${state.randomVertexCount}" />
            </label>
            <label class="field">
              <span>Edges</span>
              <input id="random-edges" min="1" max="120" step="1" type="number" value="${state.randomEdgeCount}" />
            </label>
          </div>
        </section>
        <section class="control-section control-section--tight">
          <div class="section-heading">
            <h3>Project actions</h3>
          </div>
          <div class="action-grid">
            <button class="ghost-button" data-action="undo" ${state.historyPast.length === 0 ? "disabled" : ""}>Undo</button>
            <button class="ghost-button" data-action="redo" ${state.historyFuture.length === 0 ? "disabled" : ""}>Redo</button>
            <button class="ghost-button" data-action="export-graph">Export</button>
            <button class="ghost-button" data-action="import-graph">Import</button>
            <button class="ghost-button" data-action="delete-selected" ${
              !selectedVertex && !selectedEdge ? "disabled" : ""
            }>Delete</button>
          </div>
        </section>
      </div>
    </details>

    <details class="control-disclosure control-disclosure--subtle">
      <summary>Samples</summary>
      <div class="disclosure-body">
        <label class="field">
          <span>Load sample graph</span>
          <select id="sample-select">
            <option value="custom" ${state.sampleId === "custom" ? "selected" : ""}>Custom graph</option>
            ${sampleDefinitions
              .map(
                (sample) => `
                  <option value="${sample.id}" ${state.sampleId === sample.id ? "selected" : ""}>${escapeHtml(sample.name)}</option>
                `
              )
              .join("")}
          </select>
        </label>
      </div>
    </details>
  `;
}

function renderStageToolbar() {}

function renderGraph() {
  const step = currentStep();
  const vertexVisuals = step?.vertices ?? {};
  const edgeVisuals = step?.edges ?? {};
  const vertexMap = new Map(state.graph.vertices.map((vertex) => [vertex.id, vertex]));
  const previewPath =
    state.tool === "add-edge" && state.edgeDraftStartId && state.edgeDraftPointer
      ? (() => {
          const start = vertexMap.get(state.edgeDraftStartId);
          if (!start) {
            return "";
          }
          return `<path class="preview-edge" d="M ${start.x} ${start.y} L ${state.edgeDraftPointer.x} ${state.edgeDraftPointer.y}" />`;
        })()
      : "";

  graphSvgEl.innerHTML = `
    <defs>
      <marker
        id="edge-arrow"
        markerUnits="userSpaceOnUse"
        markerWidth="8"
        markerHeight="8"
        refX="7"
        refY="3.5"
        orient="auto-start-reverse"
        viewBox="0 0 7 7"
      >
        <path d="M 0 0 L 7 3.5 L 0 7 z" fill="context-stroke"></path>
      </marker>
      <filter id="node-shadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="10" stdDeviation="10" flood-opacity="0.18"></feDropShadow>
      </filter>
    </defs>
    ${state.graph.edges
      .map((edge) => {
        const geometry = edgeGeometry(edge);
        const tone = edgeVisuals[edge.id]?.tone ?? "idle";
        const selectedClass = state.selectedEdgeId === edge.id ? "is-selected" : "";
        const label = state.graph.settings.weighted ? `${edge.weight}` : "";
        return `
          <g class="edge edge--${tone} ${selectedClass}" data-edge-id="${edge.id}">
            <path class="edge-hitbox" d="${geometry.path}" data-edge-id="${edge.id}"></path>
            <path
              class="edge-line"
              d="${geometry.path}"
              ${state.graph.settings.directed ? 'marker-end="url(#edge-arrow)"' : ""}
              data-edge-id="${edge.id}"
            ></path>
            ${
              label
                ? `
                  <text
                    class="edge-label"
                    data-edge-id="${edge.id}"
                    x="${geometry.labelX}"
                    y="${geometry.labelY}"
                  >${escapeHtml(label)}</text>
                `
                : ""
            }
          </g>
        `;
      })
      .join("")}
    ${previewPath}
    ${state.graph.vertices
      .map((vertex) => {
        const visual = vertexVisuals[vertex.id] ?? {};
        const badges = visual.badges ?? [];
        const badgeText = badges.join(" · ");
        const badgeWidth = clamp(58 + badgeText.length * 5.2, 68, 170);
        const tone = visual.component !== undefined ? "component" : visual.tone ?? "idle";
        const style =
          visual.component !== undefined
            ? `style="--component-color:${componentColor(visual.component)}"`
            : "";
        const pendingClass = state.edgeDraftStartId === vertex.id ? "is-pending" : "";
        const selectedClass = state.selectedVertexId === vertex.id ? "is-selected" : "";
        return `
          <g
            class="vertex vertex--${tone} ${selectedClass} ${pendingClass}"
            data-vertex-id="${vertex.id}"
            transform="translate(${vertex.x}, ${vertex.y})"
            ${style}
          >
            <circle class="vertex-circle" r="${VERTEX_RADIUS}" filter="url(#node-shadow)"></circle>
            <text class="vertex-title" text-anchor="middle" dy="6">${escapeHtml(vertex.label)}</text>
            ${
              badgeText
                ? `
                  <g class="vertex-badge" transform="translate(0, ${VERTEX_RADIUS + 20})">
                    <rect x="${-(badgeWidth / 2)}" y="-10" width="${badgeWidth}" height="20" rx="10"></rect>
                    <text text-anchor="middle" dy="4">${escapeHtml(badgeText)}</text>
                  </g>
                `
                : ""
            }
          </g>
        `;
      })
      .join("")}
  `;
  renderEdgePopover();
}

function renderOverlay() {}

function renderAlgorithmPanel() {}

function renderTimelinePanel() {}

function renderSummaryPanel() {}

function renderTablesPanel() {}

function renderDataPanel() {}

function renderApp() {
  ensureValidSelections();
  renderEditorPanel();
  renderGraph();
  syncPlayback();
}

function pointerToSvg(event: PointerEvent | MouseEvent) {
  const point = graphSvgEl.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = graphSvgEl.getScreenCTM();
  if (!matrix) {
    return { x: SVG_WIDTH / 2, y: SVG_HEIGHT / 2 };
  }

  const transformed = point.matrixTransform(matrix.inverse());
  return {
    x: clamp(transformed.x, 30, SVG_WIDTH - 30),
    y: clamp(transformed.y, 30, SVG_HEIGHT - 30)
  };
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    switch (action) {
      case "set-tool":
        setTool(actionTarget.dataset.tool as ToolMode);
        return;
      case "toggle-directed":
        setGraphMode("directed");
        return;
      case "toggle-weighted":
        setGraphMode("weighted");
        return;
      case "load-sample":
        {
          const sampleId = actionTarget.dataset.sampleId ?? "showcase";
          loadGraph(getSampleGraph(sampleId), sampleId);
        }
        return;
      case "generate-random-graph":
        createRandomGraph();
        return;
      case "undo":
        undo();
        return;
      case "redo":
        redo();
        return;
      case "run-or-toggle-playback":
        togglePlayback();
        return;
      case "stop-trace":
        stopTrace();
        return;
      case "prev-step":
        goToStep(state.stepIndex - 1);
        return;
      case "next-step":
        goToStep(state.stepIndex + 1);
        return;
      case "restart-trace":
        goToStep(0);
        return;
      case "export-graph":
        exportGraph();
        return;
      case "import-graph":
        triggerImport();
        return;
      case "clear-graph":
        if (state.graph.vertices.length === 0 && state.graph.edges.length === 0) {
          return;
        }
        commitGraph({
          settings: { ...state.graph.settings },
          vertices: [],
          edges: []
        });
        return;
      case "delete-selected":
        deleteSelectedEntity();
        return;
      case "assign-source":
        if (state.selectedVertexId) {
          state.sourceId = state.selectedVertexId;
          renderApp();
        }
        return;
      case "assign-target":
        if (state.selectedVertexId) {
          state.targetId = state.selectedVertexId;
          renderApp();
        }
        return;
      default:
        break;
    }
  }

  if (target.closest("[data-edge-popover]")) {
    return;
  }

  const vertexTarget = target.closest<HTMLElement>("[data-vertex-id]");
  const edgeTarget = target.closest<HTMLElement>("[data-edge-id]");

  if (!graphStageEl.contains(target)) {
    return;
  }

  if (suppressNextGraphClick) {
    suppressNextGraphClick = false;
    return;
  }

  if (vertexTarget) {
    const vertexId = vertexTarget.dataset.vertexId as string;
    if (state.tool === "add-edge") {
      if (!state.edgeDraftStartId) {
        state.edgeDraftStartId = vertexId;
        state.edgeDraftPointer = null;
        state.selectedVertexId = vertexId;
        state.selectedEdgeId = null;
        renderApp();
        return;
      }

      addEdge(state.edgeDraftStartId, vertexId);
      return;
    }

    if (state.tool === "delete") {
      state.selectedVertexId = vertexId;
      state.selectedEdgeId = null;
      deleteSelectedEntity();
      return;
    }

    state.selectedVertexId = vertexId;
    state.selectedEdgeId = null;
    renderApp();
    return;
  }

  if (edgeTarget) {
    const edgeId = edgeTarget.dataset.edgeId as string;
    if (state.tool === "delete") {
      state.selectedEdgeId = edgeId;
      state.selectedVertexId = null;
      deleteSelectedEntity();
      return;
    }

    if (state.tool === "select") {
      state.selectedEdgeId = edgeId;
      state.selectedVertexId = null;
      renderApp();
    }
    return;
  }

  if (state.tool === "add-vertex") {
    const point = pointerToSvg(event as MouseEvent);
    addVertex(point);
    return;
  }

  if (state.tool === "add-edge") {
    state.edgeDraftStartId = null;
    state.edgeDraftPointer = null;
  }

  if (state.tool === "select") {
    state.selectedVertexId = null;
    state.selectedEdgeId = null;
  }

  renderApp();
});

graphStageEl.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const vertexTarget = target.closest<HTMLElement>("[data-vertex-id]");
  if (state.tool !== "select" || !vertexTarget) {
    return;
  }

  const vertexId = vertexTarget.dataset.vertexId as string;
  dragState = {
    vertexId,
    beforeGraph: cloneGraph(state.graph),
    moved: false
  };
});

window.addEventListener("pointermove", (event) => {
  if (state.tool === "add-edge" && state.edgeDraftStartId) {
    state.edgeDraftPointer = pointerToSvg(event);
    renderGraph();
  }

  if (!dragState) {
    return;
  }

  if (!dragState.moved) {
    dragState.moved = true;
    clearTrace();
  }

  const point = pointerToSvg(event);
  const vertex = vertexById(dragState.vertexId);
  if (!vertex) {
    return;
  }
  vertex.x = clamp(point.x, 90, SVG_WIDTH - 90);
  vertex.y = clamp(point.y, 90, SVG_HEIGHT - 90);
  renderGraph();
});

window.addEventListener("pointerup", () => {
  if (!dragState) {
    return;
  }

  if (dragState.moved) {
    pushHistory(dragState.beforeGraph);
    state.historyFuture = [];
    state.sampleId = "custom";
    ensureValidSelections();
    suppressNextGraphClick = true;
    renderApp();
  }

  dragState = null;
});

graphStageEl.addEventListener("pointerleave", () => {
  if (state.tool === "add-edge" && state.edgeDraftStartId) {
    state.edgeDraftPointer = null;
    renderGraph();
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;

  switch (target.id) {
    case "algorithm-select":
      state.algorithmId = target.value as AlgorithmId;
      clearTrace();
      renderApp();
      return;
    case "sample-select":
      if (target.value === "custom") {
        state.sampleId = "custom";
        renderEditorPanel();
      } else {
        const sampleId = target.value;
        loadGraph(getSampleGraph(sampleId), sampleId);
      }
      return;
    case "source-select":
      state.sourceId = target.value || null;
      renderApp();
      return;
    case "target-select":
      state.targetId = target.value || null;
      renderApp();
      return;
    case "random-vertices":
      state.randomVertexCount = Number(target.value) || state.randomVertexCount;
      return;
    case "random-edges":
      state.randomEdgeCount = Number(target.value) || state.randomEdgeCount;
      return;
    case "vertex-label":
      if (state.selectedVertexId) {
        const vertex = vertexById(state.selectedVertexId);
        if (vertex) {
          const nextGraph = cloneGraph(state.graph);
          const nextVertex = nextGraph.vertices.find((entry) => entry.id === state.selectedVertexId);
          if (nextVertex) {
            nextVertex.label = target.value.trim() || nextVertex.label;
            commitGraph(nextGraph, { sampleId: "custom" });
          }
        }
      }
      return;
    case "edge-popover-weight":
      if (state.selectedEdgeId) {
        const nextGraph = cloneGraph(state.graph);
        const edge = nextGraph.edges.find((entry) => entry.id === state.selectedEdgeId);
        if (edge) {
          const nextWeight = Number(target.value);
          edge.weight = Number.isFinite(nextWeight) ? nextWeight : edge.weight;
          commitGraph(nextGraph, { sampleId: "custom" });
        }
      }
      return;
    case "import-file": {
      const file = importInputEl.files?.[0];
      if (!file) {
        return;
      }

      try {
        const parsed = JSON.parse(await file.text()) as Graph;
        loadGraph(parsed, "custom");
      } catch (error) {
        console.error("Import failed", error);
      }
      return;
    }
    default:
      return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  switch (target.id) {
    case "trace-step":
      goToStep(Number(target.value));
      return;
    case "playback-speed":
      setPlaybackSpeed(Number(target.value));
      return;
    default:
      return;
  }
});

window.addEventListener("keydown", (event) => {
  if ((event.key === "Backspace" || event.key === "Delete") && !(event.target instanceof HTMLInputElement)) {
    deleteSelectedEntity();
    return;
  }

  if (event.key === "Escape") {
    state.edgeDraftStartId = null;
    state.edgeDraftPointer = null;
    state.selectedVertexId = null;
    state.selectedEdgeId = null;
    stopPlayback();
    renderApp();
    return;
  }

  const undoPressed = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
  if (undoPressed && !event.shiftKey) {
    event.preventDefault();
    undo();
    return;
  }

  if (undoPressed && event.shiftKey) {
    event.preventDefault();
    redo();
  }
});

window.addEventListener("resize", () => {
  renderGraph();
});

renderApp();
