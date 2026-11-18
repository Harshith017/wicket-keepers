// Sessions and ball clips, kept in the browser's IndexedDB so they survive a
// reload. Nothing leaves the phone.

const DB = 'wkt-tracker', VERSION = 1;
let opening = null;

function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('clips')) d.createObjectStore('clips');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return opening;
}

function run(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const putSession = (s) => run('sessions', 'readwrite', (st) => st.put(s));
export const allSessions = () => run('sessions', 'readonly', (st) => st.getAll());
export const putClip = (key, clip) => run('clips', 'readwrite', (st) => st.put(clip, key));
export const getClip = (key) => run('clips', 'readonly', (st) => st.get(key));
export async function deleteSession(s) {
  await run('sessions', 'readwrite', (st) => st.delete(s.id));
  await run('clips', 'readwrite', (st) => { for (const b of s.balls) if (b.clip) st.delete(b.clip); return null; });
}
