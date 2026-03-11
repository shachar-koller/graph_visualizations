import type {
  AlgorithmDefinition,
  AlgorithmId,
  AlgorithmOptions,
  AlgorithmRun,
  AlgorithmSummary,
  Edge,
  EdgeTone,
  Graph,
  Metric,
  Note,
  Table,
  TraceStep,
  VertexVisual
} from "./types";

interface AdjacencyEntry {
  from: string;
  to: string;
  edge: Edge;
  weight: number;
}

class TraceBuilder {
  vertices: Record<string, VertexVisual>;
  edges: Record<string, { tone?: EdgeTone }>;
  metrics: Metric[] = [];
  notes: Note[] = [];
  queue: string[] = [];
  stack: string[] = [];
  order: string[] = [];
  steps: TraceStep[] = [];

  constructor(private readonly graph: Graph) {
    this.vertices = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, { tone: "idle", badges: [] }])
    );
    this.edges = Object.fromEntries(graph.edges.map((edge) => [edge.id, { tone: "idle" }]));
  }

  setVertexTone(vertexId: string, tone: VertexVisual["tone"]) {
    this.vertices[vertexId] = {
      ...this.vertices[vertexId],
      tone
    };
  }

  setVertexBadges(vertexId: string, badges: string[]) {
    this.vertices[vertexId] = {
      ...this.vertices[vertexId],
      badges
    };
  }

  setVertexComponent(vertexId: string, component: number) {
    this.vertices[vertexId] = {
      ...this.vertices[vertexId],
      tone: "component",
      component
    };
  }

  setEdgeTone(edgeId: string, tone: EdgeTone) {
    this.edges[edgeId] = {
      ...this.edges[edgeId],
      tone
    };
  }

  setMetrics(metrics: Metric[]) {
    this.metrics = metrics;
  }

  setNotes(notes: Note[]) {
    this.notes = notes;
  }

  push(title: string, description: string) {
    this.steps.push({
      title,
      description,
      vertices: structuredClone(this.vertices),
      edges: structuredClone(this.edges),
      metrics: [...this.metrics],
      notes: [...this.notes],
      queue: [...this.queue],
      stack: [...this.stack],
      order: [...this.order]
    });
  }
}

class MinPriorityQueue<T> {
  private heap: Array<{ priority: number; value: T }> = [];

  get size() {
    return this.heap.length;
  }

  push(value: T, priority: number) {
    this.heap.push({ priority, value });
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) {
      return undefined;
    }

    const first = this.heap[0];
    const last = this.heap.pop();
    if (last && this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return first;
  }

  private bubbleUp(index: number) {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[currentIndex].priority) {
        break;
      }

      [this.heap[parentIndex], this.heap[currentIndex]] = [
        this.heap[currentIndex],
        this.heap[parentIndex]
      ];
      currentIndex = parentIndex;
    }
  }

  private bubbleDown(index: number) {
    let currentIndex = index;
    while (true) {
      const left = currentIndex * 2 + 1;
      const right = currentIndex * 2 + 2;
      let nextIndex = currentIndex;

      if (
        left < this.heap.length &&
        this.heap[left].priority < this.heap[nextIndex].priority
      ) {
        nextIndex = left;
      }

      if (
        right < this.heap.length &&
        this.heap[right].priority < this.heap[nextIndex].priority
      ) {
        nextIndex = right;
      }

      if (nextIndex === currentIndex) {
        break;
      }

      [this.heap[currentIndex], this.heap[nextIndex]] = [
        this.heap[nextIndex],
        this.heap[currentIndex]
      ];
      currentIndex = nextIndex;
    }
  }
}

class DisjointSet {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) {
      return id;
    }

    if (parent === id) {
      return id;
    }

    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }

    return true;
  }
}

function labelFor(graph: Graph, vertexId: string) {
  return graph.vertices.find((vertex) => vertex.id === vertexId)?.label ?? vertexId;
}

function edgeLabel(graph: Graph, edge: Edge, from = edge.source, to = edge.target) {
  const connector = graph.settings.directed ? "->" : "-";
  return `${labelFor(graph, from)} ${connector} ${labelFor(graph, to)}`;
}

function weightFor(graph: Graph, edge: Edge) {
  return graph.settings.weighted ? edge.weight : 1;
}

function buildAdjacency(
  graph: Graph,
  options: { reversed?: boolean; undirectedOverride?: boolean } = {}
) {
  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const vertex of graph.vertices) {
    adjacency.set(vertex.id, []);
  }

  for (const edge of graph.edges) {
    const weight = weightFor(graph, edge);
    const directed = options.undirectedOverride ? false : graph.settings.directed;

    if (directed) {
      const from = options.reversed ? edge.target : edge.source;
      const to = options.reversed ? edge.source : edge.target;
      adjacency.get(from)?.push({ from, to, edge, weight });
    } else {
      adjacency.get(edge.source)?.push({
        from: edge.source,
        to: edge.target,
        edge,
        weight
      });
      adjacency.get(edge.target)?.push({
        from: edge.target,
        to: edge.source,
        edge,
        weight
      });
    }
  }

  return adjacency;
}

function buildRelaxationEdges(graph: Graph, options: { undirectedOverride?: boolean } = {}) {
  const directed = options.undirectedOverride ? false : graph.settings.directed;
  const edges: AdjacencyEntry[] = [];
  for (const edge of graph.edges) {
    const weight = weightFor(graph, edge);
    edges.push({ from: edge.source, to: edge.target, edge, weight });
    if (!directed) {
      edges.push({ from: edge.target, to: edge.source, edge, weight });
    }
  }
  return edges;
}

function pickStartId(graph: Graph, options: AlgorithmOptions) {
  return options.startId ?? graph.vertices[0]?.id;
}

function pickTargetId(graph: Graph, options: AlgorithmOptions) {
  return options.targetId;
}

function formatDistance(distance: number) {
  return Number.isFinite(distance) ? `${distance}` : "inf";
}

function sumWeights(graph: Graph, edgeIds: string[]) {
  let total = 0;
  for (const edgeId of edgeIds) {
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    if (edge) {
      total += weightFor(graph, edge);
    }
  }
  return total;
}

function findPath(
  parent: Record<string, string | null>,
  parentEdge: Record<string, string | null>,
  startId: string,
  targetId: string
) {
  const vertexPath: string[] = [];
  const edgePath: string[] = [];
  let current: string | null = targetId;

  while (current) {
    vertexPath.push(current);
    if (current === startId) {
      return {
        vertices: vertexPath.reverse(),
        edges: edgePath.reverse()
      };
    }

    const viaEdge = parentEdge[current];
    if (viaEdge) {
      edgePath.push(viaEdge);
    }

    current = parent[current];
  }

  return {
    vertices: [],
    edges: []
  };
}

function note(tone: Note["tone"], text: string): Note {
  return { tone, text };
}

function defaultSummary(
  definition: Pick<AlgorithmDefinition, "time" | "space">,
  headline: string,
  details: string[],
  notes: Note[],
  metrics: Metric[]
): AlgorithmSummary {
  return {
    headline,
    details,
    notes,
    metrics,
    complexity: {
      time: definition.time,
      space: definition.space
    }
  };
}

