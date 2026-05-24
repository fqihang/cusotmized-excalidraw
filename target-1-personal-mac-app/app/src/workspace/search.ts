import type { SceneMetadata, SortMode } from "../types";

export type SceneFilter = {
  query: string;
  folderPath: string;
  tag: string;
  favoritesOnly: boolean;
  sortMode: SortMode;
};

const includes = (haystack: string, needle: string) =>
  haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());

export const filterScenes = (scenes: SceneMetadata[], filter: SceneFilter) => {
  const query = filter.query.trim();
  const filtered = scenes.filter((scene) => {
    if (filter.folderPath && scene.folderPath !== filter.folderPath) {
      return false;
    }
    if (filter.tag && !scene.tags.includes(filter.tag)) {
      return false;
    }
    if (filter.favoritesOnly && !scene.favorite) {
      return false;
    }
    if (!query) {
      return true;
    }

    return (
      includes(scene.title, query) ||
      includes(scene.relativePath, query) ||
      includes(scene.text, query) ||
      scene.tags.some((tag) => includes(tag, query))
    );
  });

  return filtered.sort((a, b) => {
    if (filter.sortMode === "title") {
      return a.title.localeCompare(b.title);
    }
    if (filter.sortMode === "opened") {
      return (
        new Date(b.openedAt ?? 0).getTime() -
        new Date(a.openedAt ?? 0).getTime()
      );
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};

export const collectTags = (scenes: SceneMetadata[]) =>
  Array.from(new Set(scenes.flatMap((scene) => scene.tags))).sort((a, b) =>
    a.localeCompare(b),
  );
