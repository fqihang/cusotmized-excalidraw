# Agent Share Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Share flow tell users exactly how to continue in Codex or Claude Code, while letting them re-copy handoff prompts from persisted shares later.

**Architecture:** Add pure prompt-generation helpers, a focused React UI component for the Share menu and success handoff panel, and wire them into the existing `App.tsx` Agent Sharing state. Reuse the existing persisted share registry and local MCP/HTTP status; do not add a new storage layer.

**Tech Stack:** React 19, TypeScript, Vite, Tauri v2, existing Personal Excalidraw Agent Sharing commands.

---

## File Structure

- Create `target-1-personal-mac-app/app/src/agentSharingPrompts.ts`
  - Owns Codex/Claude handoff prompt generation.
  - Owns compact setup text used when MCP/skill is missing.
  - Depends only on `AgentShareSummary` types and strings, so it stays easy to validate.
- Create `target-1-personal-mac-app/app/src/AgentShareHandoff.tsx`
  - Owns Share menu UI and success handoff panel UI.
  - Receives data and callbacks from `App.tsx`; does not call Tauri commands directly.
- Modify `target-1-personal-mac-app/app/src/App.tsx`
  - Adds handoff panel state.
  - Replaces the current single `Share` button with `AgentShareMenu`.
  - Uses prompt helpers for auto-copy, recent-share copy, and Shares Manager copy.
- Modify `target-1-personal-mac-app/app/src/styles.css`
  - Adds menu and handoff panel styles.
  - Keeps visual density aligned with the current app chrome.
- Modify `target-1-personal-mac-app/AGENT_SHARING.md`
  - Documents the Share Handoff Flow and bootstrap prompt layering.

## Task 1: Add Handoff Prompt Generation

**Files:**
- Create: `target-1-personal-mac-app/app/src/agentSharingPrompts.ts`
- Modify: `target-1-personal-mac-app/app/src/App.tsx`

- [ ] **Step 1: Create the prompt helper module**

Create `target-1-personal-mac-app/app/src/agentSharingPrompts.ts` with this shape:

```ts
import type { AgentShareSummary } from "./agentSharing";

export type AgentTarget = "codex" | "claude";

export type HandoffPromptInput = {
  share: Pick<
    AgentShareSummary,
    "shareId" | "title" | "description" | "sourceFile" | "scope" | "expiresAt" | "status"
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
    input.share.description ? `- description: ${input.share.description}` : "- description: none",
    "",
    "Local access:",
    `- MCP URL: ${input.mcpUrl}`,
    `- Manifest URL: ${input.manifestUrl}`,
    `- API currently ${input.apiEnabled ? "appears enabled" : "may be off; ask me to turn on Agent Sharing if reads fail"}`,
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
```

- [ ] **Step 2: Run typecheck to validate the new module compiles**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes with no errors.

- [ ] **Step 3: Commit Task 1**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git add target-1-personal-mac-app/app/src/agentSharingPrompts.ts
git commit -m "feat: add agent share handoff prompts"
```

## Task 2: Add Share Menu And Handoff Panel Components

**Files:**
- Create: `target-1-personal-mac-app/app/src/AgentShareHandoff.tsx`
- Modify: `target-1-personal-mac-app/app/src/styles.css`

- [ ] **Step 1: Create a focused handoff UI component**

Create `target-1-personal-mac-app/app/src/AgentShareHandoff.tsx`:

```tsx
import {
  Archive,
  ChevronDown,
  Copy,
  Loader2,
  Share2,
  X,
} from "lucide-react";
import type { AgentShareSummary } from "./agentSharing";
import type { AgentTarget } from "./agentSharingPrompts";

export type HandoffPanelState = {
  share: AgentShareSummary;
  autoCopiedTarget: AgentTarget;
};

export type AgentShareMenuProps = {
  apiEnabled: boolean;
  activeSceneAvailable: boolean;
  isOpen: boolean;
  isSharing: boolean;
  recentShares: AgentShareSummary[];
  onToggleOpen: () => void;
  onClose: () => void;
  onShareSelection: () => void;
  onShareScene: () => void;
  onCopyPrompt: (share: AgentShareSummary, target: AgentTarget) => void;
  onOpenManager: () => void;
  formatDateTime: (value?: string) => string;
  statusLabel: (status: AgentShareSummary["status"]) => string;
};

