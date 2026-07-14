// Semaphore sederhana — batasi jumlah request yang boleh diproses Ollama
// bersamaan. Berdasarkan load test: 3 concurrent masih wajar (~35s rata-rata),
// 5 concurrent sudah jauh memburuk (~70s rata-rata, ada yang sampai 127s).
const MAX_CONCURRENT = 3;

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
