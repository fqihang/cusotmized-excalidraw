import type { WorkspaceHandle } from "../types";

const DB_NAME = "personal-excalidraw";
const DB_VERSION = 1;
const STORE_NAME = "recent-workspaces";

export type RecentWorkspaceRecord = {
  id: string;
  name: string;
  handle: WorkspaceHandle;
  openedAt: string;
};

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txStore = async (mode: IDBTransactionMode) => {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  return { db, tx, store };
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const listRecentWorkspaces = async () => {
  const { db, store } = await txStore("readonly");
  try {
    const records = await requestToPromise<RecentWorkspaceRecord[]>(
      store.getAll(),
    );
    return records.sort(
      (a, b) =>
        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
    );
  } finally {
    db.close();
  }
};

export const rememberWorkspace = async (
  handle: WorkspaceHandle,
  name = handle.name,
) => {
  const { db, tx, store } = await txStore("readwrite");
  const records = await requestToPromise<RecentWorkspaceRecord[]>(
    store.getAll(),
  );

  let id: string = crypto.randomUUID();
  for (const record of records) {
    try {
      const sameNative =
        "path" in record.handle &&
        "path" in handle &&
        record.handle.path === handle.path;
      const sameBrowser =
        "isSameEntry" in record.handle &&
        "isSameEntry" in handle &&
        (await record.handle.isSameEntry(handle));
      if (sameNative || sameBrowser) {
        id = record.id;
        break;
      }
    } catch {
      // Ignore stale handles from browsers that no longer expose permission.
    }
  }

  store.put({
    id,
    name,
    handle,
    openedAt: new Date().toISOString(),
  } satisfies RecentWorkspaceRecord);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

export const forgetWorkspace = async (id: string) => {
  const { db, tx, store } = await txStore("readwrite");
  store.delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};
