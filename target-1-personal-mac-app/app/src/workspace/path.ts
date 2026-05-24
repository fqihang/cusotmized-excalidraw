const ILLEGAL_FILENAME_CHARS = /[<>:"\\|?*\u0000-\u001f]/g;

export const normalizePath = (path: string) =>
  path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

export const splitPath = (path: string) => normalizePath(path).split("/");

export const dirname = (path: string) => {
  const parts = splitPath(path);
  parts.pop();
  return parts.join("/");
};

export const basename = (path: string) => {
  const parts = splitPath(path);
  return parts.at(-1) ?? "";
};

export const stem = (filename: string) =>
  filename.replace(/\.excalidraw$/i, "");

export const safeSegment = (value: string) => {
  const safe = value
    .trim()
    .replace(ILLEGAL_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .slice(0, 80);

  return safe || "Untitled";
};

export const ensureExcalidrawFilename = (value: string) => {
  const segment = safeSegment(value);
  return /\.excalidraw$/i.test(segment) ? segment : `${segment}.excalidraw`;
};

export const joinPath = (...parts: Array<string | undefined | null>) =>
  normalizePath(parts.filter(Boolean).join("/"));

export const uniqueFilename = (
  wanted: string,
  usedRelativePaths: Set<string>,
  folderPath: string,
) => {
  const normalizedFolder = normalizePath(folderPath);
  const ext = ".excalidraw";
  const base = stem(ensureExcalidrawFilename(wanted));
  let candidate = ensureExcalidrawFilename(base);
  let i = 2;
  while (usedRelativePaths.has(joinPath(normalizedFolder, candidate))) {
    candidate = ensureExcalidrawFilename(`${base} ${i}`);
    i += 1;
  }
  return candidate.endsWith(ext) ? candidate : `${candidate}${ext}`;
};
