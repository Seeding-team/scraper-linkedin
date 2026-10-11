/**
 * Cache BỀN cho Inbox FB bằng IndexedDB (tồn tại qua reload / đóng mở lại trang).
 *
 * Vì Markee service nằm ngoài repo (không sửa được storage phía server), ta lưu
 * tin nhắn từng hội thoại + danh sách hộp thư ngay trên trình duyệt để:
 *   - Mở lại hội thoại hiện TỨC THÌ, không phải chờ extension quét lại.
 *   - Sau khi gửi thành công tự lưu, F5 vẫn còn.
 *
 * Tất cả hàm đều an toàn khi IndexedDB không khả dụng (SSR / trình duyệt cũ):
 * đọc trả null, ghi im lặng bỏ qua.
 */

const DB_NAME = "markee-fb-inbox";
const DB_VERSION = 2;
const STORE_THREADS = "threads"; // key: `${acc}::${conv_id}` -> { messages, loaded_at, savedAt }
const STORE_CONVS = "convs"; // key: acc -> { conversations, savedAt }

export interface CachedThread<M = unknown> {
  messages: M[];
  loaded_at: string | null;
  savedAt: number;
}

function hasIDB(): boolean {
  return typeof window !== "undefined" && !!window.indexedDB;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error("no-idb"));
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if ((event.oldVersion || 0) > 0) {
        if (db.objectStoreNames.contains(STORE_THREADS)) db.deleteObjectStore(STORE_THREADS);
        if (db.objectStoreNames.contains(STORE_CONVS)) db.deleteObjectStore(STORE_CONVS);
      }
      if (!db.objectStoreNames.contains(STORE_THREADS)) db.createObjectStore(STORE_THREADS);
      if (!db.objectStoreNames.contains(STORE_CONVS)) db.createObjectStore(STORE_CONVS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function threadKey(acc: string, convId: string): string {
  return `${acc}::${convId}`;
}

/** Lưu (ghi đè) 1 thread. Im lặng bỏ qua nếu IndexedDB lỗi. */
export async function idbSetThread<M = unknown>(
  acc: string,
  convId: string,
  messages: M[],
  loadedAt: string | null,
): Promise<void> {
  if (!hasIDB() || !acc || !convId) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_THREADS, "readwrite");
      const value: CachedThread<M> = { messages, loaded_at: loadedAt, savedAt: Date.now() };
      tx.objectStore(STORE_THREADS).put(value, threadKey(acc, convId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

/** Đọc 1 thread đã cache (null nếu chưa có). */
export async function idbGetThread<M = unknown>(
  acc: string,
  convId: string,
): Promise<CachedThread<M> | null> {
  if (!hasIDB() || !acc || !convId) return null;
  try {
    const db = await openDB();
    return await new Promise<CachedThread<M> | null>((resolve) => {
      const tx = db.transaction(STORE_THREADS, "readonly");
      const req = tx.objectStore(STORE_THREADS).get(threadKey(acc, convId));
      req.onsuccess = () => resolve((req.result as CachedThread<M>) || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/**
 * Nạp TẤT CẢ thread của 1 acc trong 1 lần (để warm in-memory Map khi đổi acc).
 * Trả về { [conv_id]: CachedThread }.
 */
export async function idbGetAllThreadsForAcc<M = unknown>(
  acc: string,
): Promise<Record<string, CachedThread<M>>> {
  const out: Record<string, CachedThread<M>> = {};
  if (!hasIDB() || !acc) return out;
  try {
    const db = await openDB();
    const prefix = `${acc}::`;
    const range = IDBKeyRange.bound(prefix, prefix + "￿");
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_THREADS, "readonly");
      const req = tx.objectStore(STORE_THREADS).openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        const key = String(cursor.key);
        const convId = key.slice(prefix.length);
        out[convId] = cursor.value as CachedThread<M>;
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* ignore */ }
  return out;
}

/** Lưu danh sách hội thoại (hộp thư) của 1 acc để F5 hiện ngay. */
export async function idbSetConvs<C = unknown>(acc: string, conversations: C[]): Promise<void> {
  if (!hasIDB() || !acc) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CONVS, "readwrite");
      tx.objectStore(STORE_CONVS).put({ conversations, savedAt: Date.now() }, acc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

/**
 * Dọn thread cũ để IndexedDB không phình mãi. Xóa các thread có savedAt cũ hơn maxAgeMs
 * (mặc định 30 ngày). Gọi 1 lần khi vào trang.
 */
export async function idbPruneOld(maxAgeMs = 30 * 24 * 3600 * 1000): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    const cutoff = Date.now() - maxAgeMs;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_THREADS, "readwrite");
      const req = tx.objectStore(STORE_THREADS).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const v = c.value as CachedThread | undefined;
        if (!v || typeof v.savedAt !== "number" || v.savedAt < cutoff) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

/** Đọc danh sách hội thoại đã cache (null nếu chưa có). */
export async function idbGetConvs<C = unknown>(acc: string): Promise<C[] | null> {
  if (!hasIDB() || !acc) return null;
  try {
    const db = await openDB();
    return await new Promise<C[] | null>((resolve) => {
      const tx = db.transaction(STORE_CONVS, "readonly");
      const req = tx.objectStore(STORE_CONVS).get(acc);
      req.onsuccess = () => {
        const v = req.result as { conversations?: C[] } | undefined;
        resolve(v?.conversations || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}
