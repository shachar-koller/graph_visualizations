# Graph Visualizer

Interactive graph algorithm visualizer built as a Bun project with no frontend framework dependencies.

## Features

- Visual graph editor with add / connect / drag / delete interactions
- Directed and undirected modes
- Weighted and unweighted modes
- Step-by-step playback with scrubbing, play / pause, and speed control
- Traversal artifacts:
  - DFS tree / back / forward / cross edges
  - preorder, postorder, and reverse postorder numbers
  - BFS layers and traversal tree
- Algorithms:
  - BFS
  - DFS
  - Dijkstra
  - Bellman-Ford
  - Prim
  - Kruskal
  - Kosaraju-Sharir SCC
  - Topological sort
  - Dasgupta DAG shortest paths
  - Connected components
- Built-in sample graphs for MSTs, SCCs, DAGs, and general weighted digraphs
- Random graph generator
- JSON import / export
- Undo / redo
- Adjacency list and adjacency matrix panels

## Scripts

```bash
bun run dev
bun run build
bun run start
```

The server uses `PORT` if you want a non-default port:

```bash
PORT=3100 bun run start
```

## Notes

- The app is fully static on the frontend and bundled with `Bun.build`.
- In unweighted mode, algorithms treat every edge cost as `1`, even if stored edge weights still exist.
- Prim and Kruskal require undirected graphs.
- Topological sort and the Dasgupta DAG shortest-path routine require a directed acyclic graph.
