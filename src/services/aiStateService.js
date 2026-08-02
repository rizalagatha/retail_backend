// State aktif per sesi chat — dipakai supaya model tidak perlu menebak ulang
// dari histori teks mentah saat user melakukan follow-up singkat
// (misal: "kalau minggu lalu gimana?" setelah sebelumnya nanya penjualan Agustus).
//
// CATATAN PENTING: ini in-memory (Map biasa), artinya:
// - Hilang tiap kali proses PM2 di-restart (acceptable, karena sifatnya
//   cuma "pengingat jangka pendek" per sesi, bukan data permanen).
// - TIDAK sinkron antar proses kalau PM2 nanti dijalankan di cluster mode
//   (>1 instance). Kalau suatu saat pindah ke cluster mode, ganti storage
//   ini ke Redis atau tabel DB kecil (session_id, tool, args_json, updated_at).

const activeStateMap = new Map(); // sessionId -> { tool, args, updatedAt }

const MAX_ENTRIES = 500; // safety valve biar Map gak tumbuh liar kalau ada sesi yang gak pernah dibersihkan

const TOOL_LABELS = {
  get_today_sales: "penjualan hari ini",
  get_sales_chart: "penjualan pada periode tertentu",
  get_top_selling_products: "barang terlaris",
  get_total_stock: "total stok",
  get_stock_breakdown_per_branch: "stok per cabang",
  get_stok_kosong: "barang stok kosong",
  get_stok_kosong_fast_moving: "stok kosong fast moving",
  get_real_stock: "stok real barang tertentu",
  get_piutang_total: "total piutang",
  get_piutang_per_cabang: "piutang per cabang",
  get_piutang_customer_summary: "piutang per customer",
  get_sales_target: "pencapaian target penjualan",
  get_branch_performance: "performa/ranking cabang",
  get_stagnant_stock_value: "nilai stok stagnan",
  get_dead_stock_summary: "klasifikasi stok (dead stock)",
  get_cashflow_summary: "ringkasan laba-rugi",
  get_shipment_schedules: "jadwal pengiriman",
  get_agenda_dateline: "deadline SO/SPK",
  get_seasonal_sales: "penjualan seasonal/new arrival",
};

const setActiveState = (sessionId, tool, args) => {
  if (!sessionId || !tool) return;
  if (activeStateMap.size >= MAX_ENTRIES && !activeStateMap.has(sessionId)) {
    const oldestKey = activeStateMap.keys().next().value;
    activeStateMap.delete(oldestKey);
  }
  activeStateMap.set(sessionId, {
    tool,
    args: args || {},
    updatedAt: Date.now(),
  });
};

const getActiveState = (sessionId) => {
  if (!sessionId) return null;
  return activeStateMap.get(sessionId) || null;
};

const clearActiveState = (sessionId) => {
  activeStateMap.delete(sessionId);
};

// Ubah { tool, args } jadi 1 kalimat pendek Bahasa Indonesia buat disuntik
// ke system prompt. Sengaja bahasa natural, bukan nama tool mentah/JSON,
// supaya model gak perlu "menerjemahkan" balik nama fungsi ke konteks bisnis.
const describeActiveState = (state) => {
  if (!state) return null;
  const label = TOOL_LABELS[state.tool] || state.tool;
  const { args } = state;
  const parts = [label];

  if (args.cabang) parts.push(`cabang ${args.cabang}`);
  if (args.search) parts.push(`kata kunci "${args.search}"`);
  if (args.exclude) parts.push(`kecuali "${args.exclude}"`);
  if (args.ukuran) parts.push(`ukuran ${args.ukuran}`);
  if (args.monthLabel) parts.push(args.monthLabel);
  else if (args.period) parts.push(`periode ${args.period}`);

  return parts.join(", ");
};

module.exports = {
  setActiveState,
  getActiveState,
  clearActiveState,
  describeActiveState,
};
