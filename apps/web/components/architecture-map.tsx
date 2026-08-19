"use client";

import { Background, Controls, type Edge, MiniMap, type Node, ReactFlow } from "@xyflow/react";
import type { GraphResponse } from "@/lib/api";

function layoutNodes(graph: GraphResponse): Node[] {
  const columns = graph.level === "symbol" ? 5 : 4;
  const horizontal = graph.level === "symbol" ? 240 : 280;
  const vertical = graph.level === "symbol" ? 130 : 155;
  return graph.nodes.map((node, index) => ({
    id: node.id,
    position: {
      x: (index % columns) * horizontal + (Math.floor(index / columns) % 2) * 45,
      y: Math.floor(index / columns) * vertical,
    },
    data: {
      label: (
        <div className="map-node-label">
          <span>{node.kind}</span>
          <strong>{node.label}</strong>
          {node.path ? <small>{node.path}</small> : null}
        </div>
      ),
      source: node,
    },
    className: `map-node map-node-${node.kind}`,
    style: { opacity: 0.65 + node.importance * 0.35 },
  }));
}

function layoutEdges(graph: GraphResponse): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    className: `map-edge map-edge-${edge.type}`,
    animated: edge.type === "calls",
  }));
}

export function ArchitectureMap({
  graph,
  onOpenSource,
  compact = false,
}: {
  graph: GraphResponse;
  onOpenSource?: (path: string, startLine?: number, endLine?: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "architecture-map compact" : "architecture-map"}>
      {graph.nodes.length === 0 ? (
        <div className="empty-state">
          <strong>No nodes match this view.</strong>
          <span>Try another graph level or clear the search.</span>
        </div>
      ) : (
        <ReactFlow
          edges={layoutEdges(graph)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          nodes={layoutNodes(graph)}
          nodesConnectable={false}
          nodesDraggable
          onNodeClick={(_event, node) => {
            const source = node.data.source as GraphResponse["nodes"][number];
            if (source.path && onOpenSource) {
              onOpenSource(source.path, source.range?.startLine, source.range?.endLine);
            }
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(156, 181, 170, 0.12)" gap={28} size={1} />
          <Controls showInteractive={false} />
          {!compact ? <MiniMap pannable zoomable /> : null}
        </ReactFlow>
      )}
    </div>
  );
}
