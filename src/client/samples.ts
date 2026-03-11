import type { Graph, SampleDefinition } from "./types";

function graph(graph: Graph): Graph {
  return structuredClone(graph);
}

export const sampleDefinitions: SampleDefinition[] = [
  {
    id: "showcase",
    name: "Directed Showcase",
    blurb: "Weighted directed graph with cycles for traversal and shortest-path demos.",
    graph: graph({
      settings: { directed: true, weighted: true },
      vertices: [
        { id: "a", label: "A", x: 200, y: 160 },
        { id: "b", label: "B", x: 470, y: 110 },
        { id: "c", label: "C", x: 780, y: 150 },
        { id: "d", label: "D", x: 980, y: 310 },
        { id: "e", label: "E", x: 740, y: 520 },
        { id: "f", label: "F", x: 400, y: 560 },
        { id: "g", label: "G", x: 170, y: 390 }
      ],
      edges: [
        { id: "e1", source: "a", target: "b", weight: 2 },
        { id: "e2", source: "a", target: "g", weight: 6 },
        { id: "e3", source: "b", target: "c", weight: 3 },
        { id: "e4", source: "b", target: "f", weight: 5 },
        { id: "e5", source: "c", target: "d", weight: 4 },
        { id: "e6", source: "c", target: "e", weight: 7 },
        { id: "e7", source: "d", target: "b", weight: 1 },
        { id: "e8", source: "d", target: "e", weight: 2 },
        { id: "e9", source: "e", target: "f", weight: 2 },
        { id: "e10", source: "f", target: "g", weight: 1 },
        { id: "e11", source: "g", target: "a", weight: 4 },
        { id: "e12", source: "g", target: "c", weight: 8 }
      ]
    })
  },
  {
    id: "mst",
    name: "MST Playground",
    blurb: "Undirected weighted graph tuned for Prim and Kruskal.",
    graph: graph({
      settings: { directed: false, weighted: true },
      vertices: [
        { id: "a", label: "A", x: 210, y: 140 },
        { id: "b", label: "B", x: 520, y: 110 },
        { id: "c", label: "C", x: 880, y: 170 },
        { id: "d", label: "D", x: 1030, y: 430 },
        { id: "e", label: "E", x: 760, y: 610 },
        { id: "f", label: "F", x: 410, y: 610 },
        { id: "g", label: "G", x: 150, y: 430 }
      ],
      edges: [
        { id: "e1", source: "a", target: "b", weight: 7 },
        { id: "e2", source: "a", target: "g", weight: 9 },
        { id: "e3", source: "a", target: "f", weight: 14 },
        { id: "e4", source: "b", target: "c", weight: 10 },
        { id: "e5", source: "b", target: "f", weight: 15 },
        { id: "e6", source: "c", target: "d", weight: 11 },
        { id: "e7", source: "c", target: "f", weight: 2 },
        { id: "e8", source: "d", target: "e", weight: 6 },
        { id: "e9", source: "e", target: "f", weight: 9 },
        { id: "e10", source: "e", target: "g", weight: 4 },
        { id: "e11", source: "f", target: "g", weight: 3 }
      ]
    })
  },
  {
    id: "dag",
    name: "Dasgupta DAG",
    blurb: "Acyclic weighted digraph for topological order and DAG shortest paths.",
    graph: graph({
      settings: { directed: true, weighted: true },
      vertices: [
        { id: "s", label: "A", x: 170, y: 330 },
        { id: "u", label: "B", x: 380, y: 140 },
        { id: "v", label: "C", x: 380, y: 520 },
        { id: "w", label: "D", x: 640, y: 170 },
        { id: "x", label: "E", x: 640, y: 480 },
        { id: "y", label: "F", x: 920, y: 200 },
        { id: "z", label: "G", x: 970, y: 500 }
      ],
      edges: [
        { id: "e1", source: "s", target: "u", weight: 2 },
        { id: "e2", source: "s", target: "v", weight: 5 },
        { id: "e3", source: "u", target: "w", weight: 6 },
        { id: "e4", source: "u", target: "x", weight: 1 },
        { id: "e5", source: "v", target: "x", weight: 2 },
        { id: "e6", source: "w", target: "y", weight: 1 },
        { id: "e7", source: "x", target: "y", weight: 4 },
        { id: "e8", source: "x", target: "z", weight: 3 },
        { id: "e9", source: "v", target: "z", weight: 8 }
      ]
    })
  },
  {
    id: "scc",
    name: "SCC Factory",
    blurb: "Directed graph with multiple strongly connected components.",
    graph: graph({
      settings: { directed: true, weighted: false },
      vertices: [
        { id: "a", label: "A", x: 160, y: 210 },
        { id: "b", label: "B", x: 350, y: 110 },
        { id: "c", label: "C", x: 360, y: 310 },
        { id: "d", label: "D", x: 610, y: 180 },
        { id: "e", label: "E", x: 610, y: 470 },
        { id: "f", label: "F", x: 870, y: 150 },
        { id: "g", label: "G", x: 880, y: 470 }
      ],
      edges: [
        { id: "e1", source: "a", target: "b", weight: 1 },
        { id: "e2", source: "b", target: "c", weight: 1 },
        { id: "e3", source: "c", target: "a", weight: 1 },
        { id: "e4", source: "c", target: "d", weight: 1 },
        { id: "e5", source: "d", target: "e", weight: 1 },
        { id: "e6", source: "e", target: "d", weight: 1 },
        { id: "e7", source: "d", target: "f", weight: 1 },
        { id: "e8", source: "f", target: "g", weight: 1 },
        { id: "e9", source: "g", target: "f", weight: 1 },
        { id: "e10", source: "g", target: "e", weight: 1 }
      ]
    })
  }
];

export function getSampleGraph(sampleId: string): Graph {
  const sample = sampleDefinitions.find((entry) => entry.id === sampleId) ?? sampleDefinitions[0];
  return structuredClone(sample.graph);
}

export function getDefaultGraph(): Graph {
  return getSampleGraph("showcase");
}
