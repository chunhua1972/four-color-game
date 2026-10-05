import type { PlayerSnapshot } from '@four-colors/game-core';
export interface HistoryEntry {
  gameId: string;
  at: number;
  snapshot: PlayerSnapshot;
}
export async function readHistory(): Promise<HistoryEntry[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('four-colors-practice-v1', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('saves');
      req.result.createObjectStore('history', { keyPath: 'gameId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('history');
      const query = tx.objectStore('history').getAll();
      query.onsuccess = () => resolve((query.result as HistoryEntry[]).sort((a, b) => b.at - a.at));
      query.onerror = () => reject(query.error);
      tx.oncomplete = () => db.close();
    };
    req.onerror = () => reject(req.error);
  });
}
