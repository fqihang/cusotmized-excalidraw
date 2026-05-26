import { KEYS, getFontString } from "@excalidraw/common";
import { getBoundTextMaxWidth, getTextWidth } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import { getTextEditor } from "./queries/dom";

unmountComponent();

const h = window.h;

describe("text wysiwyg", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("uses the container text width when editing narrow bound text", async () => {
    const textId = "bound-text";
    const container = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 320,
      height: 120,
      boundElements: [{ id: textId, type: "text" }],
    });
    const text = API.createElement({
      id: textId,
      type: "text",
      text: "图形编辑测试",
      x: 0,
      y: 0,
      width: 20,
      height: 25,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: container.id,
    });

    API.setElements([container, text]);
    API.setSelectedElements([container]);

    Keyboard.keyPress(KEYS.ENTER);

    const editor = await getTextEditor();
    const editorWidth = parseFloat(editor.style.width);
    const maxBoundTextWidth = getBoundTextMaxWidth(container, text);

    expect(h.state.editingTextElement?.id).toBe(text.id);
    expect(editorWidth).toBeCloseTo(maxBoundTextWidth + 0.5, 5);
    expect(editorWidth).toBeGreaterThan(text.width);
  });

  it("uses the text width when editing narrow arrow labels", async () => {
    const textId = "arrow-label";
    const arrow = API.createElement({
      type: "arrow",
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      boundElements: [{ id: textId, type: "text" }],
    });
    const text = API.createElement({
      id: textId,
      type: "text",
      text: "产出流程",
      x: 0,
      y: 0,
      width: 20,
      height: 25,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
    });

    API.setElements([arrow, text]);
    API.setSelectedElements([arrow]);

    Keyboard.keyPress(KEYS.ENTER);

    const editor = await getTextEditor();
    const editorWidth = parseFloat(editor.style.width);
    const visibleTextWidth = getTextWidth(
      text.originalText,
      getFontString(text),
    );

    expect(h.state.editingTextElement?.id).toBe(text.id);
    expect(editorWidth).toBeGreaterThanOrEqual(visibleTextWidth);
    expect(editorWidth).toBeGreaterThan(text.width);

    editor.scrollLeft = 20;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(editor.scrollLeft).toBe(0);
  });

  it("uses the arrow label max width when editing near-vertical arrow labels", async () => {
    const textId = "vertical-arrow-label";
    const arrow = API.createElement({
      type: "arrow",
      x: 100,
      y: 100,
      width: 0,
      height: 180,
      boundElements: [{ id: textId, type: "text" }],
    });
    const text = API.createElement({
      id: textId,
      type: "text",
      text: "的",
      x: 0,
      y: 0,
      width: 20,
      height: 25,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
    });

    API.setElements([arrow, text]);
    API.setSelectedElements([arrow]);

    Keyboard.keyPress(KEYS.ENTER);

    const editor = await getTextEditor();
    const editorWidth = parseFloat(editor.style.width);
    const maxBoundTextWidth = getBoundTextMaxWidth(arrow, text);

    expect(h.state.editingTextElement?.id).toBe(text.id);
    expect(editorWidth).toBeGreaterThanOrEqual(maxBoundTextWidth);
  });

  it("keeps arrow label editor wide while typing", async () => {
    const textId = "arrow-label-live";
    const arrow = API.createElement({
      type: "arrow",
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      boundElements: [{ id: textId, type: "text" }],
    });
    const text = API.createElement({
      id: textId,
      type: "text",
      text: "A",
      x: 0,
      y: 0,
      width: 20,
      height: 25,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
    });

    API.setElements([arrow, text]);
    API.setSelectedElements([arrow]);

    Keyboard.keyPress(KEYS.ENTER);

    const editor = await getTextEditor();
    const initialEditorWidth = parseFloat(editor.style.width);
    const nextText = "Long arrow label that should stay visible while editing";

    act(() => {
      editor.value = nextText;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const editorWidth = parseFloat(editor.style.width);

    expect(h.state.editingTextElement?.id).toBe(text.id);
    expect(editorWidth).toBeGreaterThan(initialEditorWidth);
    expect(editorWidth).toBeGreaterThan(text.width);
  });


  it("keeps arrow label editor readable during composition", async () => {
    const textId = "arrow-label-composition";
    const arrow = API.createElement({
      type: "arrow",
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      boundElements: [{ id: textId, type: "text" }],
    });
    const text = API.createElement({
      id: textId,
      type: "text",
      text: "A",
      x: 0,
      y: 0,
      width: 20,
      height: 25,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
    });

    API.setElements([arrow, text]);
    API.setSelectedElements([arrow]);

    Keyboard.keyPress(KEYS.ENTER);

    const editor = await getTextEditor();
    const initialEditorWidth = parseFloat(editor.style.width);

    editor.value = "composing arrow label text";
    editor.scrollLeft = 20;
    act(() => {
      editor.dispatchEvent(new Event("compositionupdate", { bubbles: true }));
    });

    expect(parseFloat(editor.style.width)).toBeGreaterThan(initialEditorWidth);
    expect(editor.scrollLeft).toBe(0);
  });
});
