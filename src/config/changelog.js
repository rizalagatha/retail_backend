const changelogs = {
  "1.3.7": {
    date: "2026-02-11",
    changes: [
      {
        title: "Pembaruan:",
        items: [
          "LHK SO DTF diubah menjadi LHK Jasa, dengan mekanisme inputan dan browse diperbarui",
          "Penambahan Customer Form pada halaman Penawaran untuk membuat Customer baru",
          "Penambahan tombol Simpan dan Jadikan SO pada halaman Penawaran",
          "Perbaikan Diskon Review Google Maps pada Surat Pesanan, melalui input Diskon % 2",
        ],
      },
    ],
  },
  "1.3.6": {
    date: "2026-02-02",
    changes: [
      "Setting Promo Kaosan Februari 2026",
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan Perhitungan Retur Jual pada Laporan Monitoring Achievement",
        ],
      },
    ],
  },
  "1.3.5": {
    date: "2026-01-28",
    changes: [
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan Halaman Refund",
          "Diskon bulanan dapat langsung diterapkan pada SO/Surat Pesanan",
          "Perbaikan bug tanggal transfer mundur",
        ],
      },
    ],
  },
  "1.3.4": {
    date: "2026-01-26",
    changes: [
      {
        title: "Pembaruan:",
        items: [
          "Halaman Penawaran dapat input DP jika customer ingin keep pembayaran dan jenis order untuk estimasi biaya custom",
          "User diwajibkan untuk mengganti password akun Retailnya tiap 3 bulan sekali, terhitung mulai hari ini",
          "Pembaruan halaman Laporan Stok Minus, kini dengan format header-detail. Penggabungan Laporan Stok Real Time dengan Laporan Kartu Stok",
          "Pembaruan halaman Laporan List Otorisasi, dengan format header-detail",
        ],
      },
      {
        title: "Penambahan:",
        items: [
          "Retur Online untuk Penjualan Online/Marketplace",
          "Retur Jual Salah Qty diubah menjadi Pengembalian",
        ],
      },
      {
        title: "Perbaikan:",
        items: ["Perbaikan halaman Cetak Barcode", ""],
      },
    ],
  },
  "1.3.3": {
    date: "2026-01-19",
    changes: [
      "Fitur BARU : Setting dan Penambahan limit sisa piutang untuk customer Prioritas atau KPR, jika sisa piutang berjalan melebihi limit saat membuat transaksi baru maka akan memerlukan Otorisasi",
      "Baru : Pembuatan FSK dibatasi satu kali per hari, karena FSK merupakan tanda closing di hari tersebut maka pastikan dahulu bahwa seluruh transaksi Invoice maupun DP dari SO sudah masuk FSK pada hari tersebut sebelum membuat FSK.",
      {
        title: "Penambahan:",
        items: [
          "Penambahan kolom dan filter Average Sale pada Halaman Laporan Dead Stock",
          "Penambahan Halaman Hitung Stok per Operator",
          "Penambahan Filter Cabang pada Peminjaman Barang",
          "Penambahan pada Lonceng Notifikasi untuk Peminjaman yang belum Pengembalian lebih dari 14 hari",
          "Penambahan kolom No Invoice pada Terima SJ untuk KPR",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "NIK belum terupdate ke kolom No HP Member setelah simpan invoice Karyawan Kencana Print",
          "Perbaikan dan penyesuaian untuk Stok Opname",
          "Perbaikan Terima STBJ, agar tidak generate otomatis nomor SJ Garmen",
          "Perbaikan format file upload SO DTF (hanya .jpg)",
          "Perbaikan untuk close SJ yang sudah di-Invoice untuk KPR",
          "Ketika membuat permintaan barang, untuk KPR harus memilih customer dulu",
          "Perbaikan diskon penawaran setelah berhasil otorisasi tereset saat dipanggil ke SO",
          "Perbaikan kategori barang belum terambil ketika load penawaran di SO",
          "Perbaikan Halaman Browse Minta Barang ke DC, karena sekarang dilewatkan ke Packing List dulu",
          "Perbaikan duplikasi cetak DP (gunakan tombol hanya halaman ganjil/genap) atau cetak melalui halaman Setoran Pembayaran",
          "Untuk user KDC sementara tidak memerlukan otorisasi saat menyimpan Peminjaman Barang",
          "Perbaikan Browse Pelunasan Invoice",
        ],
      },
    ],
  },
  "1.3.2": {
    date: "2026-01-11",
    changes: [
      {
        title: "Perbaikan:",
        items: [
          "Pengecualian untuk promo Beli 3 Harga 100 ribu, F1 tetap bisa digunakan dan bisa menambahkan barang ke tabel saat invoice",
          "Jasa Design Gambar dan Jasa Design Tulisan sudah bisa ditambahkan saat buat Penawaran",
          "Perbaikan KK POLOS PENDEK POLO LACOS CVC HITAM tidak ditemukan di Pengajuan Harga untuk jenis kaos KK POLOS KERAH PENDEK POLO LACOS CVC",
          "Perbaikan Print Penawaran untuk case tertentu",
        ],
      },
    ],
  },
  "1.3.1": {
    date: "2026-01-09",
    changes: [
      "Pencarian Barang pada Invoice tetap diadakan dengan F1 atau melalui tombol search di samping field scanner, namun hanya untuk membantu cek stok dan harga barang, bukan untuk input ke tabel. Input tetap menggunakan scan barcode",
      "Perbaikan layout cetak barcode menyesuaikan Retail Desktop, mengakomodasi cetak barcode baru untuk barcode-barcode yang buram atau sulit discan, terkait dengan wajib scan barcode saat input invoice",
    ],
  },
  "1.3.0": {
    date: "2026-01-09",
    changes: [
      "Modul Baru : Peminjaman Barang, digunakan untuk memproses dan mendata peminjaman barang ke Store, dengan tenggat waktu pengembalian 14 hari",
      "Fitur Baru : Inputan Diskon Pembulatan pada saat Pembayaran Invoice, untuk menangani kekurangan pembayaran dari customer dengan maksimal nominal Rp 500,-",
      {
        title: "Penambahan:",
        items: [
          "Setting dan Perbaikan untuk Stok Opname",
          "BARU : Invoice Penjualan Langsung pencarian barang F1/F2 dinonaktifkan, kecuali untuk KPR dan K01",
          "Pada halaman Terima SJ, qty terima disamakan dengan qty kirim khusus untuk cabang K01 karena belum ada fasilitas scanner",
          "Penambahan kolom Referensi No Inv/SJ yang menyebabkan stok minus pada Laporan Stok Minus",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Disable Hapus pada beberapa Halaman",
          "Lock Terima Surat Jalan di Web, agar Store Terima SJ lewat aplikasi Kaosan Mobile. Pengecualian sementara untuk K01 karena belum ada fasilitas scanner",
          "Perbaikan Simpan Terima STBJ untuk DC, dan tampilannya",
        ],
      },
    ],
  },
  "1.2.13": {
    date: "2026-01-06",
    changes: [
      {
        title: "Penambahan:",
        items: [
          "Setting Penjualan Online/Marketplace Online untuk K05",
          "Cetak Label Packing List DC",
          "Penambahan Filter Semua Cabang pada Packing List DC",
          "Setting untuk KPR/Prioritas, termasuk migrasi menu Biaya Kirim ke Web",
          "Penambahan Kolom Total Qty pada halaman Surat Jalan",
          "Penambahan Kolom Level pada Master Customer",
          "Wajib Input NIK dan Nama Karyawan jika customer yang dipilih adalah Karyawan Kencana Print",
        ],
      },
      {
        title: "Perbaikan:",
        items: [
          "Perbaikan Cetak Surat Jalan 1 Copy saja",
          "Perbaikan barang kategori belum terambil saat scan barang pada Surat Pesanan",
          "Perbaikan Card Promo pada Surat Pesanan",
          "Perbaikan Pending Actions bagian Penawaran belum memfilter dengan benar",
          "Perbaikan Preview Struk Kasir",
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
