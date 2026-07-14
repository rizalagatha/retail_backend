// [REVISI] Turunkan ke 1 — 4 vCPU nggak sanggup jalanin beberapa inference
// LLM beneran paralel tanpa saling rebutan CPU parah (lihat log production:
// Round 1 sampai 462s gara-gara oversubscription num_thread x concurrency).
// Serialize total lebih predictable: request nunggu giliran, tapi begitu
// dapat giliran, prosesnya cepat (~11-15s) karena CPU nggak direbutin.
const MAX_CONCURRENT = 1;

let activeCount = 0;
const queue = [];

const acquireSlot = () => {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeCount < MAX_CONCURRENT) {
        activeCount++;
        resolve();
      } else {
        queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
};

const releaseSlot = () => {
  activeCount = Math.max(0, activeCount - 1);
  const next = queue.shift();
  if (next) next();
};

const getQueueStatus = () => ({
  activeCount,
  waitingCount: queue.length,
});

module.exports = { acquireSlot, releaseSlot, getQueueStatus, MAX_CONCURRENT };
