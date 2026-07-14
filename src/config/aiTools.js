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
  "Rentang waktu relatif. Gunakan 'custom' + startDate/endDate (format YYYY-MM-DD) jika user menyebut tanggal spesifik.";

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
  return namaMatches.length === 1 ? namaMatches[0].kode : null;
};

// [BARU] Alias manual untuk nama kota/panggilan umum yang TIDAK bisa
// dicocokkan otomatis dari kolom gdg_nama/gdg_inv_kota — karena ada
// brand berbeda yang kebetulan di kota sama (RESZO SBY vs KAOSAN SBY,
// keduanya "Surabaya"), matching otomatis via kota jadi ambigu.
// Tambah manual di sini kalau nemu kasus baru yang serupa.
const CABANG_ALIAS = {
  SURABAYA: "K05", // KAOSAN SBY — RESZO SBY (K04) beda brand, sengaja tidak dialiaskan
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

  // [FIX] Kalau user sebut LEBIH DARI 1 bulan berbeda (pertanyaan
  // perbandingan), JANGAN paksa override — biarkan model isi period='custom'
  // sendiri per tool call, supaya masing-masing panggilan bisa dapat bulan
  // yang berbeda. Override cuma aman dipakai kalau cuma 1 bulan disebut.
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

// [BARU] Pemetaan kata kunci -> tool relevan. Dipakai buat NARROWING skema
// tool yang dikirim ke Groq (bukan pengganti tool-calling) — soalnya kirim
// 16 skema tool sekaligus tiap request itu SENDIRIAN udah kelebihan kuota
// 6000 token/menit di free tier (1 request bisa >6600 token). Model tetap
// yang mutusin argumen & eksekusi tool dari daftar yang sudah dipersempit ini.
const TOOL_KEYWORDS = {
  get_today_sales: [
    "penjualan hari ini",
    "omset hari ini",
    "omzet hari ini",
    "jual hari ini",
  ],
  get_sales_chart: [
    "penjualan",
    "omset",
    "omzet",
    "kemarin",
    "minggu lalu",
    "minggu ini",
    "bulan lalu",
    "bulan ini",
    "grafik",
    "trend",
  ],
  get_top_selling_products: [
    "laris",
    "terlaris",
    "top produk",
    "top barang",
    "best seller",
    "paling laku",
  ],
  get_total_stock: ["total stok", "stok total", "berapa stok semua"],
  get_stock_breakdown_per_branch: [
    "stok per cabang",
    "stok tiap cabang",
    "stok semua cabang",
    "stok masing",
  ],
  get_stok_kosong: ["stok kosong", "kosong", "habis"],
  get_stok_kosong_fast_moving: ["fast moving"],
  get_real_stock: [
    "stok real",
    "stok riil",
    "berapa stok",
    "sisa stok",
    "stok barang",
    "stok combed",
  ],
  get_piutang_total: ["piutang", "tagihan", "nunggak", "utang"],
  get_piutang_per_cabang: [
    "piutang cabang",
    "piutang per cabang",
    "piutang tiap cabang",
  ],
  get_piutang_customer_summary: [
    "piutang customer",
    "customer piutang",
    "siapa yang",
    "pelanggan piutang",
    "terbanyak",
  ],
  get_sales_target: ["target"],
  get_branch_performance: [
    "performa",
    "ranking cabang",
    "peringkat cabang",
    "cabang terbaik",
    "cabang terbagus",
  ],
  get_stagnant_stock_value: ["stagnan"],
  get_dead_stock_summary: ["dead stock", "mati", "tidak bergerak"],
  get_cashflow_summary: ["laba", "rugi", "cashflow", "kas"],
  get_shipment_schedules: [
    "kirim",
    "pengiriman",
    "jadwal kirim",
    "surat jalan",
  ],
  get_agenda_dateline: ["deadline", "dateline", "jatuh tempo"],
};

// Kalau tidak ada keyword yang cocok sama sekali, jatuh ke set default ini
// (topik paling sering ditanyakan) — daripada kirim semua 16 tool.
const DEFAULT_FALLBACK_TOOLS = [
  "get_today_sales",
  "get_stok_kosong",
  "get_real_stock",
  "get_piutang_total",
  "get_top_selling_products",
];

const MAX_TOOLS_PER_REQUEST = 6;

const selectRelevantTools = (rawText, availableNames) => {
  const textLower = (rawText || "").toLowerCase();
  const matched = availableNames.filter((name) => {
    const keywords = TOOL_KEYWORDS[name] || [];
    return keywords.some((kw) => textLower.includes(kw));
  });

  let selected =
    matched.length > 0
      ? matched
      : DEFAULT_FALLBACK_TOOLS.filter((n) => availableNames.includes(n));

  if (selected.length === 0) selected = availableNames; // last resort

  return selected.slice(0, MAX_TOOLS_PER_REQUEST);
};

// --- Bangun daftar tool + eksekutornya, disesuaikan konteks user yang bertanya ---
const buildTools = (user, cabangOptions, rawQuestion = "") => {
  const cabangOverride = resolveCabangFromText(rawQuestion, cabangOptions);
  const monthOverride = resolveMonthOverride(rawQuestion);
  const cabangEnum = cabangOptions.map((c) => c.kode);
  // [SINGKAT] Daftar kode+nama cabang sudah ada di system prompt (1x),
  // jadi di sini cukup instruksi singkat — hemat token krusial karena
  // deskripsi ini di-reuse di banyak tool tiap request.
  const cabangDesc =
    "Kode cabang. WAJIB dikosongkan kecuali user secara EKSPLISIT menyebut nama/kode cabang tertentu di kalimatnya. JANGAN diisi otomatis dengan cabang milik user yang sedang login — pertanyaan umum tanpa sebutan cabang berarti mencakup SEMUA cabang, bukan cabang user sendiri.";

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
              enum: PERIOD_ENUM,
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
    {
      type: "function",
      function: {
        name: "get_top_selling_products",
        description:
          "Ambil daftar barang paling laris (terjual terbanyak). Default bulan ini, bisa juga rentang tanggal custom. Default menampilkan 10 barang teratas, sesuaikan parameter limit kalau user minta jumlah spesifik (mis. 'top 5', 'top 20').",
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
          "Ambil total stok (pcs) di rak untuk cabang user yang login, atau total semua cabang jika user Pusat (KDC).",
        parameters: { type: "object", properties: {}, required: [] },
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
          "Cek stok REAL (jumlah pcs saat ini) untuk barang tertentu, boleh difilter cabang. Gunakan ini untuk pertanyaan seperti 'stok combed 24s hitam di boyolali berapa', 'berapa stok barang X'. Kata kunci pencarian barang WAJIB diisi.",
        parameters: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description:
                "Kata kunci nama barang, WAJIB diisi. Nama barang Kaosan tersusun tetap: {JenisKaos} {Tipe} {Lengan} {JenisKain} {Warna} — contoh: 'KO POLOS PENDEK COMBED 24S HITAM'. Susun kata kunci mengikuti urutan ini.",
            },
            cabang: {
              type: "string",
              enum: [...cabangEnum, "ALL"],
              description: cabangDesc,
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
          "Ambil pencapaian target penjualan bulan berjalan (nominal realisasi vs target) untuk cabang user yang login, atau total semua cabang jika KDC.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_branch_performance",
        description:
          "Ambil ranking performa (omset, target, pencapaian %) semua cabang untuk periode tertentu. Default bulan berjalan. Bisa juga periode lain (mis. 'minggu lalu') — untuk periode bukan bulan penuh, ranking OMSET tetap akurat, tapi persentase pencapaian memakai target bulanan (bukan diprorata). Hanya untuk user Pusat (KDC).",
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
      const { period, startDate, endDate, limit } = args;
      const branchFilter = cabang && cabang !== "ALL" ? cabang : "";

      let dateRange = null;
      if (monthOverride) {
        // [FIX] Nama bulan disebut eksplisit — menang mutlak, apapun period
        // yang dipilih model.
        dateRange = {
          startDate: monthOverride.startDate,
          endDate: monthOverride.endDate,
        };
        args.monthLabel = monthOverride.label; // dipakai formatter buat label jawaban
      } else if (period && period !== "this_month") {
        dateRange = resolveDateRange(period, startDate, endDate);
      }

      const data = await dashboardService.getTopSellingProducts(
        user,
        branchFilter,
        dateRange,
      );
      const safeLimit = Math.min(30, Math.max(1, Number(limit) || 10));
      return data.slice(0, safeLimit);
    },

    get_total_stock: async () => dashboardService.getTotalStock(user),

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
      const { search } = args;
      const result = await dashboardService.getStokKosongReguler(
        user,
        search || "",
        cabang || "",
        false,
        1,
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
      const result = await dashboardService.getRealStockList(user, {
        cabang: cabang || "ALL",
        search: args.search || "",
        page: 1,
        limit: 15,
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

    get_sales_target: async () => dashboardService.getSalesTargetSummary(user),

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
  };

  const filteredTools = tools.filter((t) =>
    ENABLED_TOOLS.includes(t.function.name),
  );
  const filteredExecutors = Object.fromEntries(
    Object.entries(executors).filter(([name]) => ENABLED_TOOLS.includes(name)),
  );

  // [BARU] Persempit lagi jadi maksimal 6 tool paling relevan berdasarkan
  // kata kunci di pertanyaan — executors TETAP lengkap (nggak makan token,
  // cuma dipakai internal), yang dikecilkan cuma skema tool yang beneran
  // dikirim ke Groq.
  const relevantNames = selectRelevantTools(
    rawQuestion,
    filteredTools.map((t) => t.function.name),
  );
  const finalTools = filteredTools.filter((t) =>
    relevantNames.includes(t.function.name),
  );

  return { tools: finalTools, executors: filteredExecutors };
};

module.exports = { buildTools, resolveDateRange };
