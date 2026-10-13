import type { MarketAnalysisFeed } from './market-analysis';
async function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('stock-market-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('results');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readMarketCache(): Promise<unknown> {
  const db = await database();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('results', 'readonly').objectStore('results').get('latest');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeMarketCache(feed: MarketAnalysisFeed): Promise<void> {
  const db = await database();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('results', 'readwrite');
      transaction.objectStore('results').put(feed, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
