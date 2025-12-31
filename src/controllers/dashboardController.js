const { get } = require("../routes/invoiceFormRoutes");
const dashboardService = require("../services/dashboardService");
const changelogs = require("../config/changelog");

const getTodayStats = async (req, res) => {
  try {
    // Memanggil service untuk mendapatkan statistik hari ini
    const data = await dashboardService.getTodayStats(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getTodayStats controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getSalesChartData = async (req, res) => {
  try {
    // Memanggil service untuk mendapatkan data grafik
    const data = await dashboardService.getSalesChartData(req.query, req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getSalesChartData controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await dashboardService.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRecentTransactions = async (req, res) => {
  try {
    const data = await dashboardService.getRecentTransactions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPendingActions = async (req, res) => {
  try {
    const data = await dashboardService.getPendingActions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getTopSellingProducts = async (req, res) => {
  try {
    // Ambil parameter cabang dari URL (misal: /dashboard/top-products?cabang=K01)
    const branchFilter = req.query.cabang || "";

    // Kirim user dan filter cabang ke service
    const data = await dashboardService.getTopSellingProducts(
      req.user,
      branchFilter
    );

    res.json(data);
  } catch (error) {
    console.error("Error getTopSellingProducts:", error);
    res.status(500).json({ message: error.message });
  }
};

const getSalesTargetSummary = async (req, res) => {
  try {
    const data = await dashboardService.getSalesTargetSummary(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getSalesTargetSummary controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getBranchPerformance = async (req, res) => {
  try {
    const data = await dashboardService.getBranchPerformance(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getBranchPerformance controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getStagnantStockSummary = async (req, res) => {
  try {
    const data = await dashboardService.getStagnantStockSummary(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getStagnantStockSummary controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getTotalSisaPiutang = async (req, res) => {
  try {
    const data = await dashboardService.getTotalSisaPiutang(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPiutangPerCabang = async (req, res) => {
  try {
    const data = await dashboardService.getPiutangPerCabang(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPiutangPerInvoice = async (req, res) => {
  try {
    const data = await dashboardService.getPiutangPerInvoice(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getPiutangPerInvoice controller:", error);
    res
      .status(500)
      .json({ message: "Gagal mengambil data breakdown invoice." });
  }
};

const getTotalStok = async (req, res) => {
  try {
    const data = await dashboardService.getTotalStock(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getTotalStok controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getTotalStokPerCabang = async (req, res) => {
  try {
    const data = await dashboardService.getStockPerCabang(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getTotalStokPerCabang controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getItemSalesTrend = async (req, res) => {
  try {
    const data = await dashboardService.getItemSalesTrend(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Gagal memuat trend barang." });
  }
};

const getAppChangelog = async (req, res) => {
  try {
    const formattedLog = Object.entries(changelogs).map(([version, data]) => {
      // Cek Format: Apakah 'data' itu Array (format lama) atau Object (format baru)?
      const isNewFormat = !Array.isArray(data);

      return {
        version: version,
        // Jika format baru, ambil .date. Jika lama, set strip '-'
        date: isNewFormat ? data.date : "-",

        // Jika format baru, ambil .changes. Jika lama, ambil data langsung
        changes: isNewFormat ? data.changes : data,

        // Logika pewarnaan tipe update
        type: version.endsWith(".0") ? "major" : "patch",
      };
    });

    // Urutkan dari versi terbaru ke terlama
    formattedLog.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true })
    );

    res.json(formattedLog);
  } catch (error) {
    console.error("Error in getAppChangelog controller:", error);
    res.status(500).json({ message: "Gagal memuat riwayat update." });
  }
};

const getStockAlerts = async (req, res) => {
  try {
    const data = await dashboardService.getStockAlerts(req.user);
    res.json(data);
  } catch (error) {
    console.error("Error getting stock alerts:", error);
    res.status(500).json({ message: "Gagal mengambil data notifikasi stok." });
  }
};

const getStokKosong = async (req, res) => {
  try {
    const searchTerm = req.query.q || "";
    // Get the 'cabang' parameter from the URL query string (e.g., ?q=kaos&cabang=K01)
    const targetCabang = req.query.cabang || "";

    const items = await dashboardService.getStokKosongReguler(
      req.user,
      searchTerm,
      targetCabang
    );

    res.json({
      success: true,
      data: items,
      total: items.length,
    });
  } catch (error) {
    console.error("Error getStokKosong:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getParetoStockHealth = async (req, res) => {
  try {
    // Panggil Service
    await dashboardService.getParetoStockHealth(req, res);
  } catch (error) {
    // [LOGGING LENGKAP]
    console.error("🔥 [ERROR DASHBOARD] getParetoStockHealth Failed:");
    console.error("------------------------------------------------");
    console.error("Message :", error.message);
    console.error("SQL     :", error.sql); // Menampilkan query yang bermasalah (jika ada)
    console.error("Stack   :", error.stack);
    console.error("------------------------------------------------");

    // Jangan kirim error mentah ke frontend untuk keamanan, kirim pesan umum
    if (!res.headersSent) {
      res.status(500).json({
        message:
          "Gagal memuat data kesehatan stok. Cek log server untuk detail.",
      });
    }
  }
};

const getParetoDetails = async (req, res) => {
  try {
    // Memanggil service yang menangani req, res langsung (sesuai kode service sebelumnya)
    await dashboardService.getParetoDetails(req, res);
  } catch (error) {
    console.error("Error getParetoDetails:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Gagal mengambil detail pareto" });
    }
  }
};

module.exports = {
  getTodayStats,
  getSalesChartData,
  getCabangOptions,
  getRecentTransactions,
  getPendingActions,
  getTopSellingProducts,
  getSalesTargetSummary,
  getBranchPerformance,
  getStagnantStockSummary,
  getTotalSisaPiutang,
  getPiutangPerCabang,
  getPiutangPerInvoice,
  getTotalStok,
  getTotalStokPerCabang,
  getItemSalesTrend,
  getAppChangelog,
  getStockAlerts,
  getStokKosong,
  getParetoStockHealth,
  getParetoDetails,
};
