const service = require("../services/monitoringAchievementService");

const getData = async (req, res) => {
  try {
    const { reportType, ...filters } = req.query;

    let data;
    switch (reportType) {
      case "daily":
        data = await service.getDailyData(filters);
        break;
      case "weekly":
        data = await service.getWeeklyData(filters);
        break;
      case "monthly":
        data = await service.getMonthlyData(filters);
        break;
      case "ytd":
        data = await service.getYtdData(filters);
        break;
      default:
        return res.status(400).json({ message: "Jenis laporan tidak valid." });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveTarget = async (req, res) => {
  try {
    const result = await service.saveTarget(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getData,
  getCabangOptions,
  saveTarget,
};
