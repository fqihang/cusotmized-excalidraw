import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentShareMenu } from "../src/AgentShareHandoff";
import type { AgentShareSummary } from "../src/agentSharing";
import type { AgentTarget } from "../src/agentSharingPrompts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const recentShare: AgentShareSummary = {
  shareId: "sh_old",
  title: "old share",
  description: "old context",
  labels: [],
  scope: "selection",
  sceneId: "scene-1",
  sourceFile: "scenes/zt.excalidraw",
  createdAt: "2026-05-25T10:00:00.000Z",
  updatedAt: "2026-05-25T10:00:00.000Z",
  expiresAt: "2026-06-01T10:00:00.000Z",
  status: "active",
  visibility: "local",
  textPreview: [],
};

const renderMenu = (props: Partial<Parameters<typeof AgentShareMenu>[0]> = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const baseProps = {
    apiEnabled: false,
    activeSceneAvailable: true,
    isOpen: false,
    isSharing: false,
    currentSourceFile: "scenes/mini.excalidraw",
    recentShares: [recentShare],
    onPrimaryShare: vi.fn(),
    onToggleOpen: vi.fn(),
    onClose: vi.fn(),
    onShareSelection: vi.fn(),
    onShareScene: vi.fn(),
    onCopyPrompt: vi.fn<(share: AgentShareSummary, target: AgentTarget) => void>(),
    onOpenManager: vi.fn(),
    formatDateTime: vi.fn(() => "06/01 22:36"),
    statusLabel: vi.fn(() => "Active"),
    ...props,
  };

  act(() => {
    root.render(<AgentShareMenu {...baseProps} />);
  });

  return { host, root, props: baseProps };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AgentShareMenu", () => {
  test("uses the primary Share button to create the latest current-selection share", () => {
    const onPrimaryShare = vi.fn();
    const onToggleOpen = vi.fn();
    renderMenu({ onPrimaryShare, onToggleOpen });

    const shareButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Share current selection to Agent"]',
    );
    expect(shareButton).not.toBeNull();

    act(() => {
      shareButton?.click();
    });

    expect(onPrimaryShare).toHaveBeenCalledTimes(1);
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  test("keeps the history menu behind the chevron button", () => {
    const onPrimaryShare = vi.fn();
    const onToggleOpen = vi.fn();
    renderMenu({ onPrimaryShare, onToggleOpen });

    const menuButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Open share history and actions"]',
    );
    expect(menuButton).not.toBeNull();

    act(() => {
      menuButton?.click();
    });

    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    expect(onPrimaryShare).not.toHaveBeenCalled();
  });

  test("marks recent shares from another file as historical context", () => {
    renderMenu({ isOpen: true });

    expect(document.body.textContent).toContain("History shares");
    expect(document.body.textContent).toContain("not current file");
  });

  test("marks recent shares from the current file separately", () => {
    renderMenu({
      isOpen: true,
      currentSourceFile: recentShare.sourceFile,
    });

    expect(document.body.textContent).toContain("current file");
    expect(document.body.textContent).not.toContain("not current file");
  });
});