function invalidRun(
  definition: AlgorithmDefinition,
  title: string,
  message: string,
  details: string[]
): AlgorithmRun {
  const step: TraceStep = {
    title,
    description: message,
    vertices: {},
    edges: {},
    metrics: [],
    notes: [note("warning", message)]
  };

  return {
    algorithmId: definition.id,
    name: definition.name,
    description: definition.description,
    steps: [step],
    summary: defaultSummary(definition, "Configuration issue", details, [note("warning", message)], []),
    tables: [],
    issue: {
      title,
      message,
      details
    }
  };
}

function createVertexTable(
  title: string,
  columns: string[],
  rows: string[][]
): Table {
  return {
    title,
    columns,
    rows,
    emptyMessage: "No data available yet."
  };
}

function refreshDistanceBadges(
  builder: TraceBuilder,
  graph: Graph,
  distances: Record<string, number>,
  parent: Record<string, string | null>
) {
  for (const vertex of graph.vertices) {
    builder.setVertexBadges(vertex.id, [
      `d:${formatDistance(distances[vertex.id] ?? Number.POSITIVE_INFINITY)}`,
      `pi:${parent[vertex.id] ? labelFor(graph, parent[vertex.id] as string) : "-"}`
    ]);
  }
}

function refreshTraversalBadges(
  builder: TraceBuilder,
  graph: Graph,
  pre: Record<string, number>,
  post: Record<string, number>,
  reversePostRank: Record<string, number>
) {
  for (const vertex of graph.vertices) {
    builder.setVertexBadges(vertex.id, [
      `pre:${pre[vertex.id] ?? "-"}`,
      `post:${post[vertex.id] ?? "-"}`,
      `rpo:${reversePostRank[vertex.id] ?? "-"}`
    ]);
  }
}

function topologicalOrderData(graph: Graph) {
  if (!graph.settings.directed) {
    return { isDag: false, order: [] as string[] };
  }

  const adjacency = buildAdjacency(graph);
  const indegree: Record<string, number> = Object.fromEntries(
    graph.vertices.map((vertex) => [vertex.id, 0])
  );
  for (const edge of graph.edges) {
    indegree[edge.target] += 1;
  }

  const queue = graph.vertices
    .filter((vertex) => indegree[vertex.id] === 0)
    .map((vertex) => vertex.id);

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const entry of adjacency.get(current) ?? []) {
      indegree[entry.to] -= 1;
      if (indegree[entry.to] === 0) {
        queue.push(entry.to);
      }
    }
  }

  return {
    isDag: order.length === graph.vertices.length,
    order
  };
}

function finalizePath(
  builder: TraceBuilder,
  edgePath: string[],
  vertexPath: string[]
) {
  for (const edgeId of edgePath) {
    builder.setEdgeTone(edgeId, "path");
  }

  if (vertexPath.length > 0) {
    builder.setVertexTone(vertexPath[0], "source");
    builder.setVertexTone(vertexPath[vertexPath.length - 1], "target");
  }
}

const bfsDefinition: AlgorithmDefinition = {
  id: "bfs",
  name: "Breadth-First Search",
  category: "Traversal",
  description: "Explore the graph layer by layer using a queue.",
  time: "O(V + E)",
  space: "O(V)",
  requiresStart: true,
  requiresTarget: true,
  run(graph, options) {
    const startId = pickStartId(graph, options);
    if (!startId) {
      return invalidRun(this, "BFS unavailable", "Add at least one vertex before running BFS.", [
        "Breadth-first search needs a starting vertex."
      ]);
    }

    const adjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const queue: string[] = [startId];
    const visited = new Set<string>([startId]);
    const level: Record<string, number> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, Number.POSITIVE_INFINITY])
    );
    const parent: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const parentEdge: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const edgeKinds = new Map<string, "tree" | "cross">();
    let exploredEdges = 0;

    level[startId] = 0;
    builder.setVertexTone(startId, "source");
    refreshDistanceBadges(builder, graph, level, parent);
    builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
    builder.setMetrics([
      { label: "Visited", value: "1" },
      { label: "Queue", value: "1" },
      { label: "Tree edges", value: "0" }
    ]);
    builder.setNotes([
      note(
        "info",
        "BFS produces level numbers and the shortest-path tree for unweighted graphs."
      )
    ]);
    builder.push(
      `Seed queue with ${labelFor(graph, startId)}`,
      `Start from ${labelFor(graph, startId)} and expand one layer at a time.`
    );

    while (queue.length > 0) {
      const current = queue.shift() as string;
      builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
      builder.setVertexTone(current, current === startId ? "source" : "active");
      builder.setMetrics([
        { label: "Visited", value: `${visited.size}` },
        { label: "Queue", value: `${queue.length}` },
        { label: "Tree edges", value: `${[...edgeKinds.values()].filter((kind) => kind === "tree").length}` }
      ]);
      builder.push(
        `Dequeue ${labelFor(graph, current)}`,
        `Inspect all outgoing edges of ${labelFor(graph, current)}.`
      );

      for (const entry of adjacency.get(current) ?? []) {
        exploredEdges += 1;
        builder.setEdgeTone(entry.edge.id, "active");
        builder.push(
          `Inspect ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `Check whether ${labelFor(graph, entry.to)} has already been discovered.`
        );

        if (!visited.has(entry.to)) {
          visited.add(entry.to);
          parent[entry.to] = current;
          parentEdge[entry.to] = entry.edge.id;
          level[entry.to] = level[current] + 1;
          queue.push(entry.to);
          edgeKinds.set(entry.edge.id, "tree");
          builder.setVertexTone(entry.to, "frontier");
          builder.setEdgeTone(entry.edge.id, "tree");
          refreshDistanceBadges(builder, graph, level, parent);
          builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
          builder.setMetrics([
            { label: "Visited", value: `${visited.size}` },
            { label: "Queue", value: `${queue.length}` },
            { label: "Tree edges", value: `${[...edgeKinds.values()].filter((kind) => kind === "tree").length}` }
          ]);
          builder.push(
            `Discover ${labelFor(graph, entry.to)}`,
            `${labelFor(graph, entry.to)} enters the queue at level ${level[entry.to]}.`
          );
        } else if (!edgeKinds.has(entry.edge.id)) {
          edgeKinds.set(entry.edge.id, "cross");
          builder.setEdgeTone(entry.edge.id, "cross");
          builder.push(
            `Non-tree edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
            `${labelFor(graph, entry.to)} was already discovered earlier, so this edge is not part of the BFS tree.`
          );
        }
      }

      builder.setVertexTone(current, current === startId ? "source" : "visited");
    }

    const targetId = pickTargetId(graph, options);
    let vertexPath: string[] = [];
    let edgePath: string[] = [];
    if (targetId && Number.isFinite(level[targetId])) {
      const path = findPath(parent, parentEdge, startId, targetId);
      vertexPath = path.vertices;
      edgePath = path.edges;
      finalizePath(builder, edgePath, vertexPath);
      builder.push(
        `Highlight shortest unweighted path to ${labelFor(graph, targetId)}`,
        `The BFS tree encodes the minimum-hop route from ${labelFor(graph, startId)} to ${labelFor(graph, targetId)}.`
      );
    }

    const vertexRows = graph.vertices.map((vertex) => [
      vertex.label,
      formatDistance(level[vertex.id]),
      parent[vertex.id] ? labelFor(graph, parent[vertex.id] as string) : "-"
    ]);
    const edgeRows = graph.edges.map((edge) => [
      edgeLabel(graph, edge),
      edgeKinds.get(edge.id) ?? "unused"
    ]);
    const summaryNotes = [];
    if (targetId && vertexPath.length === 0) {
      summaryNotes.push(note("warning", `${labelFor(graph, targetId)} is unreachable from the chosen source.`));
    }

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      path: vertexPath,
      tables: [
        createVertexTable("Vertex levels", ["Vertex", "Level", "Parent"], vertexRows),
        createVertexTable("Edge roles", ["Edge", "Type"], edgeRows)
      ],
      summary: defaultSummary(
        this,
        "Breadth-first layers computed",
        [
          `${visited.size} of ${graph.vertices.length} vertices were reached.`,
          `${[...edgeKinds.values()].filter((kind) => kind === "tree").length} tree edges define the traversal forest.`,
          `${exploredEdges} adjacency entries were inspected.`
        ],
        summaryNotes,
        [
          { label: "Reached", value: `${visited.size}/${graph.vertices.length}` },
          {
            label: "Max level",
            value: `${Math.max(...Object.values(level).filter(Number.isFinite), 0)}`
          },
          { label: "Edges inspected", value: `${exploredEdges}` }
        ]
      )
    };
  }
};

