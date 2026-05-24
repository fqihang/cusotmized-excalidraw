import { invoke } from "@tauri-apps/api/core";

export type AgentShareStatus = {
  enabled: boolean;
  port?: number;
  baseUrl?: string;
  token?: string;
  shareCount: number;
  startedAtMs?: number;
};

export type AgentSharePayload = {
  shareId: string;
  scope: "selection" | "scene";
  title: string;
  sceneId: string;
  sourceFile: string;
  createdAt: string;
  expiresAt: string;
  expiresAtMs: number;
  manifest: Record<string, unknown>;
  selectionJson: Record<string, unknown>;
  sceneExcalidraw: string;
  renderSvg: string;
  renderPng: number[];
  briefMd: string;
};

export const startAgentShareServer = (port?: number) =>
  invoke<AgentShareStatus>("start_agent_share_server", { port });

export const stopAgentShareServer = () =>
  invoke<AgentShareStatus>("stop_agent_share_server");

export const getAgentShareStatus = () =>
  invoke<AgentShareStatus>("agent_share_status");

export const registerAgentShare = (share: AgentSharePayload) =>
  invoke<AgentShareStatus>("register_agent_share", { share });

export const blobToBytes = async (blob: Blob) =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));
