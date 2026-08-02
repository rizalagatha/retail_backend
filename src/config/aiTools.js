const dashboardService = require("../services/dashboardService");
const {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
} = require("date-fns");

const ENABLED_TOOLS = [
  "get_today_sales",
  "get_sales_chart",
  "get_top_selling_products",
  "get_total_stock",
  "get_stock_breakdown_per_branch",
  "get_stok_kosong",
  "get_stok_kosong_fast_moving",
  "get_real_stock",
  "get_piutang_total",
  "get_piutang_per_cabang",
  "get_piutang_customer_summary",
  "get_sales_target",
  "get_branch_performance",
  "get_stagnant_stock_value",
  "get_dead_stock_summary",
  "get_cashflow_summary",
  "get_shipment_schedules",
  "get_agenda_dateline",
  "get_seasonal_sales",
];

// --- Resolusi rentang tanggal relatif -> tanggal aktual ---
// Supaya model kecil tidak perlu hitung tanggal sendiri, cukup pilih kata kunci.
const resolveDateRange = (period, startDate, endDate) => {
  const today = new Date();
  const fmt = (d) => format(d, "yyyy-MM-dd");

  switch (period) {
    case "today":
      return { startDate: fmt(today), endDate: fmt(today) };
    case "yesterday": {
      const y = subDays(today, 1);
      return { startDate: fmt(y), endDate: fmt(y) };
    }
    case "this_week":
      return {
        startDate: fmt(startOfWeek(today, { weekStartsOn: 1 })),
        endDate: fmt(today),
      };
    case "last_week": {
      const lastWeekDate = subWeeks(today, 1);
      return {
        startDate: fmt(startOfWeek(lastWeekDate, { weekStartsOn: 1 })),
        endDate: fmt(endOfWeek(lastWeekDate, { weekStartsOn: 1 })),
      };
    }
    case "this_month":
      return { startDate: fmt(startOfMonth(today)), endDate: fmt(today) };
    case "last_month": {
      const lastMonthDate = subMonths(today, 1);
      return {
        startDate: fmt(startOfMonth(lastMonthDate)),
        endDate: fmt(endOfMonth(lastMonthDate)),
      };
    }
    case "last_7_days":
      return { startDate: fmt(subDays(today, 6)), endDate: fmt(today) };
    case "last_30_days":
      return { startDate: fmt(subDays(today, 29)), endDate: fmt(today) };
    case "custom":
      if (!startDate || !endDate) {
        throw new Error(
          "startDate dan endDate wajib diisi untuk period 'custom'.",
        );
      }
      return { startDate, endDate };
    default:
      return { startDate: fmt(today), endDate: fmt(today) };
  }
};

const PERIOD_ENUM = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "custom",
];
const PERIOD_DESC =
  "Rentang waktu relatif. WAJIB HANYA memilih dari opsi enum yang tersedia. JANGAN PERNAH mengarang nilai baru (seperti 'last_3_days' atau 'last_5_days'). Jika user meminta rentang waktu yang tidak ada di daftar (misal '5 hari terakhir' atau '3 hari lalu'), WAJIB pilih 'custom' dan isi startDate/endDate secukupnya (sistem akan otomatis mengoreksi akurasi tanggalnya nanti).";

