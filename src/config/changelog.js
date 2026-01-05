const changelogs = {
  "1.2.12": {
    date: "2026-01-03",
    changes: [
      "Setting Penjualan Online/Marketplace Online untuk K05",
      {
        title: "Penambahan:",
        items: [
          "Warna Baris Magenta untuk Halaman Browse SO, untuk SO yang sudah Lunas namun belum Invoice",
          "Pencarian barang pada Invoice/SO tidak harus tepat nama barangnya dan tidak harus menggunakan %, contoh mencari (KO POLOS PENDEK DBF SIGNATURE BLACK) bisa langsung ketik (black dbf)",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan Card dan Running Text Promo berlaku untuk K11",
          "Card Promo pada Buat Invoice sekarang dapat di-minimize",
          "Pencarian Customer Retail pada Invoice",
          "Perbaikan Cetak Barcode",
        ],
      },
    ],
  },
  "1.2.12": {
    date: "2026-01-03",
    changes: [
      "Setting Retail Web Based untuk Reszo K04",
      {
        title: "Penambahan:",
        items: [
          "Warna Baris Magenta untuk Halaman Browse SO, untuk SO yang sudah Lunas namun belum Invoice",
          "Pencarian barang pada Invoice/SO tidak harus tepat nama barangnya dan tidak harus menggunakan %, contoh mencari (KO POLOS PENDEK DBF SIGNATURE BLACK) bisa langsung ketik (black dbf)",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan Card dan Running Text Promo berlaku untuk K11",
          "Card Promo pada Buat Invoice sekarang dapat di-minimize",
          "Pencarian Customer Retail pada Invoice",
          "Perbaikan Cetak Barcode",
        ],
      },
    ],
  },
  "1.2.11": {
    date: "2025-12-31",
    changes: [
      "Update Promo Kaosan Bulan Januari 2026 : Promo Reguler sama seperti bulan Desember 2025",
      {
        title: "Penambahan:",
        items: [
          "Tampilan Card baru pada Dashboard : Analisis Kesiapan Stok Pareto",
          "Filter Semua Cabang pada halaman Surat Pesanan untuk user KDC/HO",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan ubah Metode Pembayaran Invoice belum mengupdate Tanggal Transfer Setoran Pembayaran",
          "Perbaikan Perhitungan Laporan Sales vs Target",
          "Perbaikan Export data Surat Pesanan",
        ],
      },
    ],
  },
  "1.2.10": {
    date: "2025-12-29",
    changes: [
      "Fitur Baru : Cari DP yang terkait ke Customer pada Surat Pesanan",
      {
        title: "Penambahan:",
        items: [
          "Dashboard untuk user Gudang DC",
          "Feedback suara ketika scan barcode",
          "Filter Semua Cabang pada Halaman Invoice untuk user KDC",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Optimalisasi Halaman Browse Invoice, sekarang dapat menampilkan data dari range tanggal lama dengan cepat",
          "Kolom Kode Customer pada seluruh halaman Browse Transaksi dipindahkan ke sebelah kiri tanggal",
          "Perbaikan Otorisasi untuk Ambil Barang K01",
          "Perbaikan Perhitungan Laporan Sales vs Target",
        ],
      },
    ],
  },
  "1.2.9": {
    date: "2025-12-27",
    changes: [
      "Fitur Baru : Edit metode Pembayaran Invoice",
      {
        title: "Penambahan:",
        items: [
          "Kolom Stok pada pencarian Minta Barang",
          "Kolom Open SO dan Sisa Piutang pada Monitoring Achievement, dapat diklik untuk melihat detail 30 hari terakhir serta Akumulasi",
          "Pembaruan halaman Laporan List Otorisasi mengikuti model otorisasi terbaru",
          "Keterangan pada Retur Jual dan Retur Barang ke DC wajib diisi",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Tampilan dan Bug pada halaman Price List",
          "Perbaikan Invoice Karyawan Potong Gaji tidak bisa ditarik di Potongan oleh Finance",
          "Perbaikan seluruh Export Data terutama bagian format tanggal",
        ],
      },
    ],
  },
  "1.2.8": {
    date: "2025-12-25",
    changes: [
      "Penambahan: Refund dapat memanggil no SO",
      {
        title: "Perbaikan:",
        items: ["Perbaikan auto approve pada halaman Refund"],
      },
    ],
  },
  "1.2.7": {
    date: "2025-12-25",
    changes: [
      "Fitur Baru: Model Baru Otorisasi, sekarang tanpa pin. Mekanismenya adalah dengan mengisi keterangan untuk diajukan ke Manager, kemudian Manager menyetujui lewat approval melalui aplikasi di Android.",
      {
        title: "Perbaikan dan Pembaruan:",
        items: [
          "Perbaikan Halaman Refund",
          "Perbaikan Format Export Laporan Stok Real Time",
          "Penambahan Kolom Kategori Barang pada halaman Surat Pesanan",
          "Perbaikan Halaman Pengambilan Barang",
          "Perbaikan Diskon Halaman Penawaran",
          "Perbaikan Pencarian Barang F1/F2 agar lebih smooth",
        ],
      },
    ],
  },
  "1.2.6": {
    date: "2025-12-22",
    changes: [
      "Fitur Baru: Inputan NIK pada Invoice untuk Pembelian Karyawan Potong Gaji, otomatis Memvalidasi NIK dan Nama Karyawan serta menghitung limitnya pada periode bulan penggajian berjalan",
      {
        title: "Perbaikan dan Pembaruan:",
        items: [
          "Pencegahan Double Simpan pada Invoice",
          "Mekanisme dan Perhitungan Simpan Invoice sudah disesuaikan dengan program lama",
          "Minta Barang ke DC dibatasi maksimal 120 pcs per satu Nomor Permintaan",
          "Penambahan filter Semua Cabang dan kolom Tanggal Terima SJ pada Halaman Surat Jalan ke Store untuk DC",
          "Penambahan Grand Total pada Koreksi Stok",
          "Perbaikan default jenis Retur Jual menjadi Tukar Barang",
        ],
      },
    ],
  },
  "1.2.5": {
    date: "2025-12-19",
    changes: [
      {
        title: "Perbaikan:",
        items: [
          "Print Invoice A4 diurutkan sesuai ukuran",
          "DP dari SO tidak masuk ke kolom DP setelah di-invoice",
          "Sisa Piutang pada Payment Invoice sudah mengurangi Retur Jual",
          "Laporan Kartu Stok sudah menampilkan Mutasi In Out Produksi",
        ],
      },
      {
        title: "UI:",
        items: [
          "Tampilan Dashboard sudah bisa refresh data secara dinamis",
          "Dark Mode atau Mode Gelap sudah bisa dipakai sepenuhnya",
          "Penambahan kolom Barcode pada Proses Stok Opname",
        ],
      },
    ],
  },
  "1.2.4": {
    date: "2025-12-17",
    changes: [
      "UI: Perbaikan UI halaman Proses Stok Opname",
      {
        title: "Perbaikan:",
        items: [
          "Fix Detail Proses Stok Opname tidak muncul",
          "Perbaikan Perhitungan Invoice Browse",
          "Pengecualian Diskon Default untuk RETAIL",
        ],
      },
    ],
  },
  "1.2.3": {
    date: "2025-12-16",
    changes: [
      {
        title: "Perbaikan:",
        items: [
          "Fix Kolom Sisa Piutang Menyesuaikan Program Lama",
          "Fix Perhitungan Promo pada Halaman Surat Pesanan",
        ],
      },
    ],
  },
  "1.2.2": {
    date: "2025-12-16",
    changes: ["Perbaikan: Kolom Bayar Invoice menyesuaikan Program Lama"],
  },
  "1.2.1": {
    date: "2025-12-15",
    changes: [
      {
        title: "Perbaikan:",
        items: ["Barang Promo masih terhitung diskon faktur"],
      },
      {
        title: "Fitur Baru:",
        items: [
          "Filter Cabang pada Produk Top Penjualan untuk user KDC/HO",
          "Penambahan Stok Kosong Reguler",
        ],
      },
    ],
  },
  "1.2.0": {
    date: "2025-12-15",
    changes: [
      "Modul Baru: Packing List atau Pra-SJ untuk Gudang DC sebelum mengirimkan Surat Jalan ke Store",
      {
        title: "Perbaikan:",
        items: [
          "Fix Detail Hilang pada Mutasi Antar Store Kirim",
          "Fix Generate IDREC dan IDDREC pada Mutasi Antar Store Terima",
          "Fix Export Detail Proses Stok Opname",
          "Fix Setoran Lama SO Baru (Nyangkut) pada beberapa kasus",
        ],
      },
      {
        title: "Fitur Baru:",
        items: [
          "FAQ (Frequently Asked Questions) pada footer aplikasi untuk membantu pengguna terkait kebingungan yang dialami",
          "Button Input Target Bulanan untuk Manajemen",
          "Promo pada SO",
        ],
      },
    ],
  },
  "1.1.7": {
    date: "2025-12-13",
    changes: [
      "Penambahan: Pencarian pada Laporan Pareto Penjualan",
      "Perbaikan: Gagal simpan Retur Barang ke DC Duplicate Entry",
    ],
  },
  "1.1.6": {
    date: "2025-12-13",
    changes: [
      "Perbaikan: Export Detail Surat Jalan dengan Filter Tanggal dan Cabang",
    ],
  },
  "1.1.5": {
    date: "2025-12-12",
    changes: ["Perbaikan: Update SO DTF"],
  },
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