const dfsDefinition: AlgorithmDefinition = {
  id: "dfs",
  name: "Depth-First Search",
  category: "Traversal",
  description: "Traverse deeply before backtracking, recording discovery and finish times.",
  time: "O(V + E)",
  space: "O(V)",
  run(graph) {
    if (graph.vertices.length === 0) {
      return invalidRun(this, "DFS unavailable", "Add at least one vertex before running DFS.", [
        "Depth-first search needs a graph to explore."
      ]);
    }

    const adjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const parent: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const pre: Record<string, number> = {};
    const post: Record<string, number> = {};
    const order: string[] = [];
    const callStack: string[] = [];
    const edgeKinds = new Map<string, EdgeTone>();
    let preCounter = 0;
    let postCounter = 0;

    const classifyEdge = (entry: AdjacencyEntry) => {
      if (!graph.settings.directed) {
        if (parent[entry.from] === entry.to || edgeKinds.get(entry.edge.id) === "tree") {
          return;
        }
        edgeKinds.set(entry.edge.id, "back");
        builder.setEdgeTone(entry.edge.id, "back");
        builder.push(
          `Back edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `In an undirected traversal, this closes a cycle back to an ancestor.`
        );
        return;
      }

      if (onStack.has(entry.to)) {
        edgeKinds.set(entry.edge.id, "back");
        builder.setEdgeTone(entry.edge.id, "back");
        builder.push(
          `Back edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `The edge points to a vertex that is still active on the recursion stack.`
        );
      } else if ((pre[entry.from] ?? 0) < (pre[entry.to] ?? 0)) {
        edgeKinds.set(entry.edge.id, "forward");
        builder.setEdgeTone(entry.edge.id, "forward");
        builder.push(
          `Forward edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `The edge jumps from an ancestor to a descendant outside the DFS tree.`
        );
      } else {
        edgeKinds.set(entry.edge.id, "cross");
        builder.setEdgeTone(entry.edge.id, "cross");
        builder.push(
          `Cross edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `The edge connects two finished branches of the DFS forest.`
        );
      }
    };

    const visit = (vertexId: string) => {
      visited.add(vertexId);
      onStack.add(vertexId);
      callStack.push(vertexId);
      preCounter += 1;
      pre[vertexId] = preCounter;

      builder.stack = callStack.map((id) => labelFor(graph, id));
      builder.setVertexTone(vertexId, "active");
      builder.setMetrics([
        { label: "Discovered", value: `${visited.size}` },
        { label: "Back edges", value: `${[...edgeKinds.values()].filter((kind) => kind === "back").length}` },
        { label: "Finished", value: `${Object.keys(post).length}` }
      ]);
      refreshTraversalBadges(builder, graph, pre, post, {});
      builder.push(
        `Discover ${labelFor(graph, vertexId)}`,
        `${labelFor(graph, vertexId)} receives preorder number ${pre[vertexId]}.`
      );

      for (const entry of adjacency.get(vertexId) ?? []) {
        builder.setEdgeTone(entry.edge.id, "active");
        builder.push(
          `Explore ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `Check whether ${labelFor(graph, entry.to)} starts a tree edge or becomes a classified non-tree edge.`
        );

        if (!visited.has(entry.to)) {
          parent[entry.to] = vertexId;
          edgeKinds.set(entry.edge.id, "tree");
          builder.setEdgeTone(entry.edge.id, "tree");
          builder.push(
            `Tree edge ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
            `${labelFor(graph, entry.to)} becomes a child of ${labelFor(graph, vertexId)} in the DFS forest.`
          );
          visit(entry.to);
          builder.setVertexTone(vertexId, "active");
        } else if (!edgeKinds.has(entry.edge.id) || graph.settings.directed) {
          classifyEdge(entry);
        }
      }

      onStack.delete(vertexId);
      callStack.pop();
      postCounter += 1;
      post[vertexId] = postCounter;
      order.push(vertexId);
      builder.order = [...order]
        .slice()
        .reverse()
        .map((id) => labelFor(graph, id));
      builder.stack = callStack.map((id) => labelFor(graph, id));
      builder.setVertexTone(vertexId, "visited");
      builder.setMetrics([
        { label: "Discovered", value: `${visited.size}` },
        { label: "Back edges", value: `${[...edgeKinds.values()].filter((kind) => kind === "back").length}` },
        { label: "Finished", value: `${Object.keys(post).length}` }
      ]);
      refreshTraversalBadges(builder, graph, pre, post, {});
      builder.push(
        `Finish ${labelFor(graph, vertexId)}`,
        `${labelFor(graph, vertexId)} receives postorder number ${post[vertexId]}.`
      );
    };

    for (const vertex of graph.vertices) {
      if (!visited.has(vertex.id)) {
        visit(vertex.id);
      }
    }

    const reversePostOrder = [...order].reverse();
    const reversePostRank: Record<string, number> = {};
    reversePostOrder.forEach((vertexId, index) => {
      reversePostRank[vertexId] = index + 1;
    });
    refreshTraversalBadges(builder, graph, pre, post, reversePostRank);
    builder.order = reversePostOrder.map((id) => labelFor(graph, id));
    builder.push(
      "Finalize reverse postorder",
      "Reverse postorder comes from sorting vertices by decreasing finish time."
    );

    const edgeRows = graph.edges.map((edge) => [edgeLabel(graph, edge), edgeKinds.get(edge.id) ?? "unused"]);
    const vertexRows = graph.vertices.map((vertex) => [
      vertex.label,
      `${pre[vertex.id] ?? "-"}`,
      `${post[vertex.id] ?? "-"}`,
      `${reversePostRank[vertex.id] ?? "-"}`
    ]);
    const details = [
      `${[...edgeKinds.values()].filter((kind) => kind === "tree").length} tree edges discovered.`,
      `${[...edgeKinds.values()].filter((kind) => kind === "back").length} back edges identified.`,
      `${[...edgeKinds.values()].filter((kind) => kind === "forward").length} forward edges identified.`,
      `${[...edgeKinds.values()].filter((kind) => kind === "cross").length} cross edges identified.`
    ];

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      tables: [
        createVertexTable("DFS numbering", ["Vertex", "Pre", "Post", "Reverse post"], vertexRows),
        createVertexTable("Edge classification", ["Edge", "Type"], edgeRows)
      ],
      summary: defaultSummary(
        this,
        "Depth-first structure extracted",
        details,
        [
          note(
            "info",
            "Reverse postorder is especially useful for topological reasoning and Kosaraju's second pass."
          )
        ],
        [
          { label: "Vertices", value: `${graph.vertices.length}` },
          { label: "Edges", value: `${graph.edges.length}` },
          { label: "Forest roots", value: `${graph.vertices.length - Object.values(parent).filter(Boolean).length}` }
        ]
      )
    };
  }
};

