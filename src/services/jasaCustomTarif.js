// Satu-satunya sumber tarif jasa custom (katalog publik + penawaran online).
// Mengubah harga cukup di sini.

const UKURAN_CETAK = ["A3", "A4", "A5"];
const WARNA_KAOS = ["WARNA", "PUTIH"];

// Harga sama untuk kaos warna dan putih
const rata = (a3, a4, a5) => ({
  A3: { WARNA: a3, PUTIH: a3 },
  A4: { WARNA: a4, PUTIH: a4 },
  A5: { WARNA: a5, PUTIH: a5 },
});

const JASA_CUSTOM = [
  {
    mode: "luas",
    kode: "SD",
    nama: "Sablon DTF",
    minPerTitik: 0,
    tarif: [{ minQty: 1, hargaPerCm2: 25 }],
  },
  {
    mode: "luas",
    kode: "DP",
    nama: "DTF Premium",
    minPerTitik: 0,
    tarif: [{ minQty: 1, hargaPerCm2: 35 }],
  },
  {
    mode: "luas",
    kode: "BR",
    nama: "Bordir Komputer",
    minPerTitik: 5000,
    tarif: [
      { minQty: 1, hargaPerCm2: 1000 },
      { minQty: 11, hargaPerCm2: 500 },
      { minQty: 20, hargaPerCm2: 250 },
      { minQty: 500, hargaPerCm2: 100 },
    ],
  },
  {
    mode: "ukuran",
    kode: "SB",
    nama: "Sablon Plastisol",
    bedaWarnaKaos: false,
    tarif: [{ minQty: 1, harga: rata(35000, 20000, 10000) }],
  },
  {
    // Berlaku mulai 1 Mei 2026
    mode: "ukuran",
    kode: "TG",
    nama: "DTG",
    bedaWarnaKaos: true,
    tarif: [
      {
        minQty: 1,
        harga: {
          A3: { WARNA: 50000, PUTIH: 40000 },
          A4: { WARNA: 36000, PUTIH: 30000 },
          A5: { WARNA: 26000, PUTIH: 22500 },
        },
      },
      {
        minQty: 10,
        harga: {
          A3: { WARNA: 36000, PUTIH: 35000 },
          A4: { WARNA: 28000, PUTIH: 27000 },
          A5: { WARNA: 23000, PUTIH: 21000 },
        },
      },
    ],
  },
];

const getJasa = (kode) => JASA_CUSTOM.find((j) => j.kode === kode) || null;

// Ambil tarif dengan minQty terbesar yang masih <= qty
const pilihTarif = (tarif, qty) =>
  [...tarif].sort((a, b) => b.minQty - a.minQty).find((t) => qty >= t.minQty) ??
  tarif[0];

// Label sizeCetak persis seperti yang dipakai form internal
const labelSizeCetak = (jasa, ukuran, warna) => {
  if (jasa.mode === "luas") return "Custom";
  return jasa.bedaWarnaKaos ? `${ukuran} KAOS ${warna}` : ukuran;
};

/**
 * qty = TOTAL pcs desain (bukan per baris ukuran kaos): dipakai memilih tarif bertingkat.
 * Harga per titik dibulatkan ke rupiah supaya tidak menyimpan noise float (8580.000000000002).
 */
const hitungEstimasi = (jasa, qty, ukuran, warna, titiks) => {
  if (!(qty >= 1) || titiks.length === 0) {
    return { satuan: 0, total: 0, hargaPerCm2: 0, perTitik: [] };
  }

  if (jasa.mode === "ukuran") {
    const baris = pilihTarif(jasa.tarif, qty).harga[ukuran];
    if (!baris) throw new Error("Ukuran cetak tidak valid.");
    const harga = baris[jasa.bedaWarnaKaos ? warna : "WARNA"];
    if (!Number.isFinite(harga)) throw new Error("Warna kaos tidak valid.");
    const satuan = harga * titiks.length;
    return {
      satuan,
      total: satuan * qty,
      hargaPerCm2: 0,
      perTitik: titiks.map((t) => ({ nama: t.nama, luas: 0, harga })),
    };
  }

  const hargaPerCm2 = pilihTarif(jasa.tarif, qty).hargaPerCm2;
  const perTitik = titiks.map((t) => {
    const luas = Math.max(0, t.panjang || 0) * Math.max(0, t.lebar || 0);
    if (!Number.isFinite(luas)) throw new Error("Ukuran titik tidak valid.");
    return {
      nama: t.nama,
      luas,
      harga: Math.round(Math.max(luas * hargaPerCm2, jasa.minPerTitik)),
    };
  });
  const satuan = perTitik.reduce((sum, t) => sum + t.harga, 0);
  return { satuan, total: satuan * qty, hargaPerCm2, perTitik };
};

module.exports = {
  UKURAN_CETAK,
  WARNA_KAOS,
  JASA_CUSTOM,
  getJasa,
  labelSizeCetak,
  hitungEstimasi,
};
