// storage.js — persistencia local (IndexedDB): entrenos guardados y sesiones grabadas.
// Todo vive en el navegador del dispositivo donde se usa. Cada sesión se puede
// exportar a CSV para analizarla fuera (ver app.js: exportSessionCsv).

const DB_NAME = 'rodillo-ironman';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('workouts')) {
        db.createObjectStore('workouts', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const Storage = {
  saveSession: (session) => idbPut('sessions', session),
  getAllSessions: () => idbGetAll('sessions').then((s) => s.sort((a, b) => b.startedAt - a.startedAt)),
  deleteSession: (id) => idbDelete('sessions', id),

  saveWorkout: (workout) => idbPut('workouts', workout),
  getAllWorkouts: () => idbGetAll('workouts'),
  deleteWorkout: (id) => idbDelete('workouts', id),
};

window.Storage = Storage;