// [BARU] Cocokkan nama cabang dari kalimat ASLI user secara deterministik
// (substring match), bukan mengandalkan model 3B memilih dari daftar enum
// panjang — model kecil kadang salah pilih kode cabang yang mirip.
const resolveCabangFromText = (rawText, cabangOptions) => {
  if (!rawText) return null;

  // Alias manual dicek duluan (lebih presisi, sengaja hardcode untuk kasus ambigu)
  const aliasHit = resolveCabangAlias(rawText);
  if (aliasHit) return aliasHit;

  const textUp = rawText.toUpperCase();

  // [FIX] Cek KODE cabang eksplisit dulu ("cabang K03") — sebelumnya cuma
  // dicek by nama ("MENCO"), jadi "K03" nggak pernah ke-match sendiri dan
  // model harus nebak dari 12 pilihan enum tanpa bantuan override.
  const kodeMatches = cabangOptions.filter((c) => {
    if (!c.kode) return false;
    const re = new RegExp(`\\b${c.kode.toUpperCase()}\\b`);
    return re.test(textUp);
  });
  if (kodeMatches.length === 1) return kodeMatches[0].kode;

  const namaMatches = cabangOptions.filter(
    (c) => c.nama && c.nama.length > 2 && textUp.includes(c.nama.toUpperCase()),
  );

  // Jika cuma 1 yang cocok, langsung pakai
  if (namaMatches.length === 1) {
    return namaMatches[0].kode;
  }

  // --- TAMBAHAN BARU ---
  // Jika ada lebih dari 1 cabang dengan nama yang mirip (misal K06 dan W01 sama-sama ada kata Boyolali),
  // prioritaskan cabang reguler/toko (kode berawalan "K").
  if (namaMatches.length > 1) {
    const tokoOnly = namaMatches.filter(
      (c) => c.kode && c.kode.startsWith("K"),
    );
    if (tokoOnly.length === 1) {
      return tokoOnly[0].kode;
    }
  }

  return null;
};

// [BARU] Alias manual untuk nama kota/panggilan umum yang TIDAK bisa
// dicocokkan otomatis dari kolom gdg_nama/gdg_inv_kota — karena ada
// brand berbeda yang kebetulan di kota sama (RESZO SBY vs KAOSAN SBY,
// keduanya "Surabaya"), matching otomatis via kota jadi ambigu.
// Tambah manual di sini kalau nemu kasus baru yang serupa.
const CABANG_ALIAS = {
  SURABAYA: "K05",
  BOYOLALI: "K06",
};

const resolveCabangAlias = (rawText) => {
  if (!rawText) return null;
  const textUp = rawText.toUpperCase();
  const found = Object.keys(CABANG_ALIAS).find((alias) =>
    textUp.includes(alias),
  );
  return found ? CABANG_ALIAS[found] : null;
};

// [BARU] Deteksi nama bulan Indonesia dari kalimat asli, secara deterministik
// — model kecil nggak reliable itung tanggal sendiri, dan skema PERIOD_ENUM
// yang ada cuma kata kunci relatif (this_month dst), tidak ada opsi
// "bulan spesifik". Kalau ketemu, override total period/startDate/endDate
// yang dikirim model, apapun yang dia pilih.
const BULAN_NAMA = [
  "januari",
  "februari",
  "maret",
  "april",
  "mei",
  "juni",
  "juli",
  "agustus",
  "september",
  "oktober",
  "november",
  "desember",
];

const resolveMonthOverride = (rawText) => {
  if (!rawText) return null;
  const textLower = rawText.toLowerCase();

  // [FIX CUSTOM DATE] Jika user menyebut tanggal/angka spesifik (misal: "tanggal 1", "1 dan 5"),
  // matikan override! Biarkan Claude yang mengisi startDate & endDate secara mandiri.
  if (textLower.match(/(tanggal|tgl)\s*\d+/)) return null;
  if (textLower.match(/\b\d{1,2}\b\s*(dan|sampai|s\/d|-|s\.d)\s*\b\d{1,2}\b/))
    return null;

  const distinctMonthsFound = BULAN_NAMA.filter((nama) =>
    textLower.includes(nama),
  );
  if (distinctMonthsFound.length > 1) return null;

  for (let i = 0; i < BULAN_NAMA.length; i++) {
    const nama = BULAN_NAMA[i];
    const idx = textLower.indexOf(nama);
    if (idx === -1) continue;

    // Cari tahun 4 digit di dekat kata bulan (opsional, mis. "januari 2025")
    const nearText = textLower.slice(idx, idx + nama.length + 10);
    const yearMatch = nearText.match(/\d{4}/);
    const now = new Date();
    let year = yearMatch ? parseInt(yearMatch[0], 10) : now.getFullYear();

    // Tanpa tahun eksplisit: kalau bulan itu belum terjadi tahun ini,
    // asumsikan maksudnya tahun lalu (bulan terdekat yang sudah lewat).
    if (!yearMatch && i > now.getMonth()) {
      year -= 1;
    }

    const start = new Date(year, i, 1);
    const end = new Date(year, i + 1, 0);
    const fmt = (d) => format(d, "yyyy-MM-dd");
    const namaKapital = nama.charAt(0).toUpperCase() + nama.slice(1);

    return {
      startDate: fmt(start),
      endDate: fmt(end),
      label: `${namaKapital} ${year}`,
    };
  }
  return null;
};

