// Independent local evidence store. No server uploads or background crawling.
const DB = 'naver-intelligence-v2';
const VERSION = 2;
const MAX_EXPERIMENTS = 150;
const MAX_SEARCHES = 2500;
const MAX_PAGES = 500;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      for (const name of ['searches', 'pages', 'experiments']) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, {keyPath: 'id'});
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('로컬 저장소 열기 실패'));
  });
}
async function action(store, mode, operation) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = operation(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('저장 작업 실패'));
      tx.onerror = () => reject(tx.error || Error('저장 트랜잭션 실패'));
      tx.onabort = () => reject(tx.error || Error('저장 취소'));
    });
  } finally {
    db.close();
  }
}
async function keepLatest(store, limit) {
  const rows = await action(store, 'readonly', s => s.getAll());
  rows.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  for (const old of rows.slice(limit)) {
    await action(store, 'readwrite', s => s.delete(old.id));
  }
}
export async function saveSearch(record) {
  await action('searches', 'readwrite', s => s.put(record));
  await keepLatest('searches', MAX_SEARCHES);
}
export async function savePage(record) {
  await action('pages', 'readwrite', s => s.put(record));
  await keepLatest('pages', MAX_PAGES);
}
export async function listSearches() {
  const data = await action('searches', 'readonly', s => s.getAll());
  return data.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}
export async function listPages() {
  const data = await action('pages', 'readonly', s => s.getAll());
  return data.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}
export async function removeSearch(id) { return action('searches', 'readwrite', s => s.delete(id)); }
export async function removePage(id) { return action('pages', 'readwrite', s => s.delete(id)); }

export async function saveExperiment(record) {
  await action('experiments','readwrite', s=>s.put(record));
  const all=await listExperiments();
  for(const old of all.slice(MAX_EXPERIMENTS)) await removeExperiment(old.id);
}
export async function listExperiments() {
  const data=await action('experiments','readonly', s=>s.getAll());
  return data.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}
export async function removeExperiment(id) {
  return action('experiments','readwrite', s=>s.delete(id));
}