export const isShareReadable = (share: AgentShareSummary) =>
  share.status === "active";

export const AgentShareMenu = ({
  apiEnabled,
  activeSceneAvailable,
  isOpen,
  isSharing,
  recentShares,
  onToggleOpen,
  onClose,
  onShareSelection,
  onShareScene,
  onCopyPrompt,
  onOpenManager,
  formatDateTime,
  statusLabel,
}: AgentShareMenuProps) => (
  <div className="agent-share-menu-shell">
    <button
      className="agent-share-button"
      type="button"
      title="Share to Agent"
      disabled={isSharing}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onClick={onToggleOpen}
    >
      {isSharing ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />}
      Share
      <ChevronDown size={14} />
    </button>
    {isOpen && (
      <div className="agent-share-menu" role="menu">
        <button
          role="menuitem"
          disabled={!activeSceneAvailable || isSharing}
          onClick={() => {
            onShareSelection();
            onClose();
          }}
        >
          <Share2 size={14} />
          Share current selection
        </button>
        <button
          role="menuitem"
          disabled={!activeSceneAvailable || isSharing}
          onClick={() => {
            onShareScene();
            onClose();
          }}
        >
          <Share2 size={14} />
          Share whole file
        </button>
        <div className="agent-share-menu__divider" />
        <div className="agent-share-menu__section">
          <span>Recent shares</span>
          {!apiEnabled && <em>API off</em>}
        </div>
        {recentShares.length === 0 ? (
          <div className="agent-share-menu__empty">No shares yet</div>
        ) : (
          recentShares.map((share) => (
            <article className="agent-share-menu__share" key={share.shareId}>
              <div>
                <strong>{share.title}</strong>
                <span>{share.sourceFile}</span>
                <small>
                  {statusLabel(share.status)} · {formatDateTime(share.expiresAt)}
                </small>
              </div>
              {isShareReadable(share) ? (
                <div className="agent-share-menu__actions">
                  <button onClick={() => onCopyPrompt(share, "codex")}>
                    <Copy size={13} />
                    Codex
                  </button>
                  <button onClick={() => onCopyPrompt(share, "claude")}>
                    <Copy size={13} />
                    Claude
                  </button>
                </div>
              ) : (
                <span className="agent-share-menu__disabled">
                  Create a fresh share to use this context
                </span>
              )}
            </article>
          ))
        )}
        <div className="agent-share-menu__divider" />
        <button
          role="menuitem"
          onClick={() => {
            onOpenManager();
            onClose();
          }}
        >
          <Archive size={14} />
          Open Shares Manager
        </button>
      </div>
    )}
  </div>
);

export type AgentShareHandoffPanelProps = {
  state: HandoffPanelState;
  onCopyPrompt: (share: AgentShareSummary, target: AgentTarget) => void;
  onOpenManager: () => void;
  onClose: () => void;
  formatDateTime: (value?: string) => string;
};

export const AgentShareHandoffPanel = ({
  state,
  onCopyPrompt,
  onOpenManager,
  onClose,
  formatDateTime,
}: AgentShareHandoffPanelProps) => (
  <section className="agent-handoff-panel" aria-label="Agent share handoff">
    <header>
      <div>
        <span>Agent share created</span>
        <strong>{state.share.title}</strong>
      </div>
      <button className="icon-button" title="Close" onClick={onClose}>
        <X size={16} />
      </button>
    </header>
    <dl>
      <div>
        <dt>shareId</dt>
        <dd>{state.share.shareId}</dd>
      </div>
      <div>
        <dt>source</dt>
        <dd>{state.share.sourceFile}</dd>
      </div>
      <div>
        <dt>expires</dt>
        <dd>{formatDateTime(state.share.expiresAt)}</dd>
      </div>
    </dl>
    <p>
      A Codex prompt was copied. It checks whether MCP/skill is configured,
      guides setup if missing, then reads this share.
    </p>
    <div className="agent-handoff-panel__actions">
      <button onClick={() => onCopyPrompt(state.share, "codex")}>
        <Copy size={14} />
        Copy Codex prompt
      </button>
      <button onClick={() => onCopyPrompt(state.share, "claude")}>
        <Copy size={14} />
        Copy Claude prompt
      </button>
      <button onClick={onOpenManager}>
        <Archive size={14} />
        Shares
      </button>
    </div>
  </section>
);
```

- [ ] **Step 2: Add component styles**

Append these selectors to `target-1-personal-mac-app/app/src/styles.css`:

```css
.agent-share-menu-shell {
  position: relative;
}