// [BARU] Deteksi pola "N hari/minggu/bulan (yang) lalu" dari kalimat asli
// — enum PERIOD_ENUM cuma punya kata kunci tetap (yesterday, last_week,
// dst), tidak ada opsi angka bebas. Tanpa ini, model kepaksa "mengarang"
// value yang tidak ada di enum ("last_2_weeks") dan Groq menolak validasi,
// atau model salah pilih opsi terdekat yang tersedia.
const relativeUnitToDays = { hari: 1, minggu: 7, bulan: 30 };

const resolveRelativeOverride = (rawText) => {
  if (!rawText) return null;
  const textLower = rawText.toLowerCase();

  // [UPDATE] Tambahkan deteksi kata "terakhir" di regex
  const match = textLower.match(
    /(\d+)\s*(hari|minggu|bulan)\s*(yang\s+)?(lalu|terakhir)/,
  );
  if (!match) return null;

  const n = parseInt(match[1], 10);
  const unit = match[2];
  const tipe = match[4]; // menangkap kata "lalu" atau "terakhir"
  if (!n || n <= 0) return null;

  const daysPerUnit = relativeUnitToDays[unit];
  const now = new Date();
  const fmt = (d) => format(d, "yyyy-MM-dd");

  // Jika "hari" dan user bilang "lalu" (misal: "5 hari lalu"), ambil 1 HARI SPESIFIK tersebut
  if (unit === "hari" && tipe === "lalu") {
    const target = subDays(now, n);
    return {
      startDate: fmt(target),
      endDate: fmt(target),
      label: `${n} hari lalu`,
    };
  }

  // Jika "terakhir" (misal: "5 hari terakhir"), atau menggunakan unit minggu/bulan, jadikan RENTANG/RANGE
  const totalDays = n * daysPerUnit;
  const start = subDays(now, totalDays - 1); // dikurangi 1 agar rentangnya pas N hari termasuk hari ini

  return {
    startDate: fmt(start),
    endDate: fmt(now),
    label: `${n} ${unit} ${tipe}`, // otomatis menjadi "5 hari terakhir" dsb.
  };
};

