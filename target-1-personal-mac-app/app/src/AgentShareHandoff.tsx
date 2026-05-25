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
