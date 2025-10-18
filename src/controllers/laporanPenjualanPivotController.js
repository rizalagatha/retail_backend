const service = require("../services/laporanPenjualanPivotService");

const getSalesData = async (req, res) => {
  try {
    const data = await service.getSalesData(req.query, req.user);
    res.json(data);
  } catch (error) {
    console.error("Error in getSalesData controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getChartData = async (req, res) => {
  try {
    const data = await service.getChartData(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getSalesData,
  getChartData,
};
