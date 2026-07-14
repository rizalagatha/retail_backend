// Formatter template per tool — dipakai untuk menyusun jawaban langsung di kode
// TANPA panggil LLM lagi (skip Round 2), khusus saat cuma 1 tool yang dipanggil
// dan hasilnya tidak error. Ini optimasi kecepatan untuk Ollama CPU-only.
//
// Kalau suatu tool TIDAK ada di sini, alurnya otomatis fallback ke cara lama
// (LLM yang susun jawaban di Round 2) — jadi aman ditambah bertahap.

const formatRupiah = (val) => {
  const num = Math.round(Number(val) || 0);
  return `Rp ${num.toLocaleString("id-ID")}`;
};

const aiFormatters = {
  get_today_sales: (args, result) => {
    const { todaySales, todayQty, todayTransactions, salesBreakdown } = result;
    let text = `Penjualan hari ini: ${formatRupiah(todaySales)}, terjual ${Number(
      todayQty || 0,
    ).toLocaleString("id-ID")} pcs dari ${Number(
      todayTransactions || 0,
    ).toLocaleString("id-ID")} transaksi.`;

    if (salesBreakdown && salesBreakdown.length > 0) {
      const top3 = salesBreakdown
        .slice(0, 3)
        .map((b, i) => `${i + 1}. ${b.nama}: ${formatRupiah(b.omset)}`)
        .join("\n");
      text += `\n\nTop 3 cabang:\n${top3}`;
    }
    return text;
  },

  get_top_selling_products: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Belum ada data penjualan barang laris untuk periode ini.";
    }
    const list = result
      .map(
        (p, i) =>
          `${i + 1}. ${p.NAMA} (Size ${p.UKURAN}) — terjual ${Number(
            p.TOTAL || 0,
          ).toLocaleString("id-ID")} pcs`,
      )
      .join("\n");
    return `Barang paling laris:\n\n${list}`;
  },

  get_stok_kosong: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return `Tidak ada barang kosong untuk pencarian ini${
        args.cabang ? ` di cabang ${args.cabang}` : ""
      }.`;
    }

    // Kelompokkan per (cabang, nama_barang) — gabung semua ukuran jadi satu baris
    const grouped = new Map();
    for (const row of result) {
      const key = `${row.nama_cabang}||${row.nama_barang}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          cabang: row.nama_cabang,
          nama: row.nama_barang,
          ukuranList: [],
        });
      }
      grouped.get(key).ukuranList.push(row.ukuran);
    }

    const items = Array.from(grouped.values());
    const distinctCabang = new Set(items.map((i) => i.cabang));
    const isSingleCabang = distinctCabang.size === 1;

    const lines = items
      .map((it, i) => {
        const prefix = isSingleCabang ? "" : `[${it.cabang}] `;
        return `${i + 1}. ${prefix}${it.nama} — ukuran: ${it.ukuranList.join(", ")}`;
      })
      .join("\n");

    const header = isSingleCabang
      ? `Barang kosong di cabang ${items[0].cabang}:`
      : `Barang kosong (${distinctCabang.size} cabang):`;

    return `${header}\n\n${lines}\n\nMohon segera dilakukan restock untuk barang-barang tersebut.`;
  },

  get_stok_kosong_fast_moving: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return `Tidak ada barang fast moving yang kosong saat ini${
        args.cabang ? ` di cabang ${args.cabang}` : ""
      }.`;
    }
    const distinctCabang = new Set(result.map((r) => r.nama_cabang));
    const isSingleCabang = distinctCabang.size === 1;

    const lines = result
      .map((r, i) => {
        const prefix = isSingleCabang ? "" : `[${r.nama_cabang}] `;
        return `${i + 1}. ${prefix}${r.nama} (${r.ukuran}) — terakhir diterima ${r.umur_bulan} bulan lalu`;
      })
      .join("\n");

    return `Barang fast moving yang kosong:\n\n${lines}\n\nBarang-barang ini termasuk laris, sebaiknya segera diprioritaskan restock.`;
  },

  get_piutang_total: (args, result) => {
    return `Total sisa piutang saat ini: ${formatRupiah(result.totalSisaPiutang)}.`;
  },

  get_sales_target: (args, result) => {
    const { nominal, target } = result;
    const pct = target > 0 ? ((nominal / target) * 100).toFixed(1) : "0";
    return `Realisasi penjualan bulan ini: ${formatRupiah(nominal)} dari target ${formatRupiah(
      target,
    )} (${pct}% tercapai).`;
  },

  get_branch_performance: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Belum ada data performa cabang untuk bulan ini, atau fitur ini memang khusus untuk user Pusat (KDC).";
    }
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nama_cabang}: ${formatRupiah(r.nominal)} dari target ${formatRupiah(
            r.target,
          )} (${Number(r.ach).toFixed(1)}% tercapai)`,
      )
      .join("\n");
    return `Ranking performa cabang bulan ini (dari yang tertinggi):\n\n${lines}`;
  },
};

module.exports = aiFormatters;
