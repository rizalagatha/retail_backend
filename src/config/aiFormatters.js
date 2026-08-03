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
    const cabangLabel = args.cabang ? ` cabang ${args.cabang}` : "";
    let text = `Penjualan${cabangLabel} hari ini: ${formatRupiah(todaySales)}, terjual ${Number(
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
    // [FIX] Susun keterangan cabang & periode dari argumen yang dikirim
    // model, supaya jawaban menegaskan konteks datanya (sebelumnya cuma
    // "Barang paling laris:" tanpa menyebut cabang/periode sama sekali).
    const cabangLabel =
      args.cabang && args.cabang !== "ALL" ? ` di cabang ${args.cabang}` : "";

    const periodLabelMap = {
      today: "hari ini",
      yesterday: "kemarin",
      this_week: "minggu ini",
      last_week: "minggu lalu",
      this_month: "bulan ini",
      last_month: "bulan lalu",
      last_7_days: "7 hari terakhir",
      last_30_days: "30 hari terakhir",
      custom:
        args.startDate && args.endDate
          ? `${args.startDate} s/d ${args.endDate}`
          : "",
    };
    const periodLabel = args.monthLabel
      ? args.monthLabel
      : args.period
        ? periodLabelMap[args.period] || ""
        : "bulan ini";

    const contextLabel = [periodLabel, cabangLabel].filter(Boolean).join("");

    if (!Array.isArray(result) || result.length === 0) {
      return `Belum ada data penjualan barang laris${cabangLabel} untuk periode ini.`;
    }
    const list = result
      .map(
        (p, i) =>
          `${i + 1}. ${p.NAMA} (Size ${p.UKURAN}) — terjual ${Number(
            p.TOTAL || 0,
          ).toLocaleString("id-ID")} pcs`,
      )
      .join("\n");
    const countLabel = result.length !== 10 ? `Top ${result.length} b` : "B";
    return `${countLabel}arang paling laris${contextLabel ? ` ${contextLabel}` : ""}:\n\n${list}`;
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

  get_real_stock: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return `Tidak ditemukan data stok untuk pencarian tersebut${
        args.cabang && args.cabang !== "ALL" ? ` di cabang ${args.cabang}` : ""
      }.`;
    }
    const lines = result
      .map((r, i) => {
        const cabangLabel = r.cabang
          ? `[${r.cabang}] `
          : r.nama_cabang
            ? `[${r.nama_cabang}] `
            : "";
        const namaBarang = r.nama_barang || r.nama || r.NAMA || "-";

        // Cek apakah data dari DB berbentuk pivot (kolom S, M, L, XL, TOTAL)
        if (
          "s" in r ||
          "S" in r ||
          "m" in r ||
          "M" in r ||
          "TOTAL" in r ||
          "total" in r
        ) {
          const s = r.s || r.S || 0;
          const m = r.m || r.M || 0;
          const l = r.l || r.L || 0;
          const xl = r.xl || r.XL || 0;
          const xxl = r.xxl || r.XXL || 0;
          const total = r.total || r.TOTAL || r.tersedia || 0;
          return `${i + 1}. ${cabangLabel}${namaBarang}\n   S:${s} | M:${m} | L:${l} | XL:${xl} | XXL:${xxl}  ➡️  Total: ${total} pcs`;
        } else {
          // Fallback jika datanya flat/baris biasa
          const ukuran = r.ukuran || r.UKURAN || "-";
          const qty = r.stok_fisik || r.stok || r.qty || 0;
          return `${i + 1}. ${cabangLabel}${namaBarang} (Size: ${ukuran}) — ${Number(qty).toLocaleString("id-ID")} pcs`;
        }
      })
      .join("\n\n");
    return `Sisa stok untuk "${args.search}":\n\n${lines}`;
  },

  get_piutang_total: (args, result) => {
    return `Total sisa piutang saat ini: ${formatRupiah(result.totalSisaPiutang)}.`;
  },

  get_sales_target: (args, result) => {
    const { nominal, target } = result;
    const pct = target > 0 ? ((nominal / target) * 100).toFixed(1) : "0";

    const periodLabelMap = {
      today: "hari ini",
      yesterday: "kemarin",
      this_week: "minggu ini",
      last_week: "minggu lalu",
      this_month: "bulan ini",
      last_month: "bulan lalu",
      last_7_days: "7 hari terakhir",
      last_30_days: "30 hari terakhir",
    };
    const periodLabel = args.monthLabel
      ? args.monthLabel
      : args.period && periodLabelMap[args.period]
        ? periodLabelMap[args.period]
        : "bulan ini";

    const cabangLabel = args.cabang ? ` cabang ${args.cabang}` : "";

    let text = `Realisasi penjualan${cabangLabel} ${periodLabel}: ${formatRupiah(nominal)} dari target ${formatRupiah(
      target,
    )} (${pct}% tercapai).`;

    const isFullMonth =
      !args.period || args.period === "this_month" || args.monthLabel;
    if (!isFullMonth) {
      text +=
        "\n\n(Catatan: target memakai target BULANAN, bukan diprorata ke periode ini.)";
    }

    return text;
  },

  get_sales_forecast: (args, result) => {
    if (result?.insufficient) return result.message;

    const cabangLabel =
      args.cabang && args.cabang !== "ALL" ? ` cabang ${args.cabang}` : "";
    const lines = result.forecast
      .map(
        (f, i) =>
          `${i + 1}. ${f.tanggal}: ${formatRupiah(f.prediksi)} (kisaran ${formatRupiah(f.rangeBawah)} - ${formatRupiah(f.rangeAtas)})`,
      )
      .join("\n");

    let text = `Proyeksi penjualan${cabangLabel} (tren ${result.trendDirection}):\n\n${lines}\n\nTotal proyeksi: ${formatRupiah(result.totalForecast)}\n\n${result.disclaimer}`;
    if (result.reliabilityNote) text += `\n\n${result.reliabilityNote}`;
    return text;
  },

  get_branch_performance: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Belum ada data performa cabang untuk periode ini, atau fitur ini memang khusus untuk user Pusat (KDC).";
    }
    const periodLabelMap = {
      today: "hari ini",
      yesterday: "kemarin",
      this_week: "minggu ini",
      last_week: "minggu lalu",
      this_month: "bulan ini",
      last_month: "bulan lalu",
      last_7_days: "7 hari terakhir",
      last_30_days: "30 hari terakhir",
    };
    const periodLabel = args.monthLabel
      ? ` ${args.monthLabel}`
      : args.period && periodLabelMap[args.period]
        ? ` ${periodLabelMap[args.period]}`
        : " bulan ini";

    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nama_cabang}: ${formatRupiah(r.nominal)} dari target ${formatRupiah(
            r.target,
          )} (${Number(r.ach).toFixed(1)}% tercapai)`,
      )
      .join("\n");

    let text = `Ranking performa cabang${periodLabel} (dari yang tertinggi):\n\n${lines}`;

    const isFullMonth =
      !args.period || args.period === "this_month" || args.monthLabel;
    if (!isFullMonth) {
      text +=
        "\n\n(Catatan: target & persentase pencapaian memakai target BULANAN, bukan diprorata ke periode ini — paling akurat untuk membandingkan omset antar cabang.)";
    }

    return text;
  },

  get_sales_chart: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Tidak ada data penjualan untuk rentang waktu tersebut.";
    }
    const totalAll = result.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    const groupBy = args.groupBy || "day";
    const formatTanggal = (val) => {
      if (!val) return "-";
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      if (groupBy === "month") {
        return d.toLocaleDateString("id-ID", {
          month: "long",
          year: "numeric",
        });
      }
      if (groupBy === "week") {
        return `Minggu ${d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}`;
      }
      return d.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };
    // Batasi baris yang ditampilkan supaya jawaban tidak kepanjangan untuk
    // rentang tanggal yang lebar (mis. groupBy=day selama beberapa bulan)
    const MAX_ROWS = 31;
    const rows = result.slice(0, MAX_ROWS);
    const lines = rows
      .map((r) => `- ${formatTanggal(r.tanggal)}: ${formatRupiah(r.total)}`)
      .join("\n");
    const extraNote =
      result.length > MAX_ROWS
        ? `\n\n(menampilkan ${MAX_ROWS} dari ${result.length} baris; total di atas sudah mencakup semuanya)`
        : "";

    // [FIX] Sebelumnya cuma cek args.monthLabel, jadi period seperti
    // "yesterday"/"last_week" tidak pernah tercermin di teks jawaban
    // (selalu jatuh ke "periode ini" generik). Tambahkan pemetaan period
    // sama seperti formatter get_top_selling_products/get_branch_performance.
    const periodLabelMap = {
      today: "hari ini",
      yesterday: "kemarin",
      this_week: "minggu ini",
      last_week: "minggu lalu",
      this_month: "bulan ini",
      last_month: "bulan lalu",
      last_7_days: "7 hari terakhir",
      last_30_days: "30 hari terakhir",
      custom:
        args.startDate && args.endDate
          ? `${args.startDate} s/d ${args.endDate}`
          : "",
    };
    const periodLabel = args.monthLabel
      ? args.monthLabel
      : args.period && periodLabelMap[args.period]
        ? periodLabelMap[args.period]
        : "";

    const cabangLabel =
      args.cabang && args.cabang !== "ALL" ? ` cabang ${args.cabang}` : "";

    return `Total penjualan${periodLabel ? ` ${periodLabel}` : " periode ini"}${cabangLabel}: ${formatRupiah(totalAll)}\n\nRincian:\n${lines}${extraNote}`;
  },

  get_total_stock: (args, result) => {
    if (result?.message) return result.message;

    // [BARU] Hasil filter ke 1 cabang spesifik — struktur datanya beda
    // (tidak ada reservedStock/todayStokIn/Out karena diambil dari
    // breakdown, bukan getTotalStock asli).
    if (result?.cabangSpecific) {
      return `Total stok cabang ${result.cabangNama} (${result.cabangKode}) saat ini: ${Number(
        result.totalStock || 0,
      ).toLocaleString("id-ID")} pcs.`;
    }

    const { totalStock, reservedStock, todayStokIn, todayStokOut } = result;
    let text = `Total stok saat ini: ${Number(totalStock || 0).toLocaleString("id-ID")} pcs`;
    if (reservedStock) {
      text += `, dengan ${Number(reservedStock).toLocaleString("id-ID")} pcs sudah dibooking.`;
    } else {
      text += ".";
    }
    if (todayStokIn !== undefined || todayStokOut !== undefined) {
      text += `\n\nHari ini: masuk ${Number(todayStokIn || 0).toLocaleString(
        "id-ID",
      )} pcs, keluar ${Number(todayStokOut || 0).toLocaleString("id-ID")} pcs.`;
    }
    return text;
  },

  get_stock_breakdown_per_branch: (args, result) => {
    if (result?.message) return result.message;
    if (!Array.isArray(result) || result.length === 0) {
      return "Belum ada data stok per cabang.";
    }
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nama_cabang}: ${Number(r.totalStock || 0).toLocaleString("id-ID")} pcs`,
      )
      .join("\n");
    return `Stok per cabang:\n\n${lines}`;
  },

  get_piutang_per_cabang: (args, result) => {
    if (result?.message) return result.message;
    if (!Array.isArray(result) || result.length === 0) {
      return "Tidak ada data piutang per cabang, atau fitur ini khusus untuk user Pusat (KDC).";
    }
    const lines = result
      .map(
        (r, i) => `${i + 1}. ${r.cabang_nama}: ${formatRupiah(r.sisa_piutang)}`,
      )
      .join("\n");
    return `Sisa piutang per cabang:\n\n${lines}`;
  },

  get_piutang_customer_summary: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Tidak ada data piutang customer untuk saat ini.";
    }
    const cabangLabel =
      args.cabang && args.cabang !== "ALL" ? ` (cabang ${args.cabang})` : "";
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.customer_nama}: ${formatRupiah(r.total_piutang)} (${r.jumlah_invoice} invoice)`,
      )
      .join("\n");
    return `Customer dengan piutang terbanyak${cabangLabel}:\n\n${lines}`;
  },

  get_stagnant_stock_value: (args, result) => {
    return `Nilai stok stagnan (tidak terjual 30 hari terakhir): ${formatRupiah(
      result.totalStagnantValue,
    )}.`;
  },

  get_dead_stock_summary: (args, result) => {
    const {
      fm,
      std,
      sm,
      ds,
      nilaiFm,
      nilaiStd,
      nilaySm,
      nilaiDs,
      total,
      nilaiTotal,
    } = result;
    const cabangLabel =
      args.cabang && args.cabang !== "ALL" ? ` cabang ${args.cabang}` : "";
    return `Klasifikasi stok${cabangLabel} (total ${Number(
      total || 0,
    ).toLocaleString("id-ID")} pcs, senilai ${formatRupiah(nilaiTotal)}):

1. Fast Moving (≤6 bln): ${Number(fm || 0).toLocaleString("id-ID")} pcs — ${formatRupiah(nilaiFm)}
2. Standar (6bln–1thn): ${Number(std || 0).toLocaleString("id-ID")} pcs — ${formatRupiah(nilaiStd)}
3. Slow Moving (1–2thn): ${Number(sm || 0).toLocaleString("id-ID")} pcs — ${formatRupiah(nilaySm)}
4. Dead Stock (>2thn): ${Number(ds || 0).toLocaleString("id-ID")} pcs — ${formatRupiah(nilaiDs)}`;
  },

  get_cashflow_summary: (args, result) => {
    const {
      omset,
      hpp,
      labaKotor,
      margin,
      pengeluaran,
      labaBersih,
      kasAktual,
      jmlTransaksi,
    } = result;
    const dateLabel = args.date ? args.date : "kemarin";
    return `Ringkasan laba-rugi ${dateLabel}:

- Omset: ${formatRupiah(omset)} (${Number(jmlTransaksi || 0).toLocaleString("id-ID")} transaksi)
- HPP: ${formatRupiah(hpp)}
- Laba Kotor: ${formatRupiah(labaKotor)} (margin ${margin}%)
- Biaya Operasional: ${formatRupiah(pengeluaran)}
- Laba Bersih: ${formatRupiah(labaBersih)}
- Kas Riil Diterima: ${formatRupiah(kasAktual)}`;
  },

  get_shipment_schedules: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Tidak ada jadwal pengiriman aktif saat ini.";
    }
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nama_cabang} — ${r.status}${
            r.no_sj ? ` (SJ: ${r.no_sj})` : ""
          }, tanggal ${new Date(r.tanggal_kirim).toLocaleDateString("id-ID")}`,
      )
      .join("\n");
    return `Jadwal pengiriman terbaru:\n\n${lines}`;
  },

  get_agenda_dateline: (args, result) => {
    if (!Array.isArray(result) || result.length === 0) {
      return "Tidak ada deadline SO/SPK yang perlu segera diperhatikan.";
    }
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nomor} — ${r.customer || "Umum"}, deadline ${new Date(
            r.dateline,
          ).toLocaleDateString("id-ID")}`,
      )
      .join("\n");
    return `Daftar deadline terdekat:\n\n${lines}`;
  },

  get_invoice_backlog_analysis: (args, result) => {
    if (result.jumlahInvoiceBacklog === 0) {
      return "Tidak ditemukan indikasi invoice atas SO lama di periode ini — omset kemungkinan besar murni dari transaksi baru.";
    }
    const lines = result.detail
      .slice(0, 10)
      .map(
        (r, i) =>
          `${i + 1}. Invoice ${r.inv_nomor} (${r.tgl_invoice}) — SO asli ${r.tgl_so_asli}, telat ${r.lag_hari} hari, nilai ${formatRupiah(r.nominal)}`,
      )
      .join("\n");
    return `Ditemukan ${result.jumlahInvoiceBacklog} invoice atas SO lama (rata-rata telat ${result.avgLagDays} hari), menyumbang ${formatRupiah(result.totalBacklogNominal)} (${result.backlogPercentage}% dari total omset periode ini).\n\nRincian:\n${lines}`;
  },

  get_buffer_recommendation: (args, result) => {
    if (result.needCabang || result.tooMany) return result.message;
    if (!result.items || result.items.length === 0)
      return "Tidak ada data buffer untuk pencarian ini.";
    const lines = result.items
      .slice(0, 20)
      .map(
        (it, i) =>
          `${i + 1}. ${it.nama} (${it.ukuran}) — Buffer: ${it.buffer} pcs (Min ${it.min} / Max ${it.max})${it.is_pareto ? " 🔥 Pareto" : ""}`,
      )
      .join("\n");
    return `Rekomendasi buffer cabang ${result.cabang}:\n\n${lines}`;
  },

  get_current_buffer_status: (args, result) => {
    if (result.needCabang) return result.message;
    if (result.tooMany) {
      return `${result.message}\n\nRingkasan: ${result.summary.harusMinta} harus minta, ${result.summary.sudahMinta} sudah minta, ${result.summary.cukup} cukup.`;
    }
    if (!result.items || result.items.length === 0)
      return "Tidak ada data buffer untuk pencarian ini.";
    const lines = result.items
      .slice(0, 20)
      .map(
        (it, i) =>
          `${i + 1}. ${it.Nama} (${it.Ukuran}) — Stok: ${it.Stok}, Min: ${it.MinBuffer}, Status: ${it.Status}`,
      )
      .join("\n");
    return `Status buffer cabang ${result.cabang}:\n\n${lines}`;
  },

  get_product_price: (args, result) => {
    if (result?.error) return result.error;
    if (!Array.isArray(result) || result.length === 0) {
      return `Barang untuk pencarian "${args.search}" tidak ditemukan.`;
    }
    const lines = result
      .map(
        (r, i) =>
          `${i + 1}. ${r.nama} (Size ${r.ukuran}) — ${formatRupiah(r.harga)}`,
      )
      .join("\n");
    return `Harga dasar untuk "${args.search}":\n\n${lines}`;
  },
};

module.exports = aiFormatters;
