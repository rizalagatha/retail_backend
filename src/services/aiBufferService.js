// [PENTING] Reuse murni, semua fungsi di sini READ-ONLY. Fungsi write
// (saveConfig, saveCalculatedBuffer, saveSetting, updateBufferStock) SENGAJA
// tidak diimpor — AI cuma boleh baca/hitung rekomendasi, tidak boleh
// mengubah setting buffer beneran di database.
const { getPreviewData, getPreviewDataKDC } = require("./bufferPanelService");
const { getList: getBufferStatusList } = require("./bufferStockService");

const MAX_DETAIL_ROWS = 40; // batas baris detail dikirim ke AI, hemat token

const filterBySubstring = (rows, search, field) => {
  if (!search) return rows;
  const term = search.toLowerCase();
  return rows.filter((r) => (r[field] || "").toLowerCase().includes(term));
};

// =========================================================================
// A. REKOMENDASI buffer — dihitung ulang dari histori penjualan, pakai
// logika resmi Kaosan (tier rata-rata/bulan + perlakuan khusus pareto).
// Reuse bufferPanelService.getPreviewData/getPreviewDataKDC apa adanya.
// =========================================================================
const getBufferRecommendation = async (user, { cabang, search } = {}) => {
  if (!cabang) {
    return {
      needCabang: true,
      message:
        "Cabang wajib disebutkan untuk menghitung rekomendasi buffer (data ini dihitung per cabang, tidak ada mode gabungan semua cabang).",
    };
  }
  if (user.cabang !== "KDC" && cabang !== user.cabang) {
    return {
      needCabang: false,
      message: "Kakak hanya bisa melihat rekomendasi buffer cabang sendiri.",
    };
  }

  const items =
    cabang === "KDC" ? await getPreviewDataKDC() : await getPreviewData(cabang);

  const filtered = filterBySubstring(items, search, "nama");

  if (!search && filtered.length > MAX_DETAIL_ROWS) {
    return {
      tooMany: true,
      cabang,
      totalSku: filtered.length,
      message: `Ada ${filtered.length} SKU di cabang ${cabang}. Sebutkan nama barang spesifik (misal "combed 24s hitam") untuk melihat detail rekomendasi buffer-nya, atau tanyakan ringkasan per kategori.`,
      sample: filtered.slice(0, 5),
    };
  }

  return { cabang, totalSku: filtered.length, items: filtered };
};

// =========================================================================
// B. STATUS buffer SAAT INI — setting yang sudah tersimpan di DB, dibanding
// stok riil, sudah termasuk status "Harus Minta"/"Sudah Minta"/"Cukup".
// Reuse bufferStockService.getList apa adanya.
// =========================================================================
const getCurrentBufferStatus = async (
  user,
  { cabang, search, hanyaPerluMinta = false } = {},
) => {
  if (!cabang) {
    return {
      needCabang: true,
      message: "Cabang wajib disebutkan untuk cek status buffer saat ini.",
    };
  }
  if (user.cabang !== "KDC" && cabang !== user.cabang) {
    return {
      needCabang: false,
      message: "Kakak hanya bisa melihat buffer cabang sendiri.",
    };
  }

  const rows = await getBufferStatusList({
    cabang,
    tampilkanBufferNol: "true",
    kaosan: "true",
    reszo: "false",
  });

  let filtered = filterBySubstring(rows, search, "Nama");
  if (hanyaPerluMinta) {
    filtered = filtered.filter((r) => r.Status === "Harus Minta");
  }

  if (!search && !hanyaPerluMinta && filtered.length > MAX_DETAIL_ROWS) {
    const summary = {
      total: filtered.length,
      harusMinta: filtered.filter((r) => r.Status === "Harus Minta").length,
      sudahMinta: filtered.filter((r) => r.Status === "Sudah Minta").length,
      cukup: filtered.filter((r) => r.Status === "Cukup").length,
    };
    return {
      tooMany: true,
      cabang,
      summary,
      message: `Ada ${filtered.length} SKU di cabang ${cabang}. Sebutkan nama barang spesifik, atau minta ringkasan status ("berapa barang yang harus minta").`,
    };
  }

  return { cabang, total: filtered.length, items: filtered };
};

module.exports = { getBufferRecommendation, getCurrentBufferStatus };
