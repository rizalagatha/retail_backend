const changelogs = {
  "1.1.4": {
    date: "2025-12-11",
    changes: [
      {
        title: "URGENT:",
        items: [
          "Perbaikan Logika Pengecekan Promo Grand Opening K11:",
          "Promo tetap dihitung meskipun ada item baru yang ditambahkan setelah lanjut ke pembayaran.",
        ],
      },
    ],
  },
  "1.1.3": {
    date: "2025-12-11",
    changes: [
      {
        title: "Perbaikan:",
        items: [
          "Fix Changelog dialog",
          "Fix Bug Detail Titik dan Ukuran SO DTF hilang (bismillah work ya Allah plissss)",
        ],
      },
    ],
  },
  "1.1.2": {
    date: "2025-12-11",
    changes: ["Perbaikan: Penambahan Kolom Stok Pesanan pada Invoice"],
  },
  "1.1.1": {
    date: "2025-12-11",
    changes: [
      "UI: Penambahan Varian Grafik Penjualan pada Dashboard",
      {
        title: "Fitur Baru:",
        items: [
          "Alert pengingat SJ belum diterima dan Mutasi Antar Store belum diterima",
          "Laporan Kontribusi Omset untuk user KDC",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Laporan Kartu Stok: Perbaikan ketidaksesuaian saldo akhir dengan detail",
          "Changelog : Perbaikan pada dialog changelog yang tidak muncul",
        ],
      },
    ],
  },
  "1.1.0": {
    date: "2025-12-11",
    changes: [
      "Modul Baru: Store Online untuk integrasi dengan toko online",
      "Fitur Baru: Changelog aplikasi (dapat diklik pada footer versi aplikasi)",

      // [MODIFIKASI] Gunakan Object untuk List Bersarang
      {
        title: "Perbaikan:",
        items: [
          "File Design tidak termasuk stok (dianggap Jasa)",
          "File Design dapat dimasukkan ke SO setelah menambahkan Jasa Design",
          "Laporan Stok Real-time: Penambahan filter untuk menampilkan hanya ukuran dengan stok (tidak nol)",
          "Laporan Kartu Stok: Penambahan kolom 'No. Pesanan' pada semua transaksi dari SO",
          "Laporan Kartu Stok: Penambahan tipe transaksi Mutasi In dari Pesanan yang sempat menghilang",
        ],
      },
    ],
  },
  "1.0.9": {
    date: "2025-12-10",
    changes: ["Perbaikan: Penambahan Dropdown Cabang pada Proses Stok Opname"],
  },
  "1.0.8": {
    date: "2025-12-05",
    changes: ["UI: Penambahan Selisih Qty pada Proses Stok Opname"],
  },
  "1.0.7": {
    date: "2025-12-01",
    changes: ["Perbaikan: Total pada Proses Stok Opname"],
  },
  "1.0.6": {
    date: "2025-11-28",
    changes: [
      "Fitur Baru: Kalkulator, Lapor Bug, Jadwal Sholat, Ping, dan Bantuan Shorcut pada Footer",
      "Perbaikan: Kalkukasi In Out Stok",
      "UI: Perbaikan UI pada Footer",
    ],
  },
  "1.0.2": [
    "Fitur Baru: Tambah tombol 'Simpan Lokal' (Draft) di Invoice",
    "Perbaikan: Bug kalkulasi diskon member",
    "UI: Perubahan warna header tabel agar lebih kontras",
  ],
  "1.0.1": [
    "Fitur Baru: Notifikasi update otomatis",
    "Perbaikan: Login timeout diperpanjang",
  ],
  "1.0.0": ["Rilis Perdana Aplikasi"],
};

module.exports = changelogs;
