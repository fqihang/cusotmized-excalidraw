const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const elementId = (element: unknown) => {
  if (!isRecord(element)) {
    return null;
  }
  return typeof element.id === "string" ? element.id : null;
};

const isTextBoundToSelectedContainer = (
  element: unknown,
  selectedIds: ReadonlySet<string>,
) => {
  if (!isRecord(element) || element.type !== "text") {
    return false;
  }
  return (
    typeof element.containerId === "string" &&
    selectedIds.has(element.containerId)
  );
};

const boundTextIdsFromSelectedElements = (
  elements: readonly unknown[],
  selectedIds: ReadonlySet<string>,
) => {
  const ids = new Set<string>();
  for (const element of elements) {
    const id = elementId(element);
    if (!id || !selectedIds.has(id) || !isRecord(element)) {
      continue;
    }
    const boundElements = element.boundElements;
    if (!Array.isArray(boundElements)) {
      continue;
    }
    for (const binding of boundElements) {
      if (
        isRecord(binding) &&
        binding.type === "text" &&
        typeof binding.id === "string"
      ) {
        ids.add(binding.id);
      }
    }
  }
  return ids;
};

export const collectAgentShareElements = (
  elements: readonly unknown[],
  selectedIds: ReadonlySet<string>,
) => {
  const boundTextIds = boundTextIdsFromSelectedElements(elements, selectedIds);
  return elements.filter((element) => {
    const id = elementId(element);
    return Boolean(
      id &&
        (selectedIds.has(id) ||
          boundTextIds.has(id) ||
          isTextBoundToSelectedContainer(element, selectedIds)),
    );
  });
};
