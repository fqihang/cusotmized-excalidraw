import type { AgentShareSummary } from "./agentSharing";

export type AgentTarget = "codex" | "claude";

export type HandoffPromptInput = {
  share: Pick<
    AgentShareSummary,
    | "shareId"
    | "title"
    | "description"
    | "sourceFile"
    | "scope"
    | "expiresAt"
    | "status"
  >;
  baseUrl: string;
  mcpUrl: string;
  manifestUrl: string;
  apiEnabled: boolean;
};

const readOrder = [
  "Read brief.md first for low-cost intent and source metadata.",
  "Inspect render.png or render.svg for visual layout.",
  "Read selection.json only when exact text, bounds, element IDs, grouping, or structure is needed.",
  "Read scene.excalidraw only when full source data is necessary.",
];

export const buildCodexSetupSnippet = (mcpUrl: string) =>
  [
    "Minimal Codex MCP config:",
    "",
    "```toml",
    "[mcp_servers.personal_excalidraw]",
    `url = "${mcpUrl}"`,
    "enabled = true",
    "```",
    "",
    "Create or update a compact Codex skill named personal-excalidraw-agent-share with this behavior:",
    "- Use personal-excalidraw MCP whenever the user mentions an Excalidraw sketch, canvas, selected shapes, shareId, vibe UI mockup, UI sketch, or architecture sketch.",
    "- Prefer MCP resources/tools first; use the local HTTP manifest URL only as a fallback.",
    "- Treat shares as read-only and never assume unshared canvas content exists.",
  ].join("\n");

export const buildClaudeSetupSnippet = (mcpUrl: string) =>
  [
    "Minimal Claude Code .mcp.json config:",
    "",
    "```json",
    JSON.stringify(
      {
        mcpServers: {
          "personal-excalidraw": {
            type: "http",
            url: mcpUrl,
          },
        },
      },
      null,
      2,
    ),
    "```",
    "",
    "Use the same behavior rules: read brief first, inspect image second, read selection.json only when exact structure is needed, and treat the share as read-only.",
  ].join("\n");

export const buildAgentHandoffPrompt = (
  target: AgentTarget,
  input: HandoffPromptInput,
) => {
  const setup =
    target === "codex"
      ? buildCodexSetupSnippet(input.mcpUrl)
      : buildClaudeSetupSnippet(input.mcpUrl);
  const targetName = target === "codex" ? "Codex" : "Claude Code";
  return [
    `Continue from this Personal Excalidraw share in ${targetName}.`,
    "",
    "Share:",
    `- title: ${input.share.title}`,
    `- shareId: ${input.share.shareId}`,
    `- scope: ${input.share.scope}`,
    `- sourceFile: ${input.share.sourceFile}`,
    `- status: ${input.share.status}`,
    `- expiresAt: ${input.share.expiresAt}`,
    input.share.description
      ? `- description: ${input.share.description}`
      : "- description: none",
    "",
    "Local access:",
    `- MCP URL: ${input.mcpUrl}`,
    `- Manifest URL: ${input.manifestUrl}`,
    `- API currently ${
      input.apiEnabled
        ? "appears enabled"
        : "may be off; ask me to turn on Agent Sharing if reads fail"
    }`,
    "",
    "First try the personal-excalidraw MCP server.",
    "If MCP is available, call get_share_manifest with the shareId, then use get_share_brief and render_share as needed.",
    "",
    "If MCP is missing or not configured, help me configure it before continuing:",
    setup,
    "",
    "If MCP is not available but the Manifest URL is reachable, use the local HTTP API as a read-only fallback.",
    "",
    "Read order:",
    ...readOrder.map((item) => `- ${item}`),
    "",
    "Rules:",
    "- Treat this share as read-only.",
    "- Do not assume unshared canvas content exists.",
    "- If the API is off, unreachable, expired, or revoked, ask me to open Personal Excalidraw, turn on Agent Sharing, and create or re-enable a share.",
    "- For UI implementation, translate the sketch into layout, components, states, and interactions before coding.",
  ].join("\n");
};
