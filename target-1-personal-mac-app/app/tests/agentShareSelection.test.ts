import { describe, expect, test } from "vitest";
import { collectAgentShareElements } from "../src/agentShareSelection";

describe("collectAgentShareElements", () => {
  test("includes bound text when only its container is selected", () => {
    const container = {
      id: "container-1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 240,
      height: 160,
    };
    const boundText = {
      id: "text-1",
      type: "text",
      containerId: "container-1",
      text: "编辑器\n一步步的引导素材填空",
      x: 130,
      y: 150,
      width: 180,
      height: 50,
    };
    const unrelatedText = {
      id: "text-2",
      type: "text",
      text: "not selected",
      x: 500,
      y: 500,
      width: 100,
      height: 30,
    };

    const elements = collectAgentShareElements(
      [container, boundText, unrelatedText],
      new Set(["container-1"]),
    );

    expect(elements.map((element) => (element as { id: string }).id)).toEqual([
      "container-1",
      "text-1",
    ]);
  });
});
