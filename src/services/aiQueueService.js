// [REVISI] Groq API cepat (<1s) dan bukan CPU lokal kita — nggak perlu lagi
// diserialize ketat kayak jaman Ollama CPU-only. Naikkan supaya beberapa
// kasir/toko bisa nanya bersamaan tanpa antri lama. Tetap dibatasi (bukan
// unlimited) supaya nggak bikin burst token besar sekaligus ke kuota
// per-menit Groq — sesuaikan lagi kalau ternyata masih sering kena 429.
const MAX_CONCURRENT = 4;

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
