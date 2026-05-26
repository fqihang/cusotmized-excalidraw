# Save State Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top-right save state trustworthy and actionable, especially when `Unsaved` could otherwise remain visible after no user edits.

**Architecture:** Keep the change scoped to the existing React/Tauri app. Add lightweight save health bookkeeping in `App.tsx`, make the save status badge clickable, and add a reconciliation loop that corrects stale save states without changing the workspace storage model.

**Tech Stack:** React 19, TypeScript, Vite, existing Personal Excalidraw workspace APIs.

---

## File Structure

- Modify `target-1-personal-mac-app/app/src/App.tsx`
  - Track last local change, last successful save, and last save error.
  - Reconcile `dirty` state when raw scene data already equals the saved raw data.
  - Retry autosave scheduling if `dirty` is stale and no save is running.
  - Make the save state badge a button that triggers save.
  - Add a tooltip with save diagnostics.
- Modify `target-1-personal-mac-app/app/src/styles.css`
  - Preserve the current save badge look for a `button.save-state`.
  - Add hover/focus/disabled states for the clickable badge.

## Task 1: Add Save Health Tracking

**Files:**
- Modify: `target-1-personal-mac-app/app/src/App.tsx`

- [ ] **Step 1: Add display and reconciliation constants**

Add these constants near the existing save constants:

```ts
const SAVE_RECONCILE_INTERVAL_MS = 1200;
```

- [ ] **Step 2: Add save health refs**

Add these refs near the existing save refs:

```ts
const lastLocalChangeAtRef = useRef<number | null>(null);
const lastSuccessfulSaveAtRef = useRef<number | null>(null);
const lastSaveErrorAtRef = useRef<number | null>(null);
```

- [ ] **Step 3: Update `markPayloadAsSaved`**

Change `markPayloadAsSaved` so opening or creating a saved payload resets health state:

```ts
const markPayloadAsSaved = useCallback((payload: ScenePayload | null) => {
  const raw = payload ? serializeDraft(draftFromPayload(payload)) : null;
  lastSavedRawRef.current = raw;
  latestRawRef.current = raw;
  const now = Date.now();
  lastLocalChangeAtRef.current = null;
  lastSaveErrorAtRef.current = null;
  lastSuccessfulSaveAtRef.current = raw ? now : null;
}, []);
```

- [ ] **Step 4: Update successful save bookkeeping**

Inside `saveNow`, after `lastSavedRawRef.current = rawToSave;`, add:

```ts
lastSuccessfulSaveAtRef.current = Date.now();
lastSaveErrorAtRef.current = null;
```

- [ ] **Step 5: Update save error bookkeeping**

Inside the `catch` block in `saveNow`, before setting error text, add:

```ts
lastSaveErrorAtRef.current = Date.now();
```

- [ ] **Step 6: Update local change bookkeeping**

Inside `handleCanvasChange`, before `setSaveStatus("dirty")`, add:

