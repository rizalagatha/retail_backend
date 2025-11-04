const dashboardService = require("../services/dashboardService");

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
    const data = await dashboardService.getTopSellingProducts(req.user);
    res.json(data);
  } catch (error) {
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
};
