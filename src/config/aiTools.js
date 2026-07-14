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

// Tool yang aktif dulu (mode hemat, karena Ollama jalan CPU-only).
// Nambah/kurangi tinggal edit array ini — semua definisi tool tetap ada di bawah,
// cuma yang namanya ada di sini yang benar-benar dikirim ke model.
const ENABLED_TOOLS = [
  "get_today_sales",
  "get_top_selling_products",
  "get_stok_kosong",
  "get_stok_kosong_fast_moving",
  "get_piutang_total",
  "get_sales_target",
  "get_branch_performance",
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

// --- Bangun daftar tool + eksekutornya, disesuaikan konteks user yang bertanya ---
const buildTools = (user, cabangOptions) => {
  const cabangEnum = cabangOptions.map((c) => c.kode);
  const cabangDesc = `Kode cabang. Pilihan: ${cabangOptions
    .map((c) => `${c.kode} (${c.nama})`)
    .join(", ")}. Kosongkan jika user tidak sebut cabang tertentu.`;

  const tools = [
    {
      type: "function",
      function: {
        name: "get_today_sales",
        description:
          "Ambil data penjualan (omset), qty terjual, dan jumlah transaksi HARI INI. Untuk user Pusat (KDC), hasil termasuk rincian top cabang.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_sales_chart",
        description:
          "Ambil total nominal penjualan pada rentang waktu tertentu. Cocok untuk pertanyaan seperti 'penjualan minggu lalu', 'omset bulan ini', atau 'penjualan tanggal 1 sampai 10 Juli'.",
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
          "Ambil daftar barang paling laris (terjual terbanyak). Default bulan ini, bisa juga rentang tanggal custom.",
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
          },
          required: [],
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
              description: "Kata kunci nama/kode barang, opsional.",
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
          "Ambil rincian sisa piutang per cabang. Hanya mengembalikan data untuk user Pusat (KDC).",
        parameters: { type: "object", properties: {}, required: [] },
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
          "Ambil ranking performa (omset, target, pencapaian %) semua cabang bulan ini. Hanya mengembalikan data untuk user Pusat (KDC).",
        parameters: { type: "object", properties: {}, required: [] },
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
    get_today_sales: async () => dashboardService.getTodayStats(user),

    get_sales_chart: async (args) => {
      const { period, startDate, endDate, cabang, groupBy = "day" } = args;
      const range = resolveDateRange(period, startDate, endDate);
      const filters = { ...range, cabang: cabang || "ALL", groupBy };
      return dashboardService.getSalesChartData(filters, user);
    },

    get_top_selling_products: async (args) => {
      const { cabang, period, startDate, endDate } = args;
      const branchFilter = cabang && cabang !== "ALL" ? cabang : "";
      const dateRange =
        period && period !== "this_month"
          ? resolveDateRange(period, startDate, endDate)
          : null;
      const data = await dashboardService.getTopSellingProducts(
        user,
        branchFilter,
        dateRange,
      );
      return data.slice(0, 10);
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
      const { cabang, search } = args;
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
      const { cabang } = args;
      return dashboardService.getStokKosongFastMoving(user, {
        cabang: cabang || "ALL",
        page: 1,
        limit: 10,
      });
    },

    get_piutang_total: async () => dashboardService.getTotalSisaPiutang(user),

    get_piutang_per_cabang: async () =>
      dashboardService.getPiutangPerCabang(user),

    get_sales_target: async () => dashboardService.getSalesTargetSummary(user),

    get_branch_performance: async () =>
      dashboardService.getBranchPerformance(user),

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

  return { tools: filteredTools, executors: filteredExecutors };
};

module.exports = { buildTools, resolveDateRange };