const dijkstraDefinition: AlgorithmDefinition = {
  id: "dijkstra",
  name: "Dijkstra",
  category: "Shortest Paths",
  description: "Greedy shortest paths with a min-priority queue and non-negative edge weights.",
  time: "O((V + E) log V)",
  space: "O(V)",
  requiresStart: true,
  requiresTarget: true,
  run(graph, options) {
    const startId = pickStartId(graph, options);
    if (!startId) {
      return invalidRun(this, "Dijkstra unavailable", "Add at least one vertex before running Dijkstra.", [
        "Dijkstra needs a source vertex."
      ]);
    }

    const hasNegativeEdge = graph.edges.some((edge) => weightFor(graph, edge) < 0);
    if (hasNegativeEdge) {
      return invalidRun(
        this,
        "Negative edge detected",
        "Dijkstra's algorithm assumes every edge weight is non-negative.",
        ["Switch to Bellman-Ford if you need shortest paths with negative edges."]
      );
    }

    const adjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const distances: Record<string, number> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, Number.POSITIVE_INFINITY])
    );
    const parent: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const parentEdge: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const settled = new Set<string>();
    const queue = new MinPriorityQueue<string>();
    let relaxations = 0;

    distances[startId] = 0;
    queue.push(startId, 0);
    builder.setVertexTone(startId, "source");
    refreshDistanceBadges(builder, graph, distances, parent);
    builder.queue = [labelFor(graph, startId)];
    builder.setMetrics([
      { label: "Settled", value: "0" },
      { label: "Frontier", value: "1" },
      { label: "Relaxations", value: "0" }
    ]);
    builder.push(
      `Initialize at ${labelFor(graph, startId)}`,
      `The source starts at distance 0 and enters the priority queue.`
    );

    while (queue.size > 0) {
      const next = queue.pop();
      if (!next) {
        break;
      }

      const current = next.value;
      if (settled.has(current)) {
        continue;
      }

      settled.add(current);
      builder.setVertexTone(current, current === startId ? "source" : "settled");
      builder.queue = [];
      builder.setMetrics([
        { label: "Settled", value: `${settled.size}` },
        { label: "Frontier", value: `${Math.max(queue.size, 0)}` },
        { label: "Relaxations", value: `${relaxations}` }
      ]);
      builder.push(
        `Extract ${labelFor(graph, current)}`,
        `${labelFor(graph, current)} is now settled with final distance ${formatDistance(distances[current])}.`
      );

      for (const entry of adjacency.get(current) ?? []) {
        if (settled.has(entry.to)) {
          continue;
        }

        builder.setEdgeTone(entry.edge.id, "active");
        builder.setVertexTone(entry.to, "frontier");
        builder.push(
          `Relax ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `Compare the current best distance to ${labelFor(graph, entry.to)} with a route through ${labelFor(graph, current)}.`
        );

        const candidateDistance = distances[current] + entry.weight;
        if (candidateDistance < distances[entry.to]) {
          const previousEdgeId = parentEdge[entry.to];
          if (previousEdgeId && previousEdgeId !== entry.edge.id) {
            builder.setEdgeTone(previousEdgeId, "muted");
          }

          distances[entry.to] = candidateDistance;
          parent[entry.to] = current;
          parentEdge[entry.to] = entry.edge.id;
          builder.setEdgeTone(entry.edge.id, "selected");
          refreshDistanceBadges(builder, graph, distances, parent);
          queue.push(entry.to, candidateDistance);
          relaxations += 1;
          builder.setMetrics([
            { label: "Settled", value: `${settled.size}` },
            { label: "Frontier", value: `${Math.max(queue.size, 0)}` },
            { label: "Relaxations", value: `${relaxations}` }
          ]);
          builder.push(
            `Improve ${labelFor(graph, entry.to)}`,
            `The new best distance is ${candidateDistance}, so the parent edge is updated.`
          );
        } else if ((builder.edges[entry.edge.id]?.tone ?? "idle") === "active") {
          builder.setEdgeTone(entry.edge.id, "muted");
        }
      }
    }

    const targetId = pickTargetId(graph, options);
    let pathVertices: string[] = [];
    let pathEdges: string[] = [];
    const summaryNotes: Note[] = [];
    if (targetId) {
      if (Number.isFinite(distances[targetId])) {
        const path = findPath(parent, parentEdge, startId, targetId);
        pathVertices = path.vertices;
        pathEdges = path.edges;
        finalizePath(builder, pathEdges, pathVertices);
        builder.push(
          `Highlight shortest path to ${labelFor(graph, targetId)}`,
          `The highlighted edges form the minimum-distance route from ${labelFor(graph, startId)} to ${labelFor(graph, targetId)}.`
        );
      } else {
        summaryNotes.push(note("warning", `${labelFor(graph, targetId)} is unreachable from ${labelFor(graph, startId)}.`));
      }
    }

    const rows = graph.vertices.map((vertex) => [
      vertex.label,
      formatDistance(distances[vertex.id]),
      parent[vertex.id] ? labelFor(graph, parent[vertex.id] as string) : "-"
    ]);

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      path: pathVertices,
      tables: [createVertexTable("Shortest-path distances", ["Vertex", "Distance", "Parent"], rows)],
      summary: defaultSummary(
        this,
        "Shortest paths settled",
        [
          `${settled.size} vertices received final distances.`,
          `${relaxations} successful relaxations updated the frontier.`,
          targetId && Number.isFinite(distances[targetId])
            ? `Distance to ${labelFor(graph, targetId)} is ${formatDistance(distances[targetId])}.`
            : "Select a target to highlight a specific route."
        ],
        summaryNotes,
        [
          { label: "Settled", value: `${settled.size}` },
          { label: "Relaxations", value: `${relaxations}` },
          { label: "Target distance", value: targetId ? formatDistance(distances[targetId]) : "-" }
        ]
      )
    };
  }
};

const bellmanFordDefinition: AlgorithmDefinition = {
  id: "bellman-ford",
  name: "Bellman-Ford",
  category: "Shortest Paths",
  description: "Iteratively relax every edge and detect reachable negative cycles.",
  time: "O(VE)",
  space: "O(V)",
  requiresStart: true,
  requiresTarget: true,
  run(graph, options) {
    const startId = pickStartId(graph, options);
    if (!startId) {
      return invalidRun(this, "Bellman-Ford unavailable", "Add at least one vertex before running Bellman-Ford.", [
        "Bellman-Ford needs a source vertex."
      ]);
    }

    const edges = buildRelaxationEdges(graph);
    const builder = new TraceBuilder(graph);
    const distances: Record<string, number> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, Number.POSITIVE_INFINITY])
    );
    const parent: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const parentEdge: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    let relaxations = 0;
    let finishedEarly = false;

    distances[startId] = 0;
    builder.setVertexTone(startId, "source");
    refreshDistanceBadges(builder, graph, distances, parent);
    builder.setMetrics([
      { label: "Pass", value: "0" },
      { label: "Relaxations", value: "0" },
      { label: "Edges", value: `${edges.length}` }
    ]);
    builder.push(
      `Initialize at ${labelFor(graph, startId)}`,
      `Bellman-Ford starts with the source at distance 0 and every other vertex at infinity.`
    );

    for (let pass = 1; pass < graph.vertices.length; pass += 1) {
      let updated = false;
      builder.setMetrics([
        { label: "Pass", value: `${pass}` },
        { label: "Relaxations", value: `${relaxations}` },
        { label: "Edges", value: `${edges.length}` }
      ]);
      builder.push(`Pass ${pass}`, `Scan every edge and relax any distance that can still improve.`);

      for (const entry of edges) {
        if (!Number.isFinite(distances[entry.from])) {
          continue;
        }

        builder.setEdgeTone(entry.edge.id, "active");
        builder.push(
          `Inspect ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `Try to improve ${labelFor(graph, entry.to)} through ${labelFor(graph, entry.from)}.`
        );

        const candidateDistance = distances[entry.from] + entry.weight;
        if (candidateDistance < distances[entry.to]) {
          const previousEdgeId = parentEdge[entry.to];
          if (previousEdgeId && previousEdgeId !== entry.edge.id) {
            builder.setEdgeTone(previousEdgeId, "muted");
          }

          distances[entry.to] = candidateDistance;
          parent[entry.to] = entry.from;
          parentEdge[entry.to] = entry.edge.id;
          builder.setEdgeTone(entry.edge.id, "selected");
          refreshDistanceBadges(builder, graph, distances, parent);
          relaxations += 1;
          updated = true;
          builder.setMetrics([
            { label: "Pass", value: `${pass}` },
            { label: "Relaxations", value: `${relaxations}` },
            { label: "Edges", value: `${edges.length}` }
          ]);
          builder.push(
            `Relax ${labelFor(graph, entry.to)}`,
            `${labelFor(graph, entry.to)} improves to ${candidateDistance}.`
          );
        } else if ((builder.edges[entry.edge.id]?.tone ?? "idle") === "active") {
          builder.setEdgeTone(entry.edge.id, "muted");
        }
      }

      if (!updated) {
        finishedEarly = true;
        builder.push(
          `Pass ${pass} stabilizes`,
          `No distance changed, so the remaining passes would not improve anything.`
        );
        break;
      }
    }

    const cycleEdges = edges.filter(
      (entry) =>
        Number.isFinite(distances[entry.from]) && distances[entry.from] + entry.weight < distances[entry.to]
    );
    const summaryNotes: Note[] = [];
    if (cycleEdges.length > 0) {
      for (const entry of cycleEdges) {
        builder.setEdgeTone(entry.edge.id, "back");
      }
      builder.push(
        "Negative cycle detected",
        "A further relaxation is still possible, which proves that a reachable negative cycle exists."
      );
      summaryNotes.push(
        note(
          "warning",
          "At least one reachable negative cycle exists, so shortest-path distances are not well-defined."
        )
      );
    }

    const targetId = pickTargetId(graph, options);
    let pathVertices: string[] = [];
    let pathEdges: string[] = [];
    if (!cycleEdges.length && targetId && Number.isFinite(distances[targetId])) {
      const path = findPath(parent, parentEdge, startId, targetId);
      pathVertices = path.vertices;
      pathEdges = path.edges;
      finalizePath(builder, pathEdges, pathVertices);
      builder.push(
        `Highlight path to ${labelFor(graph, targetId)}`,
        `The chosen route is valid because no reachable negative cycle was found.`
      );
    }

    const rows = graph.vertices.map((vertex) => [
      vertex.label,
      formatDistance(distances[vertex.id]),
      parent[vertex.id] ? labelFor(graph, parent[vertex.id] as string) : "-"
    ]);

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      path: pathVertices,
      tables: [createVertexTable("Bellman-Ford distances", ["Vertex", "Distance", "Parent"], rows)],
      summary: defaultSummary(
        this,
        cycleEdges.length > 0 ? "Negative cycle found" : "Bellman-Ford finished",
        [
          `${relaxations} successful relaxations occurred across the passes.`,
          finishedEarly ? "The scan stabilized early before V - 1 passes completed." : "Every scheduled pass was processed.",
          cycleEdges.length > 0
            ? `${cycleEdges.length} witness edges still relax on the final check.`
            : "No reachable negative cycle was detected."
        ],
        summaryNotes,
        [
          { label: "Relaxations", value: `${relaxations}` },
          { label: "Negative-cycle edges", value: `${cycleEdges.length}` },
          { label: "Target distance", value: targetId ? formatDistance(distances[targetId]) : "-" }
        ]
      )
    };
  }
};

