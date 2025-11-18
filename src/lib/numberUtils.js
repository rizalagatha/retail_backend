function toNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundTo(value, step) {
  if (!step || step === 0) return value;
  return Math.round(value / step) * step;
}

function applyRoundingPolicy(value, policy = "ROUND_1") {
  const n = toNumber(value);

  switch (policy) {
    case "NONE":
      return n;

    case "ROUND_1":
    case "ROUND_0":
      // aturan baru: hilangkan desimal → Math.round normal
      return Math.round(n);

    case "ROUND_50":
      return roundTo(n, 50);

    case "ROUND_500":
      return roundTo(n, 500);

    case "ROUND_1000":
      return roundTo(n, 1000);

    default:
      return n;
  }
}

function formatRupiah(value, showDecimals = false) {
  const opts = showDecimals
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 0 };

  return new Intl.NumberFormat("id-ID", opts).format(value || 0);
}

module.exports = {
  applyRoundingPolicy,
  formatRupiah,
  roundTo,
  toNumber,
};
