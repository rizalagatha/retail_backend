const reportService = require("../services/pettyCashReportService");

const getReport = async (req, res) => {
  try {
    const data = await reportService.getMutasiReport(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await reportService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getReport, getCabangList };