const primDefinition: AlgorithmDefinition = {
  id: "prim",
  name: "Prim",
  category: "Minimum Spanning Trees",
  description: "Grow an MST by repeatedly choosing the lightest edge crossing the current cut.",
  time: "O(E log V)",
  space: "O(V)",
  requiresStart: true,
  run(graph, options) {
    if (graph.settings.directed) {
      return invalidRun(
        this,
        "Prim requires an undirected graph",
        "Prim's algorithm is defined for undirected graphs.",
        ["Switch the graph mode to undirected before running Prim."]
      );
    }

    const builder = new TraceBuilder(graph);
    const visited = new Set<string>();
    const chosenEdges: string[] = [];
    const priorityQueue = new MinPriorityQueue<AdjacencyEntry>();
    const adjacency = buildAdjacency(graph);
    const startId = pickStartId(graph, options) ?? graph.vertices[0]?.id;

    if (!startId) {
      return invalidRun(this, "Prim unavailable", "Add at least one vertex before running Prim.", [
        "A minimum spanning tree needs a non-empty graph."
      ]);
    }

    const pushBoundary = (vertexId: string) => {
      for (const entry of adjacency.get(vertexId) ?? []) {
        if (!visited.has(entry.to)) {
          priorityQueue.push(entry, entry.weight);
          if ((builder.edges[entry.edge.id]?.tone ?? "idle") === "idle") {
            builder.setEdgeTone(entry.edge.id, "candidate");
          }
        }
      }
    };

    const visitRoot = (vertexId: string, firstComponent: boolean) => {
      visited.add(vertexId);
      builder.setVertexTone(vertexId, firstComponent ? "source" : "component");
      pushBoundary(vertexId);
      builder.setMetrics([
        { label: "Visited", value: `${visited.size}` },
        { label: "MST edges", value: `${chosenEdges.length}` },
        { label: "Weight", value: `${sumWeights(graph, chosenEdges)}` }
      ]);
      builder.push(
        firstComponent
          ? `Seed Prim at ${labelFor(graph, vertexId)}`
          : `Start a new component at ${labelFor(graph, vertexId)}`,
        firstComponent
          ? "The starting vertex enters the growing tree, and its incident edges become boundary candidates."
          : "The graph is disconnected, so Prim continues by growing a new tree in the forest."
      );
    };

    visitRoot(startId, true);

    for (const vertex of graph.vertices) {
      const rootId = vertex.id;
      if (visited.has(rootId)) {
        continue;
      }

      while (priorityQueue.size > 0) {
        const item = priorityQueue.pop();
        if (!item) {
          break;
        }

        const entry = item.value;
        if (visited.has(entry.to)) {
          if ((builder.edges[entry.edge.id]?.tone ?? "idle") !== "selected") {
            builder.setEdgeTone(entry.edge.id, "rejected");
            builder.push(
              `Reject ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
              "Both endpoints are already inside the tree, so this edge would create a cycle."
            );
          }
          continue;
        }

        visited.add(entry.to);
        chosenEdges.push(entry.edge.id);
        builder.setEdgeTone(entry.edge.id, "selected");
        builder.setVertexTone(entry.to, "settled");
        pushBoundary(entry.to);
        builder.setMetrics([
          { label: "Visited", value: `${visited.size}` },
          { label: "MST edges", value: `${chosenEdges.length}` },
          { label: "Weight", value: `${sumWeights(graph, chosenEdges)}` }
        ]);
        builder.push(
          `Select ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `This is the cheapest edge crossing the cut, so it safely joins the tree.`
        );
      }

      if (!visited.has(rootId)) {
        visitRoot(rootId, false);
      }
    }

    const edgeRows = graph.edges.map((edge) => [
      edgeLabel(graph, edge),
      `${weightFor(graph, edge)}`,
      chosenEdges.includes(edge.id) ? "selected" : "not selected"
    ]);

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      tables: [createVertexTable("Prim decisions", ["Edge", "Weight", "Decision"], edgeRows)],
      summary: defaultSummary(
        this,
        chosenEdges.length === graph.vertices.length - 1 ? "Minimum spanning tree built" : "Minimum spanning forest built",
        [
          `${chosenEdges.length} edges were selected.`,
          `Total weight is ${sumWeights(graph, chosenEdges)}.`,
          visited.size === graph.vertices.length
            ? "The graph was connected, so the result is a single tree."
            : "The graph was disconnected, so Prim produced a forest."
        ],
        visited.size === graph.vertices.length
          ? []
          : [note("warning", "Disconnected graphs produce a minimum spanning forest instead of a single tree.")],
        [
          { label: "Visited", value: `${visited.size}` },
          { label: "Chosen edges", value: `${chosenEdges.length}` },
          { label: "Total weight", value: `${sumWeights(graph, chosenEdges)}` }
        ]
      )
    };
  }
};

const kruskalDefinition: AlgorithmDefinition = {
  id: "kruskal",
  name: "Kruskal",
  category: "Minimum Spanning Trees",
  description: "Sort edges globally and add the next lightest edge that does not close a cycle.",
  time: "O(E log E)",
  space: "O(V)",
  run(graph) {
    if (graph.settings.directed) {
      return invalidRun(
        this,
        "Kruskal requires an undirected graph",
        "Kruskal's algorithm is defined for undirected graphs.",
        ["Switch the graph mode to undirected before running Kruskal."]
      );
    }

    const builder = new TraceBuilder(graph);
    const disjointSet = new DisjointSet(graph.vertices.map((vertex) => vertex.id));
    const sortedEdges = [...graph.edges].sort((left, right) => weightFor(graph, left) - weightFor(graph, right));
    const chosenEdges: string[] = [];

    for (const edge of sortedEdges) {
      builder.setEdgeTone(edge.id, "candidate");
      builder.push(
        `Consider ${edgeLabel(graph, edge)}`,
        `Edges are processed in nondecreasing order by weight (${weightFor(graph, edge)}).`
      );

      if (disjointSet.union(edge.source, edge.target)) {
        chosenEdges.push(edge.id);
        builder.setEdgeTone(edge.id, "selected");
        builder.setVertexTone(edge.source, "settled");
        builder.setVertexTone(edge.target, "settled");
        builder.push(
          `Accept ${edgeLabel(graph, edge)}`,
          `The endpoints were in different sets, so this edge safely merges two components.`
        );
      } else {
        builder.setEdgeTone(edge.id, "rejected");
        builder.push(
          `Reject ${edgeLabel(graph, edge)}`,
          `Both endpoints already lie in the same component, so the edge would create a cycle.`
        );
      }
    }

    const rows = sortedEdges.map((edge) => [
      edgeLabel(graph, edge),
      `${weightFor(graph, edge)}`,
      chosenEdges.includes(edge.id) ? "accepted" : "rejected"
    ]);

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      tables: [createVertexTable("Kruskal decisions", ["Edge", "Weight", "Decision"], rows)],
      summary: defaultSummary(
        this,
        chosenEdges.length === graph.vertices.length - 1 ? "Minimum spanning tree built" : "Minimum spanning forest built",
        [
          `${chosenEdges.length} edges were accepted.`,
          `Total weight is ${sumWeights(graph, chosenEdges)}.`,
          chosenEdges.length === graph.vertices.length - 1
            ? "A full tree was obtained."
            : "The graph is disconnected, so the result is a forest."
        ],
        chosenEdges.length === graph.vertices.length - 1
          ? []
          : [note("warning", "Disconnected inputs cannot produce a single spanning tree.")],
        [
          { label: "Accepted", value: `${chosenEdges.length}` },
          { label: "Rejected", value: `${graph.edges.length - chosenEdges.length}` },
          { label: "Total weight", value: `${sumWeights(graph, chosenEdges)}` }
        ]
      )
    };
  }
};

