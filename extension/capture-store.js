/* Local-only extension IndexedDB. Extension never posts search evidence to a server. */
const DB_NAME = 'serp-lens-captures-v1';
const STORE_NAME = 'screens';
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error || Error('IndexedDB를 열 수 없습니다.'));
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction(mode, apply) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      const request = apply(t.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || Error('저장 작업이 중단됐습니다.'));
    });
  } finally { db.close(); }
}
export function saveCapture(record) { return transaction('readwrite', s=>s.put(record)); }
export function readCapture(id) { return transaction('readonly', s=>s.get(id)); }
export function deleteCapture(id) { return transaction('readwrite', s=>s.delete(id)); }
