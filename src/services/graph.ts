import { invoke } from "@tauri-apps/api/core";

export interface LinkGraphNode {
  id: string;
  title: string;
  unresolved: boolean;
}

export interface LinkGraphEdge {
  source: string;
  target: string;
}

export interface LinkGraph {
  nodes: LinkGraphNode[];
  edges: LinkGraphEdge[];
}

export async function getLinkGraph(): Promise<LinkGraph> {
  return invoke("get_link_graph");
}