const kosarajuDefinition: AlgorithmDefinition = {
  id: "kosaraju",
  name: "Kosaraju-Sharir SCC",
  category: "Connectivity",
  description: "Run DFS on the reversed graph, then sweep vertices in reverse postorder to expose SCCs.",
  time: "O(V + E)",
  space: "O(V)",
  run(graph) {
    if (graph.vertices.length === 0) {
      return invalidRun(this, "Kosaraju unavailable", "Add at least one vertex before running Kosaraju-Sharir.", [
        "Strongly connected components require a graph."
      ]);
    }

    const reverseAdjacency = buildAdjacency(graph, { reversed: true });
    const forwardAdjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const reverseVisited = new Set<string>();
    const finishOrder: string[] = [];

    const reverseVisit = (vertexId: string) => {
      reverseVisited.add(vertexId);
      builder.setVertexTone(vertexId, "active");
      builder.push(
        `Reverse DFS visits ${labelFor(graph, vertexId)}`,
        "The first pass runs on the reversed graph to compute finishing times."
      );

      for (const entry of reverseAdjacency.get(vertexId) ?? []) {
        builder.setEdgeTone(entry.edge.id, "active");
        if (!reverseVisited.has(entry.to)) {
          reverseVisit(entry.to);
        }
      }

      finishOrder.push(vertexId);
      builder.setVertexTone(vertexId, "visited");
      builder.order = [...finishOrder]
        .slice()
        .reverse()
        .map((id) => labelFor(graph, id));
      builder.push(
        `Reverse DFS finishes ${labelFor(graph, vertexId)}`,
        `${labelFor(graph, vertexId)} enters the reverse postorder list.`
      );
    };

    for (const vertex of graph.vertices) {
      if (!reverseVisited.has(vertex.id)) {
        reverseVisit(vertex.id);
      }
    }

    const sweepOrder = [...finishOrder].reverse();
    const assigned = new Set<string>();
    const components: string[][] = [];
    let componentIndex = 0;

    const assign = (vertexId: string, group: string[]) => {
      assigned.add(vertexId);
      group.push(vertexId);
      builder.setVertexComponent(vertexId, componentIndex);
      builder.push(
        `Assign ${labelFor(graph, vertexId)} to component ${componentIndex + 1}`,
        "During the second pass, reachable vertices in this sweep form one SCC."
      );

      for (const entry of forwardAdjacency.get(vertexId) ?? []) {
        if (!assigned.has(entry.to)) {
          assign(entry.to, group);
        }
      }
    };

    for (const vertexId of sweepOrder) {
      if (assigned.has(vertexId)) {
        continue;
      }

      componentIndex += 1;
      const group: string[] = [];
      assign(vertexId, group);
      components.push(group);
      builder.push(
        `Component ${componentIndex} sealed`,
        `This SCC contains ${group.map((id) => labelFor(graph, id)).join(", ")}.`
      );
    }

    const rows = components.map((group, index) => [
      `${index + 1}`,
      group.map((vertexId) => labelFor(graph, vertexId)).join(", "),
      `${group.length}`
    ]);
    const notes =
      graph.settings.directed
        ? []
        : [note("info", "In an undirected graph, strongly connected components coincide with connected components.")];

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      componentGroups: components,
      tables: [createVertexTable("Strongly connected components", ["#", "Vertices", "Size"], rows)],
      summary: defaultSummary(
        this,
        `${components.length} strongly connected component${components.length === 1 ? "" : "s"} found`,
        [
          `Reverse postorder from the first pass drives the second sweep.`,
          `Largest component size: ${Math.max(...components.map((group) => group.length))}.`,
          graph.settings.directed
            ? "Every vertex inside a component can reach every other vertex in that component."
            : "Because the graph is undirected, each component is both connected and strongly connected."
        ],
        notes,
        [
          { label: "Components", value: `${components.length}` },
          { label: "Largest SCC", value: `${Math.max(...components.map((group) => group.length))}` },
          { label: "Vertices", value: `${graph.vertices.length}` }
        ]
      )
    };
  }
};

