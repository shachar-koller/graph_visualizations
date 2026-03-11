export type ToolMode = "select" | "add-vertex" | "add-edge" | "delete";

export type AlgorithmId =
  | "bfs"
  | "dfs"
  | "dijkstra"
  | "bellman-ford"
  | "prim"
  | "kruskal"
  | "kosaraju"
  | "toposort"
  | "dag-shortest-path"
  | "components";

export interface GraphSettings {
  directed: boolean;
  weighted: boolean;
}

export interface Vertex {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface Graph {
  settings: GraphSettings;
  vertices: Vertex[];
  edges: Edge[];
}

export interface AlgorithmOptions {
  startId?: string;
  targetId?: string;
}

export type VertexTone =
  | "idle"
  | "source"
  | "target"
  | "frontier"
  | "active"
  | "visited"
  | "settled"
  | "component"
  | "muted";

export type EdgeTone =
  | "idle"
  | "active"
  | "tree"
  | "back"
  | "forward"
  | "cross"
  | "candidate"
  | "selected"
  | "rejected"
  | "relaxed"
  | "path"
  | "muted";

export interface VertexVisual {
  tone?: VertexTone;
  badges?: string[];
  component?: number;
}

export interface EdgeVisual {
  tone?: EdgeTone;
}

export interface Metric {
  label: string;
  value: string;
}

export interface Note {
  tone: "info" | "warning" | "success";
  text: string;
}

export interface TraceStep {
  title: string;
  description: string;
  vertices: Record<string, VertexVisual>;
  edges: Record<string, EdgeVisual>;
  metrics: Metric[];
  notes: Note[];
  queue?: string[];
  stack?: string[];
  order?: string[];
}

export interface Table {
  title: string;
  columns: string[];
  rows: string[][];
  emptyMessage?: string;
}

export interface AlgorithmSummary {
  headline: string;
  details: string[];
  notes: Note[];
  metrics: Metric[];
  complexity: {
    time: string;
    space: string;
  };
}

export interface AlgorithmRun {
  algorithmId: AlgorithmId;
  name: string;
  description: string;
  steps: TraceStep[];
  summary: AlgorithmSummary;
  tables: Table[];
  path?: string[];
  componentGroups?: string[][];
}

export interface AlgorithmDefinition {
  id: AlgorithmId;
  name: string;
  category: string;
  description: string;
  time: string;
  space: string;
  requiresStart?: boolean;
  requiresTarget?: boolean;
  run: (graph: Graph, options: AlgorithmOptions) => AlgorithmRun;
}

export interface SampleDefinition {
  id: string;
  name: string;
  blurb: string;
  graph: Graph;
}