// --- Bangun daftar tool + eksekutornya, disesuaikan konteks user yang bertanya ---
const buildTools = (
  user,
  cabangOptions,
  rawQuestion = "",
  activeTool = null,
) => {
  const cabangOverride = resolveCabangFromText(rawQuestion, cabangOptions);
  // Nama bulan spesifik ("Januari") menang lebih dulu; kalau tidak ada,
  // baru cek pola relatif ("2 minggu lalu").
  const monthOverride =
    resolveMonthOverride(rawQuestion) || resolveRelativeOverride(rawQuestion);
  const cabangEnum = cabangOptions.map((c) => c.kode);
  // [SINGKAT] Daftar kode+nama cabang sudah ada di system prompt (1x),
  // jadi di sini cukup instruksi singkat — hemat token krusial karena
  // deskripsi ini di-reuse di banyak tool tiap request.
  const cabangDesc =
    "Kode cabang. Dikosongkan secara default, KECUALI user menyebut cabang tertentu, ATAU jika melanjutkan konteks cabang dari pertanyaan sebelumnya. JANGAN diisi otomatis dengan cabang user yang login jika tidak diminta.";

  const tools = [
    {
      type: "function",
      function: {
        name: "get_today_sales",
        description:
          "Ambil TOTAL penjualan (omset), qty terjual, dan jumlah transaksi HARI INI. Bisa difilter ke 1 cabang tertentu lewat parameter cabang (khusus berguna untuk user Pusat/KDC). Kalau cabang dikosongkan dan user KDC, hasilnya gabungan semua cabang plus rincian top 3 cabang.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: cabangEnum,
              description: cabangDesc,
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_sales_chart",
        description:
          "Ambil total nominal penjualan pada rentang waktu tertentu. Cocok untuk pertanyaan seperti 'penjualan minggu lalu', 'omset bulan ini', atau 'penjualan tanggal 1 sampai 10 Juli'. JUGA dipakai untuk 'penjualan HARI INI per cabang tertentu' — gunakan period='today' + isi parameter cabang.",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description: PERIOD_DESC,
            },
            startDate: {
              type: "string",
              description: "Wajib jika period='custom'. Format YYYY-MM-DD.",
            },
            endDate: {
              type: "string",
              description: "Wajib jika period='custom'. Format YYYY-MM-DD.",
            },
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
            groupBy: {
              type: "string",
              enum: ["day", "week", "month"],
              description: "Cara pengelompokan data. Default 'day'.",
            },
          },
          required: ["period"],
        },
      },
    },
    // di dalam tools array, definisi get_top_selling_products
    {
      type: "function",
      function: {
        name: "get_top_selling_products",
        description:
          "Ambil daftar barang paling laris (terjual terbanyak). Default bulan ini, bisa juga rentang tanggal custom. Default menampilkan 10 barang teratas, sesuaikan parameter limit kalau user minta jumlah spesifik (mis. 'top 5', 'top 20'). Gunakan parameter search kalau user minta laris untuk KATEGORI/JENIS/WARNA barang tertentu (mis. 'warna hitam paling laris apa', 'combed 24s paling laris'), TERMASUK kalau kategori itu disebut di pesan SEBELUMNYA dalam percakapan ini dan pertanyaan sekarang jelas melanjutkan konteks itu.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
            period: {
              type: "string",
              enum: PERIOD_ENUM,
              description: `${PERIOD_DESC} Default 'this_month'.`,
            },
            startDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
            endDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
            limit: {
              type: "number",
              description:
                "Jumlah barang yang ditampilkan. Default 10 kalau tidak disebut user. Maksimal 30.",
            },
            // [BARU]
            search: {
              type: "string",
              description:
                "Kata kunci filter nama barang. Susunan standar: {JenisKaos} {Tipe} {Lengan} {JenisKain} {Warna}. Contoh oblong: 'KO POLOS PENDEK COMBED 24S HITAM'. Contoh polo/kerah: 'KK POLOS PENDEK POLO LACOS CVC'. PENTING: Jangan paksa awalan 'KO' jika user mencari 'polo'. Jangan ubah 'polo' jadi 'polos'. Cukup ekstrak berurutan, misal 'POLO LACOS CVC HITAM'. ATURAN PENGECUALIAN: KOSONGKAN parameter ini jika kata kunci tersebut dimaksudkan untuk DITOLAK (diawali 'selain', 'kecuali', 'tanpa'). JANGAN pernah memasukkan kata yang ditolak (seperti 'kecuali dtf' atau 'selain combed 24s') ke parameter ini, gunakan parameter 'exclude' untuk itu.",
            },
            exclude: {
              type: "string",
              description:
                "Kata kunci barang yang TIDAK BOLEH disertakan. Isi parameter ini JIKA DAN HANYA JIKA user menggunakan kata 'kecuali', 'selain', atau 'tanpa'. Contoh: jika kalimatnya 'selain combed 24s', maka isi parameter ini HANYA dengan 'combed 24s' (sedangkan parameter search biarkan kosong jika tidak ada kriteria pencarian lain).",
            },
            page: {
              type: "number",
              description:
                "Nomor halaman untuk melihat data selanjutnya. Default 1. PENTING: Jika user meminta 'lagi', 'tambah', 'selanjutnya', atau 'berikutnya' dari list sebelumnya, WAJIB naikkan angka ini (misal dari 1 menjadi 2, lalu 3, dst) dan PERTAHANKAN parameter pencarian sebelumnya.",
            },
          },
          required: ["period"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_total_stock",
        description:
          "Ambil total stok (pcs) di rak. Bisa difilter ke 1 cabang spesifik lewat parameter cabang (khusus berguna untuk user Pusat/KDC). Kalau cabang dikosongkan, hasilnya total cabang user sendiri, atau gabungan semua cabang jika KDC.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: cabangEnum,
              description: cabangDesc,
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stock_breakdown_per_branch",
        description:
          "Ambil rincian total stok per cabang (semua cabang sekaligus). Hanya berguna untuk user Pusat (KDC).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stok_kosong",
        description:
          "Cari barang kategori REGULER yang stoknya 0/habis di toko. Bisa difilter cabang dan/atau kata kunci nama barang.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description:
                cabangDesc +
                " Gunakan 'ALL' untuk cek semua cabang sekaligus (khusus KDC).",
            },
            search: {
              type: "string",
              description:
                "Kata kunci nama barang, opsional. PENTING: nama barang Kaosan selalu tersusun dengan urutan tetap: {JenisKaos} {Tipe} {Lengan} {JenisKain} {Warna} — contoh: 'KO POLOS PENDEK COMBED 30S MARUN'. Susun kata kunci pencarian mengikuti urutan ini (bukan urutan sesuai kalimat user), dan boleh pakai sebagian saja (mis. hanya 'COMBED 30S MARUN') asalkan urutan relatifnya tetap benar.",
            },
            page: {
              type: "number",
              description:
                "Nomor halaman untuk melihat data selanjutnya. Default 1. PENTING: Jika user meminta 'lagi', 'tambah', 'selanjutnya', atau 'berikutnya' dari list sebelumnya, WAJIB naikkan angka ini (misal dari 1 menjadi 2, lalu 3, dst) dan PERTAHANKAN parameter pencarian sebelumnya.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stok_kosong_fast_moving",
        description:
          "Cari barang FAST MOVING (baru diterima toko dalam 6 bulan terakhir) yang sekarang stoknya 0/habis — indikasi barang laris yang butuh restock segera.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_real_stock",
        description:
          "Cek stok REAL (jumlah pcs saat ini) untuk barang tertentu, boleh difilter cabang dan/atau ukuran spesifik. Gunakan ini untuk pertanyaan seperti 'stok combed 24s hitam di boyolali berapa', 'berapa stok barang X ukuran L'. Kata kunci pencarian barang WAJIB diisi.",
        parameters: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description:
                "Kata kunci pencarian nama barang, WAJIB diisi. Susunan standar: {JenisKaos} {Tipe} {Lengan} {JenisKain} {Warna}. Contoh oblong: 'KO POLOS PENDEK COMBED 24S HITAM'. Contoh polo/kerah: 'KK POLOS PENDEK POLO LACOS CVC'. PENTING: Jangan paksa awalan 'KO' jika user mencari 'polo' dan jangan ubah 'polo' jadi 'polos'. JANGAN masukkan ukuran (S/M/L/XL/dst) ke sini — ukuran punya parameter sendiri. PENTING UNTUK FOLLOW-UP: Jika user memfilter lanjutan (misal 'selain putih'), kamu WAJIB MEMPERTAHANKAN kata kunci dari pertanyaan sebelumnya (misal 'katun air') di parameter ini. JANGAN dikosongkan jika ada konteks sebelumnya. Jangan pernah memasukkan kata 'selain', 'kecuali', atau 'tanpa' ke parameter ini.",
            },
            exclude: {
              type: "string",
              description:
                "Kata kunci barang yang TIDAK BOLEH disertakan. Isi jika user menggunakan kata 'kecuali', 'selain', atau 'tanpa' (misal: 'putih').",
            },
            ukuran: {
              type: "string",
              description:
                "Ukuran spesifik jika disebut user (mis. 'XL', '2XL', 'M'). Kosongkan jika user tidak sebut ukuran tertentu (tampilkan semua ukuran).",
            },
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
            page: {
              type: "number",
              description:
                "Nomor halaman untuk melihat data selanjutnya. Default 1. PENTING: Jika user meminta 'lagi', 'tambah', 'selanjutnya', atau 'berikutnya' dari list sebelumnya, WAJIB naikkan angka ini (misal dari 1 menjadi 2, lalu 3, dst) dan PERTAHANKAN parameter pencarian sebelumnya.",
            },
          },
          required: ["search"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_piutang_total",
        description:
          "Ambil total sisa piutang (tagihan belum lunas) untuk cabang user yang login, atau total semua cabang jika KDC.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_piutang_per_cabang",
        description:
          "Ambil rincian sisa piutang per cabang/channel. Bisa difilter ke 1 cabang/channel spesifik (mis. 'PRIORITAS', 'KAOSAN ONLINE', atau kode toko). Hanya mengembalikan data untuk user Pusat (KDC).",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_piutang_customer_summary",
        description:
          "Ambil ringkasan piutang per CUSTOMER (bukan per cabang) — diagregasi dari semua invoice yang masih punya sisa piutang, diurutkan dari yang piutangnya terbesar. Cocok untuk pertanyaan seperti 'customer dengan piutang terbanyak' atau 'siapa yang paling banyak nunggak'.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
            limit: {
              type: "number",
              description:
                "Jumlah customer ditampilkan. Default 10, maksimal 30.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_sales_target",
        description:
          "Ambil pencapaian target penjualan (nominal realisasi vs target). Default bulan berjalan, cabang user yang login (atau total semua cabang jika KDC). Bisa difilter cabang dan/atau periode spesifik (mis. 'target Jember Januari 2026').",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: cabangEnum,
              description: cabangDesc,
            },
            period: {
              type: "string",
              enum: PERIOD_ENUM,
              description: `${PERIOD_DESC} Default 'this_month'.`,
            },
            startDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
            endDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_branch_performance",
        description:
          "HANYA gunakan tool ini jika user SECARA EKSPLISIT menanyakan 'ranking', 'performa', 'target', atau 'achievement'. JANGAN PERNAH gunakan tool ini jika user sedang mencari atau melakukan follow-up tentang 'barang terlaris', 'penjualan', atau 'stok'.",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: PERIOD_ENUM,
              description: `${PERIOD_DESC} Default 'this_month'.`,
            },
            startDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
            endDate: {
              type: "string",
              description: "Wajib jika period='custom'.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stagnant_stock_value",
        description:
          "Ambil total nilai (Rupiah) stok yang tidak terjual dalam 30 hari terakhir (stok stagnan/tidak bergerak).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_dead_stock_summary",
        description:
          "Ambil ringkasan klasifikasi stok berdasarkan usia: Fast Moving (<=6bln), Standar (6bln-1thn), Slow Moving (1-2thn), Dead Stock (>2thn), lengkap qty dan nilai Rupiah tiap kategori.",
        parameters: {
          type: "object",
          properties: {
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_cashflow_summary",
        description:
          "Ambil ringkasan laba-rugi harian (omset, HPP, laba kotor, biaya operasional, laba bersih, kas riil diterima) untuk cabang user yang login, atau semua cabang non-KDC jika user Pusat. Default tanggal kemarin.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Tanggal spesifik format YYYY-MM-DD. Kosongkan untuk data kemarin.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_shipment_schedules",
        description:
          "Ambil jadwal & status pengiriman barang (surat jalan) ke toko-toko terbaru.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_agenda_dateline",
        description:
          "Ambil daftar deadline (dateline) Surat Pesanan (SO) dan SPK Produksi yang belum selesai, diurutkan dari yang paling dekat deadline-nya.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_seasonal_sales",
        description:
          "Ambil laporan penjualan khusus barang-barang NEW ARRIVAL atau SEASONAL.",
        parameters: {
          type: "object",
          properties: {
            cabang: { type: "string", enum: [...cabangEnum, "ALL"] },
            period: { type: "string", enum: ["1w", "2w", "1m", "2m"] },
            // [FIX] Tambahkan 2 parameter ini:
            page: {
              type: "number",
              description:
                "Nomor halaman. Default 1. WAJIB naikkan angka ini menjadi 2, 3, dst jika user minta 'lagi', '10 barang lainnya', atau 'berikutnya'.",
            },
            limit: {
              type: "number",
              description: "Jumlah data. Default 10.",
            },
          },
          required: [],
        },
      },
    },
  ];

  // --- Eksekutor: banyak fungsi dashboardService SUDAH self-scoping
  // (cek user.cabang === "KDC" sendiri di dalam), jadi cukup teruskan argumen apa adanya.
  const executors = {
    get_today_sales: async (args) => {
      const cabang = cabangOverride || args.cabang;
      return dashboardService.getTodayStats(user, cabang || null);
    },

    get_sales_chart: async (args) => {
      const cabang = cabangOverride || args.cabang;
      const { period, startDate, endDate, groupBy = "day" } = args;

      let range;
      if (monthOverride) {
        range = {
          startDate: monthOverride.startDate,
          endDate: monthOverride.endDate,
        };
        args.monthLabel = monthOverride.label;
      } else {
        range = resolveDateRange(period, startDate, endDate);
      }

      const filters = { ...range, cabang: cabang || "ALL", groupBy };
      return dashboardService.getSalesChartData(filters, user);
    },

    get_top_selling_products: async (args) => {
      const cabang = cabangOverride || args.cabang;
      const { period, startDate, endDate, limit, search, exclude, page } = args;
      const branchFilter = cabang && cabang !== "ALL" ? cabang : "";

      let dateRange = null;
      if (monthOverride) {
        dateRange = {
          startDate: monthOverride.startDate,
          endDate: monthOverride.endDate,
        };
        args.monthLabel = monthOverride.label;
      } else if (period && period !== "this_month") {
        dateRange = resolveDateRange(period, startDate, endDate);
      }

      const data = await dashboardService.getTopSellingProducts(
        user,
        branchFilter,
        dateRange,
        search || "",
        exclude || "",
      );

      // --- LOGIKA PAGINATION MANUAL ---
      const pageNum = Number(page) || 1;
      const limitNum = Math.min(30, Math.max(1, Number(limit) || 10));
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;

      return data.slice(startIndex, endIndex);
    },

    get_total_stock: async (args) => {
      const cabang = cabangOverride || args.cabang;

      // [BARU] Kalau cabang spesifik disebut, ambil dari breakdown per
      // cabang (getStockPerCabang) dan filter — getTotalStock sendiri
      // tidak punya parameter cabang sama sekali.
      if (cabang) {
        if (user.cabang !== "KDC" && cabang !== user.cabang) {
          return {
            message: "Anda hanya bisa melihat data stok cabang sendiri.",
          };
        }
        const breakdown = await dashboardService.getStockPerCabang();
        const found = breakdown.find((r) => r.kode_cabang === cabang);
        return {
          totalStock: found ? found.totalStock : 0,
          cabangSpecific: true,
          cabangKode: cabang,
          cabangNama: found ? found.nama_cabang : cabang,
        };
      }

      return dashboardService.getTotalStock(user);
    },

    // Fungsi ini TIDAK menerima param user & tidak self-scoping — jadi wajib
    // di-gate manual di sini supaya user store tidak bisa lihat data cabang lain.
    get_stock_breakdown_per_branch: async () => {
      if (user.cabang !== "KDC") {
        return { message: "Fitur ini hanya tersedia untuk user Pusat (KDC)." };
      }
      return dashboardService.getStockPerCabang();
    },

    get_stok_kosong: async (args) => {
      const cabang = cabangOverride || args.cabang;
      const targetCabang = cabang || (user.cabang !== "KDC" ? user.cabang : "");
      const { search, page } = args;

      const pageNum = Number(page) || 1;

      const result = await dashboardService.getStokKosongReguler(
        user,
        search || "",
        targetCabang,
        false,
        pageNum,
        10,
      );
      return result.data;
    },

    get_stok_kosong_fast_moving: async (args) => {
      const cabang = cabangOverride || args.cabang;
      return dashboardService.getStokKosongFastMoving(user, {
        cabang: cabang || "ALL",
        page: 1,
        limit: 10,
      });
    },

    get_real_stock: async (args) => {
      const cabang = cabangOverride || args.cabang;
      const { search, exclude, ukuran, page } = args;

      const pageNum = Number(page) || 1;

      const result = await dashboardService.getRealStockList(user, {
        cabang: cabang || "ALL",
        search: search || "",
        exclude: exclude || "",
        ukuran: ukuran || "",
        page: pageNum,
        limit: 10,
      });
      return result;
    },

    get_piutang_total: async () => dashboardService.getTotalSisaPiutang(user),

    get_piutang_per_cabang: async (args) => {
      const cabang = cabangOverride || args.cabang;
      return dashboardService.getPiutangPerCabang(user, cabang || null);
    },

    // [BARU] Agregasi per customer dari data invoice — tidak ada tabel
    // "per customer" tersendiri, jadi dihitung ulang di sini dari
    // getPiutangPerInvoice (satu customer bisa punya beberapa invoice).
    get_piutang_customer_summary: async (args) => {
      const cabang = cabangOverride || args.cabang;
      const rows = await dashboardService.getPiutangPerInvoice(
        user,
        cabang || "ALL",
      );

      const map = new Map();
      for (const r of rows) {
        const name = r.customer_nama || "UMUM";
        if (!map.has(name)) {
          map.set(name, {
            customer_nama: name,
            total_piutang: 0,
            jumlah_invoice: 0,
          });
        }
        const item = map.get(name);
        item.total_piutang += Number(r.sisa_piutang) || 0;
        item.jumlah_invoice += 1;
      }

      const list = Array.from(map.values()).sort(
        (a, b) => b.total_piutang - a.total_piutang,
      );
      const safeLimit = Math.min(30, Math.max(1, Number(args.limit) || 10));
      return list.slice(0, safeLimit);
    },

    get_sales_target: async (args) => {
      const cabang = cabangOverride || args.cabang;

      let dateRange = null;
      if (monthOverride) {
        dateRange = {
          startDate: monthOverride.startDate,
          endDate: monthOverride.endDate,
        };
        args.monthLabel = monthOverride.label;
      } else if (args.period && args.period !== "this_month") {
        dateRange = resolveDateRange(args.period, args.startDate, args.endDate);
      }

      return dashboardService.getSalesTargetSummary(
        user,
        cabang || null,
        dateRange,
      );
    },

    get_branch_performance: async (args) => {
      let dateRange = null;
      if (monthOverride) {
        dateRange = {
          startDate: monthOverride.startDate,
          endDate: monthOverride.endDate,
        };
        args.monthLabel = monthOverride.label;
      } else if (args.period && args.period !== "this_month") {
        dateRange = resolveDateRange(args.period, args.startDate, args.endDate);
      }
      return dashboardService.getBranchPerformance(user, dateRange);
    },

    get_stagnant_stock_value: async () =>
      dashboardService.getStagnantStockSummary(user),

    get_dead_stock_summary: async (args) =>
      dashboardService.getDeadStockSummary(user, {
        cabang: args.cabang || "ALL",
      }),

    get_cashflow_summary: async (args) =>
      dashboardService.getCashflowSummary(user, args.date || null),

    get_shipment_schedules: async () => {
      const data = await dashboardService.getShipmentSchedules(user);
      return data.slice(0, 15);
    },

    get_agenda_dateline: async () => {
      const data = await dashboardService.getAgendaDateline(user);
      return data.slice(0, 15);
    },

    get_seasonal_sales: async (args) => {
      const cabang = cabangOverride || args.cabang;
      return dashboardService.getSeasonalSales(user, {
        cabang: cabang || "ALL",
        period: args.period || "1m",
        page: args.page || 1, // Teruskan page
        limit: args.limit || 10, // Teruskan limit
      });
    },
  };

  const filteredTools = tools.filter((t) =>
    ENABLED_TOOLS.includes(t.function.name),
  );
  const filteredExecutors = Object.fromEntries(
    Object.entries(executors).filter(([name]) => ENABLED_TOOLS.includes(name)),
  );

  // [REMOVED] Narrowing TF-IDF dihapus. Dulu wajib ada untuk hemat kuota
  // 6000 token/menit Groq free tier, tapi sudah tidak relevan di Claude API
  // dan terbukti riskan salah skor (kata umum seperti "semua"/"cabang" bisa
  // menang skor dibanding tool yang benar-benar relevan, contoh kasus:
  // "penjualan bulan Agustus, semua cabang" -> get_sales_chart ke-skip
  // karena "semua"+"cabang" match ke get_total_stock/get_piutang_per_cabang).
  // Sekarang SEMUA tool yang ENABLED dikirim tiap request tanpa filter.
  return { tools: filteredTools, executors: filteredExecutors };
};

module.exports = { buildTools, resolveDateRange };