const topologicalDefinition: AlgorithmDefinition = {
  id: "toposort",
  name: "Topological Sort",
  category: "Ordering",
  description: "Produce a linear order by repeatedly removing zero-indegree vertices.",
  time: "O(V + E)",
  space: "O(V)",
  run(graph) {
    if (!graph.settings.directed) {
      return invalidRun(
        this,
        "Topological sort requires a directed graph",
        "Topological order is only defined for directed acyclic graphs.",
        ["Switch the graph mode to directed and make sure the graph is acyclic."]
      );
    }

    const adjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const indegree: Record<string, number> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, 0])
    );
    for (const edge of graph.edges) {
      indegree[edge.target] += 1;
    }

    const queue = graph.vertices
      .filter((vertex) => indegree[vertex.id] === 0)
      .map((vertex) => vertex.id);
    const order: string[] = [];

    for (const vertexId of queue) {
      builder.setVertexTone(vertexId, "frontier");
    }

    builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
    builder.push(
      "Initialize zero-indegree frontier",
      "Vertices with indegree 0 are immediately safe to place in the order."
    );

    while (queue.length > 0) {
      const current = queue.shift() as string;
      order.push(current);
      builder.setVertexTone(current, "settled");
      builder.order = order.map((vertexId) => labelFor(graph, vertexId));
      builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
      builder.push(
        `Output ${labelFor(graph, current)}`,
        `${labelFor(graph, current)} is removed from the graph and appended to the order.`
      );

      for (const entry of adjacency.get(current) ?? []) {
        builder.setEdgeTone(entry.edge.id, "active");
        indegree[entry.to] -= 1;
        if (indegree[entry.to] === 0) {
          queue.push(entry.to);
          builder.setVertexTone(entry.to, "frontier");
        }
        builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
        builder.push(
          `Reduce indegree of ${labelFor(graph, entry.to)}`,
          `${labelFor(graph, entry.to)} now has indegree ${indegree[entry.to]}.`
        );
      }
    }

    if (order.length !== graph.vertices.length) {
      builder.push(
        "Cycle blocks the ordering",
        "At least one cycle remains, so no topological order exists."
      );
      return {
        algorithmId: this.id,
        name: this.name,
        description: this.description,
        steps: builder.steps,
        tables: [],
        summary: defaultSummary(
          this,
          "Cycle detected",
          ["No topological order exists because the graph is not acyclic."],
          [note("warning", "Break all directed cycles before requesting a topological order.")],
          [
            { label: "Produced", value: `${order.length}` },
            { label: "Vertices", value: `${graph.vertices.length}` }
          ]
        )
      };
    }

    const rows = order.map((vertexId, index) => [`${index + 1}`, labelFor(graph, vertexId)]);
    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      tables: [createVertexTable("Topological order", ["Rank", "Vertex"], rows)],
      summary: defaultSummary(
        this,
        "Topological order produced",
        [
          `The order contains all ${order.length} vertices.`,
          "Every directed edge points from an earlier vertex to a later vertex in the order."
        ],
        [],
        [
          { label: "Vertices ordered", value: `${order.length}` },
          { label: "Edges", value: `${graph.edges.length}` }
        ]
      )
    };
  }
};