.agent-share-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 20;
  width: min(360px, calc(100vw - 32px));
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
}

.agent-share-menu button {
  width: 100%;
  justify-content: flex-start;
}

.agent-share-menu__divider {
  height: 1px;
  margin: 8px 0;
  background: rgba(148, 163, 184, 0.25);
}

.agent-share-menu__section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 8px 8px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.agent-share-menu__section em {
  color: #ef4444;
  font-style: normal;
  text-transform: none;
}

.agent-share-menu__empty {
  padding: 12px 8px;
  color: #94a3b8;
  font-size: 13px;
}

.agent-share-menu__share {
  display: grid;
  gap: 8px;
  padding: 10px 8px;
  border-radius: 8px;
}

.agent-share-menu__share:hover {
  background: #f8fafc;
}

.agent-share-menu__share strong,
.agent-share-menu__share span,
.agent-share-menu__share small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-share-menu__share strong {
  color: #1f2937;
  font-size: 14px;
}

.agent-share-menu__share span,
.agent-share-menu__share small,
.agent-share-menu__disabled {
  color: #64748b;
  font-size: 12px;
}

.agent-share-menu__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.agent-share-menu__actions button {
  justify-content: center;
  min-height: 34px;
}

.agent-handoff-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 30;
  width: min(420px, calc(100vw - 32px));
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 22px 55px rgba(15, 23, 42, 0.22);
}

.agent-handoff-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.agent-handoff-panel header span,
.agent-handoff-panel dt {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.agent-handoff-panel header strong {
  display: block;
  margin-top: 3px;
  color: #0f172a;
  font-size: 16px;
}

.agent-handoff-panel dl {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
}

.agent-handoff-panel dl div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
}

.agent-handoff-panel dd {
  margin: 0;
  overflow: hidden;
  color: #334155;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-handoff-panel p {
  margin: 0 0 14px;
  color: #475569;
  font-size: 13px;
  line-height: 1.45;
}

.agent-handoff-panel__actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
}

