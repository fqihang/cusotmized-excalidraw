import { KEYS } from "@excalidraw/common";
import { getBoundTextMaxWidth } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

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
});
