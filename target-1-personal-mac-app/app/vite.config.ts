import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

const excalidrawRoot = path.resolve(__dirname, "../../excalidraw");
const excalidrawPackage = (relativePath: string) =>
  path.resolve(excalidrawRoot, relativePath);
const dependencyAlias = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    {
      find: new RegExp(`^${escaped}$`),
      replacement: path.resolve(__dirname, `node_modules/${name}`),
    },
    {
      find: new RegExp(`^${escaped}/(.+)$`),
      replacement: path.resolve(__dirname, `node_modules/${name}/$1`),
    },
  ];
};

const sourceDependencyAliases = [
  "@braintree/sanitize-url",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/state",
  "@codemirror/view",
  "@excalidraw/laser-pointer",
  "@excalidraw/mermaid-to-excalidraw",
  "@excalidraw/random-username",
  "@lezer/highlight",
  "browser-fs-access",
  "canvas-roundrect-polyfill",
  "clsx",
  "es6-promise-pool",
  "fuzzy",
  "image-blob-reduce",
  "lodash.debounce",
  "lodash.throttle",
  "nanoid",
  "pako",
  "perfect-freehand",
  "pica",
  "png-chunk-text",
  "png-chunks-encode",
  "png-chunks-extract",
  "points-on-curve",
  "radix-ui",
  "roughjs",
  "tinycolor2",
  "tunnel-rat",
].flatMap(dependencyAlias);

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  resolve: {
    alias: [
      {
        find: /^react$/,
        replacement: path.resolve(__dirname, "node_modules/react/index.js"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.resolve(
          __dirname,
          "node_modules/react/jsx-dev-runtime.js",
        ),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(__dirname, "node_modules/react-dom/index.js"),
      },
      {
        find: /^react-dom\/client$/,
        replacement: path.resolve(__dirname, "node_modules/react-dom/client.js"),
      },
      {
        find: /^jotai$/,
        replacement: path.resolve(__dirname, "src/vendor/jotai.ts"),
      },
      {
        find: /^jotai-scope$/,
        replacement: path.resolve(
          __dirname,
          "node_modules/jotai-scope/dist/index.modern.js",
        ),
      },
      ...sourceDependencyAliases,
      {
        find: /^@excalidraw\/common$/,
        replacement: excalidrawPackage("packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: excalidrawPackage("packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: excalidrawPackage("packages/element/src/index.ts"),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: excalidrawPackage("packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: excalidrawPackage("packages/excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: excalidrawPackage("packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: excalidrawPackage("packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: excalidrawPackage("packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: excalidrawPackage("packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: excalidrawPackage("packages/utils/src/$1"),
      },
      {
        find: /^@excalidraw\/fractional-indexing$/,
        replacement: excalidrawPackage(
          "packages/fractional-indexing/src/index.ts",
        ),
      },
    ],
  },
  server: {
    port: 5174,
    strictPort: false,
    fs: {
      allow: [__dirname, excalidrawRoot],
    },
  },
  optimizeDeps: {
    exclude: ["jotai", "jotai-scope"],
  },
});