.agent-handoff-panel__actions button {
  min-height: 36px;
}
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes with no errors.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git add target-1-personal-mac-app/app/src/AgentShareHandoff.tsx target-1-personal-mac-app/app/src/styles.css
git commit -m "feat: add agent share handoff UI"
```

## Task 3: Wire Handoff Flow Into App

**Files:**
- Modify: `target-1-personal-mac-app/app/src/App.tsx`

- [ ] **Step 1: Add imports**

In `target-1-personal-mac-app/app/src/App.tsx`, add imports:

```ts
import {
  AgentShareHandoffPanel,
  AgentShareMenu,
  isShareReadable,
  type HandoffPanelState,
} from "./AgentShareHandoff";
import {
  buildAgentHandoffPrompt,
  type AgentTarget,
} from "./agentSharingPrompts";
```

- [ ] **Step 2: Add handoff state**

Near existing Agent Sharing state declarations in `App`, add:

```ts
const [isAgentShareMenuOpen, setIsAgentShareMenuOpen] = useState(false);
const [handoffPanel, setHandoffPanel] = useState<HandoffPanelState | null>(null);
```

- [ ] **Step 3: Add recent-share derivation**

After `filteredScenes` or near other memoized UI data, add:

```ts
const recentAgentShares = useMemo(
  () =>
    [...agentShares]
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
      .slice(0, 5),
  [agentShares],
);
```

- [ ] **Step 4: Add reusable handoff prompt callback**

Replace the existing `copySharePrompt` callback with:

```ts
const copyHandoffPrompt = useCallback(
  async (share: AgentShareSummary, target: AgentTarget) => {
    if (!isShareReadable(share)) {
      setError(
        `Share ${share.shareId} is ${share.status}. Create a fresh Agent Share to use this context.`,
      );
      return;
    }
    const baseUrl = agentShareStatus?.baseUrl ?? DEFAULT_AGENT_SHARE_BASE_URL;
    const mcpUrl = `${baseUrl}/mcp`;
    const manifestUrl = `${baseUrl}/v1/shares/${share.shareId}/manifest`;
    await copyAgentText(
      buildAgentHandoffPrompt(target, {
        share,
        baseUrl,
        mcpUrl,
        manifestUrl,
        apiEnabled: Boolean(agentShareStatus?.enabled),
      }),
      target === "codex" ? "Codex handoff prompt" : "Claude handoff prompt",
    );
  },
  [agentShareStatus?.baseUrl, agentShareStatus?.enabled, copyAgentText],
);
```

- [ ] **Step 5: Add whole-file share option support**

Change `shareActiveToAgent` signature to accept a scope preference:

```ts
const shareActiveToAgent = useCallback(
  async (preferredScope: "selection" | "scene" = "selection") => {
    // existing body
  },
  // existing dependencies
);
```

Update `buildAgentSharePayload` to accept and honor `preferredScope`:

```ts
const share = await buildAgentSharePayload({
  runtimeCurrentSelection: false,
  forceSceneScope: preferredScope === "scene",
});
```

Extend `buildAgentSharePayload` options type to include `forceSceneScope?: boolean`, and when choosing elements use all non-deleted elements if `forceSceneScope` is true.

- [ ] **Step 6: Auto-copy prompt and open handoff panel after share creation**

In `shareActiveToAgent`, replace the current `shareNote` clipboard block with:

```ts
const registeredShare = await registerAgentShare(share);
const nextStatus = await refreshAgentShareStatus();
await refreshAgentShares();
await copyHandoffPrompt(registeredShare, "codex");
setHandoffPanel({
  share: registeredShare,
  autoCopiedTarget: "codex",
});
setError(`已创建 Agent 分享：${registeredShare.title}，Codex handoff prompt 已复制。`);
```

Remove the old `shareNote` array that only copied manifest and MCP URLs.

- [ ] **Step 7: Replace the top-right Share button with the menu**

In `renderTopRightUI`, replace the current `<button className="agent-share-button" ...>Share</button>` with:

```tsx
<AgentShareMenu
  apiEnabled={Boolean(agentShareStatus?.enabled)}
  activeSceneAvailable={Boolean(activeScene)}
  isOpen={isAgentShareMenuOpen}
  isSharing={isSharingToAgent}
  recentShares={recentAgentShares}
  onToggleOpen={() => setIsAgentShareMenuOpen((open) => !open)}
  onClose={() => setIsAgentShareMenuOpen(false)}
  onShareSelection={() => void shareActiveToAgent("selection")}
  onShareScene={() => void shareActiveToAgent("scene")}
  onCopyPrompt={(share, target) => void copyHandoffPrompt(share, target)}
  onOpenManager={() => {
    setIsSharesManagerOpen(true);
    void refreshAgentShares();
  }}
  formatDateTime={formatDateTime}
  statusLabel={shareStatusLabel}
