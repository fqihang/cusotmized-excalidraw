import { invoke } from "@tauri-apps/api/core";

export type ShareScope = "selection" | "scene";
export type ShareStatusValue = "active" | "expired" | "revoked";
export type ShareVisibility = "local" | "lan" | "peer";

export type ShareBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShareSelectionSummary = {
  elementIds: string[];
  bounds: ShareBounds;
  text: string[];
};

export type AgentShareStatus = {
  enabled: boolean;
  port?: number;
  baseUrl?: string;
  shareCount: number;
  startedAtMs?: number;
  exposeCurrentSelection: boolean;
};

export type AgentShareSummary = {
  shareId: string;
  title: string;
  description: string;
  labels: string[];
  scope: ShareScope;
  sceneId: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: ShareStatusValue;
  visibility: ShareVisibility;
  textPreview: string[];
  lastReadAt?: string;
};

export type AgentSharePayload = {
  shareId: string;
  scope: ShareScope;
  title: string;
  description: string;
  labels: string[];
  sceneId: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  selection: ShareSelectionSummary;
  textPreview: string[];
  selectionJson: Record<string, unknown>;
  sceneExcalidraw: string;
  renderSvg: string;
  renderPng: number[];
  briefMd: string;
};

export type ShareMetadataPatch = {
  title?: string;
  description?: string;
  labels?: string[];
};

export const startAgentShareServer = (port?: number) =>
  invoke<AgentShareStatus>("start_agent_share_server", { port });

export const stopAgentShareServer = () =>
  invoke<AgentShareStatus>("stop_agent_share_server");

export const getAgentShareStatus = () =>
  invoke<AgentShareStatus>("agent_share_status");

export const registerAgentShare = (share: AgentSharePayload) =>
  invoke<AgentShareSummary>("register_agent_share", { share });

export const listAgentShares = () =>
  invoke<AgentShareSummary[]>("list_agent_shares");

export const readAgentShareRenderPng = (shareId: string) =>
  invoke<number[]>("read_agent_share_render_png", { shareId });

export const renameAgentShare = (shareId: string, patch: ShareMetadataPatch) =>
  invoke<AgentShareSummary>("rename_agent_share", { shareId, patch });

export const revokeAgentShare = (shareId: string) =>
  invoke<void>("revoke_agent_share", { shareId });

export const deleteAgentShare = (shareId: string) =>
  invoke<void>("delete_agent_share", { shareId });

export const cleanExpiredAgentShares = () =>
  invoke<number>("clean_expired_agent_shares");

export const revokeAllAgentShares = () =>
  invoke<void>("revoke_all_agent_shares");

export const setCurrentSelectionShare = (share: AgentSharePayload | null) =>
  invoke<void>("set_current_selection_share", { share });

export const getCurrentSelectionShare = () =>
  invoke<AgentShareSummary | null>("get_current_selection_share");

export const blobToBytes = async (blob: Blob) =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));