```ts
lastLocalChangeAtRef.current = Date.now();
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes.

## Task 2: Add Save State Reconciliation

**Files:**
- Modify: `target-1-personal-mac-app/app/src/App.tsx`

- [ ] **Step 1: Add reconciliation effect**

Add this effect after `scheduleAutosave` is defined:

```ts
useEffect(() => {
  if (saveStatus !== "dirty") {
    return;
  }

  const intervalId = window.setInterval(() => {
    if (saveInFlightRef.current || saveInFlightPromiseRef.current) {
      return;
    }

    const latestRaw = latestRawRef.current;
    const savedRaw = lastSavedRawRef.current;
    if (latestRaw && savedRaw && latestRaw === savedRaw) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setSaveStatus("saved");
      return;
    }

    if (!autosaveTimerRef.current) {
      scheduleAutosave();
    }
  }, SAVE_RECONCILE_INTERVAL_MS);

  return () => {
    window.clearInterval(intervalId);
  };
}, [saveStatus, scheduleAutosave]);
```

- [ ] **Step 2: Make `saveNow` correct stale dirty state after waiting for an in-flight save**

After the initial in-flight save wait in `saveNow`, add:

```ts
if (
  latestRawRef.current &&
  lastSavedRawRef.current &&
  latestRawRef.current === lastSavedRawRef.current
) {
  if (autosaveTimerRef.current) {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }
  setSaveStatus((previous) =>
    previous === "dirty" || previous === "saving" || previous === "error"
      ? "saved"
      : previous,
  );
}
```

Keep the existing draft/workspace guard after this block.

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Expected: TypeScript passes.

## Task 3: Make The Save Badge Actionable

**Files:**
- Modify: `target-1-personal-mac-app/app/src/App.tsx`
- Modify: `target-1-personal-mac-app/app/src/styles.css`

- [ ] **Step 1: Add save diagnostics label**

Add this helper near `saveLabel`:

```ts
const saveStateTitle = (() => {
  if (saveStatus === "saving") {
    return "正在保存到当前工作区文件。";
  }
  if (saveStatus === "dirty") {
    return "有未保存更改。点击立即保存。";
  }
  if (saveStatus === "error") {
    return "上次保存失败。点击重试保存。";
  }
  if (lastSuccessfulSaveAtRef.current) {
    return `已保存。上次保存：${formatDateTime(
      new Date(lastSuccessfulSaveAtRef.current).toISOString(),
    )}`;
  }
  return "当前文件已就绪。";
})();
```

- [ ] **Step 2: Replace the save status span with a button**

Replace:

```tsx
<span className={`save-state save-state--${saveStatus}`}>
  {saveStatus === "saving" && (
    <Loader2 size={14} className="spin" />
  )}
  {saveLabel}
</span>
```

with:

```tsx
<button
  className={`save-state save-state--${saveStatus}`}
  type="button"
  title={saveStateTitle}
  disabled={saveStatus === "saving" || !activeScene}
  onClick={() => void saveNowRef.current()}
>
  {saveStatus === "saving" && (
    <Loader2 size={14} className="spin" />
  )}
  {saveLabel}
</button>
```

- [ ] **Step 3: Update save badge CSS**

In `styles.css`, ensure `.save-state` can style a button:

```css
.save-state {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
  color: var(--muted);
  display: inline-flex;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  gap: 0.4rem;
  justify-content: center;
  min-height: 42px;
  min-width: 128px;
  padding: 0 1.2rem;
}

button.save-state {
  cursor: pointer;
}

button.save-state:hover:not(:disabled),
button.save-state:focus-visible {
  border-color: rgba(90, 84, 255, 0.35);
  color: var(--text);
}

button.save-state:disabled {
  cursor: default;
}
```

Preserve the existing status-specific color rules such as `.save-state--dirty`.

- [ ] **Step 4: Run typecheck and build**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
npm run build
```

Expected: both commands pass. Vite may still print existing chunk-size and dynamic-import warnings.

## Task 4: Document And Commit

**Files:**
- Modify: `target-1-personal-mac-app/README.md`

- [ ] **Step 1: Document save badge behavior**

In the Personal Mac App README, under the local management or stability description, add one short bullet:

```md
- 保存状态可点击：如果状态停在 Unsaved 或 Error，用户可以直接点状态胶囊触发保存重试。
```

- [ ] **Step 2: Run final verification**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push/target-1-personal-mac-app/app
npm run typecheck
```

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git status --short
```

Expected: TypeScript passes, and git only shows the planned files.

- [ ] **Step 3: Commit**

Run:

```bash
cd /tmp/cusotmized-excalidraw-push
git add docs/superpowers/plans/2026-05-26-save-state-stability-implementation.md \
  target-1-personal-mac-app/app/src/App.tsx \
  target-1-personal-mac-app/app/src/styles.css \
  target-1-personal-mac-app/README.md
git commit -m "feat: improve save state recovery"
```

## Plan Self-Review

Spec coverage: This plan implements the first thin slice of the product roadmap's Phase 1 stability foundation: trustworthy save state and user recovery from stale Unsaved/Error status.

Placeholder scan: No placeholders are intentionally left in this plan.

Type consistency: The plan uses existing `SaveStatus`, `saveNowRef`, `autosaveTimerRef`, `latestRawRef`, and `lastSavedRawRef` names from `App.tsx`.

Scope check: This is intentionally not the full 8-12 week roadmap. It is a small, testable code landing that improves daily trust in the app.