const dagShortestPathDefinition: AlgorithmDefinition = {
  id: "dag-shortest-path",
  name: "Dasgupta DAG Shortest Paths",
  category: "Shortest Paths",
  description: "Relax edges in topological order to solve shortest paths in a DAG.",
  time: "O(V + E)",
  space: "O(V)",
  requiresStart: true,
  requiresTarget: true,
  run(graph, options) {
    if (!graph.settings.directed) {
      return invalidRun(
        this,
        "DAG shortest paths require a directed graph",
        "Dasgupta's DAG shortest-path routine expects a directed acyclic graph.",
        ["Switch to directed mode and remove every cycle before running this algorithm."]
      );
    }

    const topo = topologicalOrderData(graph);
    if (!topo.isDag) {
      return invalidRun(
        this,
        "Cycle detected",
        "The graph is not a DAG, so topological relaxation is not valid here.",
        ["Use Bellman-Ford or Dijkstra instead, depending on the edge weights."]
      );
    }

    const startId = pickStartId(graph, options);
    if (!startId) {
      return invalidRun(this, "DAG shortest paths unavailable", "Add at least one vertex before running the algorithm.", [
        "A source vertex is required."
      ]);
    }

    const adjacency = buildAdjacency(graph);
    const builder = new TraceBuilder(graph);
    const distances: Record<string, number> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, Number.POSITIVE_INFINITY])
    );
    const parent: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    const parentEdge: Record<string, string | null> = Object.fromEntries(
      graph.vertices.map((vertex) => [vertex.id, null])
    );
    let relaxations = 0;

    distances[startId] = 0;
    builder.setVertexTone(startId, "source");
    builder.order = topo.order.map((vertexId) => labelFor(graph, vertexId));
    refreshDistanceBadges(builder, graph, distances, parent);
    builder.push(
      "Use topological order",
      `Relax edges exactly once in the order ${builder.order.join(", ")}.`
    );

    for (const vertexId of topo.order) {
      builder.setVertexTone(vertexId, vertexId === startId ? "source" : "settled");
      builder.push(
        `Process ${labelFor(graph, vertexId)}`,
        Number.isFinite(distances[vertexId])
          ? `${labelFor(graph, vertexId)} has current distance ${distances[vertexId]}.`
          : `${labelFor(graph, vertexId)} is still unreachable, so its outgoing edges cannot help yet.`
      );

      if (!Number.isFinite(distances[vertexId])) {
        continue;
      }

      for (const entry of adjacency.get(vertexId) ?? []) {
        builder.setEdgeTone(entry.edge.id, "active");
        builder.push(
          `Relax ${edgeLabel(graph, entry.edge, entry.from, entry.to)}`,
          `Topological order guarantees that ${labelFor(graph, entry.to)} has not been finalized too early.`
        );

        const candidateDistance = distances[vertexId] + entry.weight;
        if (candidateDistance < distances[entry.to]) {
          const previousEdgeId = parentEdge[entry.to];
          if (previousEdgeId && previousEdgeId !== entry.edge.id) {
            builder.setEdgeTone(previousEdgeId, "muted");
          }

          distances[entry.to] = candidateDistance;
          parent[entry.to] = vertexId;
          parentEdge[entry.to] = entry.edge.id;
          builder.setEdgeTone(entry.edge.id, "selected");
          refreshDistanceBadges(builder, graph, distances, parent);
          relaxations += 1;
          builder.push(
            `Improve ${labelFor(graph, entry.to)}`,
            `${labelFor(graph, entry.to)} now has distance ${candidateDistance}.`
          );
        } else if ((builder.edges[entry.edge.id]?.tone ?? "idle") === "active") {
          builder.setEdgeTone(entry.edge.id, "muted");
        }
      }
    }

    const targetId = pickTargetId(graph, options);
    let pathVertices: string[] = [];
    let pathEdges: string[] = [];
    const notes: Note[] = [];
    if (targetId) {
      if (Number.isFinite(distances[targetId])) {
        const path = findPath(parent, parentEdge, startId, targetId);
        pathVertices = path.vertices;
        pathEdges = path.edges;
        finalizePath(builder, pathEdges, pathVertices);
        builder.push(
          `Highlight DAG path to ${labelFor(graph, targetId)}`,
          "The selected edges form the shortest path under the DAG assumption."
        );
      } else {
        notes.push(note("warning", `${labelFor(graph, targetId)} is unreachable from ${labelFor(graph, startId)}.`));
      }
    }

    const rows = graph.vertices.map((vertex) => [
      vertex.label,
      formatDistance(distances[vertex.id]),
      parent[vertex.id] ? labelFor(graph, parent[vertex.id] as string) : "-"
    ]);

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      path: pathVertices,
      tables: [
        createVertexTable("DAG shortest-path distances", ["Vertex", "Distance", "Parent"], rows),
        createVertexTable(
          "Topological order",
          ["Rank", "Vertex"],
          topo.order.map((vertexId, index) => [`${index + 1}`, labelFor(graph, vertexId)])
        )
      ],
      summary: defaultSummary(
        this,
        "Topological relaxation finished",
        [
          `${relaxations} relaxations succeeded.`,
          `The graph was processed in one pass over a topological order of length ${topo.order.length}.`,
          "Unlike Dijkstra, this method remains valid on negative edges as long as the graph stays acyclic."
        ],
        notes,
        [
          { label: "Relaxations", value: `${relaxations}` },
          { label: "Order length", value: `${topo.order.length}` },
          { label: "Target distance", value: targetId ? formatDistance(distances[targetId]) : "-" }
        ]
      )
    };
  }
};

const componentsDefinition: AlgorithmDefinition = {
  id: "components",
  name: "Connected Components",
  category: "Connectivity",
  description: "Color each weakly connected component to reveal the graph's structure.",
  time: "O(V + E)",
  space: "O(V)",
  run(graph) {
    if (graph.vertices.length === 0) {
      return invalidRun(this, "Components unavailable", "Add at least one vertex before running connected components.", [
        "Component analysis needs a graph."
      ]);
    }

    const adjacency = buildAdjacency(graph, { undirectedOverride: true });
    const builder = new TraceBuilder(graph);
    const visited = new Set<string>();
    const components: string[][] = [];
    let componentIndex = 0;

    for (const vertex of graph.vertices) {
      if (visited.has(vertex.id)) {
        continue;
      }

      componentIndex += 1;
      const queue = [vertex.id];
      const group: string[] = [];
      visited.add(vertex.id);
      builder.queue = [labelFor(graph, vertex.id)];
      builder.push(
        `Start component ${componentIndex}`,
        `${labelFor(graph, vertex.id)} seeds a new weakly connected component.`
      );

      while (queue.length > 0) {
        const current = queue.shift() as string;
        group.push(current);
        builder.setVertexComponent(current, componentIndex - 1);
        builder.queue = queue.map((vertexId) => labelFor(graph, vertexId));
        builder.push(
          `Place ${labelFor(graph, current)} in component ${componentIndex}`,
          "Every vertex reachable without respecting direction joins the same group."
        );

        for (const entry of adjacency.get(current) ?? []) {
          if (!visited.has(entry.to)) {
            visited.add(entry.to);
            queue.push(entry.to);
            builder.setEdgeTone(entry.edge.id, "selected");
          }
        }
      }

      components.push(group);
    }

    return {
      algorithmId: this.id,
      name: this.name,
      description: this.description,
      steps: builder.steps,
      componentGroups: components,
      tables: [
        createVertexTable(
          graph.settings.directed ? "Weakly connected components" : "Connected components",
          ["#", "Vertices", "Size"],
          components.map((group, index) => [
            `${index + 1}`,
            group.map((vertexId) => labelFor(graph, vertexId)).join(", "),
            `${group.length}`
          ])
        )
      ],
      summary: defaultSummary(
        this,
        `${components.length} component${components.length === 1 ? "" : "s"} found`,
        [
          graph.settings.directed
            ? "Direction was ignored to compute weak connectivity."
            : "Every edge was treated as undirected for component discovery.",
          `Largest component size: ${Math.max(...components.map((group) => group.length))}.`
        ],
        graph.settings.directed
          ? [note("info", "For directed SCCs, run Kosaraju-Sharir instead.")]
          : [],
        [
          { label: "Components", value: `${components.length}` },
          { label: "Largest", value: `${Math.max(...components.map((group) => group.length))}` },
          { label: "Vertices", value: `${graph.vertices.length}` }
        ]
      )
    };
  }
};

export const algorithmDefinitions: AlgorithmDefinition[] = [
  bfsDefinition,
  dfsDefinition,
  dijkstraDefinition,
  bellmanFordDefinition,
  primDefinition,
  kruskalDefinition,
  kosarajuDefinition,
  topologicalDefinition,
  dagShortestPathDefinition,
  componentsDefinition
];

export const algorithmMap = new Map<AlgorithmId, AlgorithmDefinition>(
  algorithmDefinitions.map((definition) => [definition.id, definition])
);