/>
```

- [ ] **Step 8: Close Share menu on outside click and Escape**

Add this effect near the existing menu-closing effects:

```ts
useEffect(() => {
  if (!isAgentShareMenuOpen) {
    return;
  }
  const closeOnPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".agent-share-menu-shell")) {
      return;
    }
    setIsAgentShareMenuOpen(false);
  };
  const closeOnKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsAgentShareMenuOpen(false);
    }
  };
  document.addEventListener("pointerdown", closeOnPointerDown, true);
  document.addEventListener("keydown", closeOnKeyDown);
  return () => {
    document.removeEventListener("pointerdown", closeOnPointerDown, true);
    document.removeEventListener("keydown", closeOnKeyDown);
  };
}, [isAgentShareMenuOpen]);
```

- [ ] **Step 9: Render the handoff panel**

Near existing modal/toast rendering, before `{error && <div className="toast">...`, add:

```tsx
{handoffPanel && (
  <AgentShareHandoffPanel
    state={handoffPanel}
    onCopyPrompt={(share, target) => void copyHandoffPrompt(share, target)}
    onOpenManager={() => {
      setIsSharesManagerOpen(true);
      void refreshAgentShares();
    }}
    onClose={() => setHandoffPanel(null)}
    formatDateTime={formatDateTime}
  />
)}
```

- [ ] **Step 10: Update Shares Manager prompt buttons**

In Shares Manager, replace `onClick={() => void copySharePrompt(share)}` with:

```tsx
onClick={() => void copyHandoffPrompt(share, "codex")}
disabled={!isShareReadable(share)}
```

Keep the visible label as `Prompt` or change it to `Codex` if space permits. Add a second Claude button only if layout remains readable; otherwise the Share menu and handoff panel provide Claude copy.

- [ ] **Step 11: Run typecheck**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes with no errors.

- [ ] **Step 12: Commit Task 3**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git add target-1-personal-mac-app/app/src/App.tsx
git commit -m "feat: wire agent share handoff flow"
```

## Task 4: Update Documentation

**Files:**
- Modify: `target-1-personal-mac-app/AGENT_SHARING.md`
- Modify: `target-1-personal-mac-app/README.md`

- [ ] **Step 1: Update Agent Sharing user path**

In `target-1-personal-mac-app/AGENT_SHARING.md`, update the User Path to include:

```md
5. The app opens a handoff panel and auto-copies a Codex handoff prompt.
6. The user pastes that prompt into Codex or Claude Code.
7. If the receiving agent has MCP configured, it reads the share through MCP.
8. If MCP is missing, the prompt guides setup first, then the user retries the same share.
9. The user can re-copy prompts later from the `Share` menu or Shares Manager.
```

- [ ] **Step 2: Add Share Handoff section**

Add this section to `target-1-personal-mac-app/AGENT_SHARING.md`:

```md
## Share Handoff

The `Share` button is also the recovery entry for previous handoffs. It contains:

- `Share current selection`
- `Share whole file`
- recent shares with copy actions for readable shares
- disabled status text for expired or revoked shares
- `Open Shares Manager`

After creating a share, the app opens a handoff panel and auto-copies the Codex prompt. The prompt includes the shareId, MCP URL, manifest URL, a first-run MCP setup snippet, HTTP fallback guidance, and read-order rules.
```

- [ ] **Step 3: Remove stale token wording from README if present**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
rg -n "bearer|token|manifest URL" target-1-personal-mac-app/README.md target-1-personal-mac-app/AGENT_SHARING.md
```

Expected: no README claim that share handoff copies a bearer token. If a token claim exists, replace it with no-token local MCP/API wording and handoff prompt wording.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git add target-1-personal-mac-app/AGENT_SHARING.md target-1-personal-mac-app/README.md
git commit -m "docs: document agent share handoff flow"
```

## Task 5: Verification And Packaging

**Files:**
- Verify only unless checks expose issues.

- [ ] **Step 1: Run frontend typecheck**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run build
```

Expected: Vite build succeeds. Existing chunk-size and dynamic-import warnings are acceptable.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app/src-tauri
cargo test
```

Expected: all Rust tests pass, including existing Agent Sharing tests.

- [ ] **Step 4: Run the app for manual UI verification**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run tauri:dev
```

Manual checks:

- Create a selection share.
- Confirm the handoff panel appears.
- Confirm a Codex handoff prompt is copied.
- Open `Share` menu and confirm the recent share appears.
- Copy Codex prompt from the recent share.
- Open Shares Manager and confirm the share is still available there.
- Revoke the share and confirm the menu no longer presents it as readable.
- Press Escape and click outside the Share menu to confirm it closes.

- [ ] **Step 5: Build installer**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run tauri:build
```

Expected bundle:

```text
/tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app/src-tauri/target/release/bundle/dmg/Personal Excalidraw Files_0.1.10_aarch64.dmg
```

- [ ] **Step 6: Commit any verification fixes**

If verification required fixes, commit them:

```bash
cd /tmp/cusotmized-excalidraw-push
git add target-1-personal-mac-app
git commit -m "fix: polish agent share handoff flow"
```

If no fixes were needed, skip this commit.

- [ ] **Step 7: Push main**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git push origin main
```

Expected: remote `main` updates successfully.

## Self-Review

- Spec coverage: Tasks cover Share menu, success handoff panel, prompt bootstrap, persistent re-copy via Share menu and Shares Manager, no-token local API compatibility, docs, and verification.
- Red-flag scan: The plan contains no incomplete markers and no unspecified implementation steps.
- Type consistency: The plan uses existing `AgentShareSummary`, `AgentShareStatus`, `copyAgentText`, `shareActiveToAgent`, `formatDateTime`, and `shareStatusLabel` names; new types are defined before use.
