const service = require("../services/hitungStokOperatorService");

const getList = async (req, res) => {
  try {
    // req.query akan berisi cabang, search, startDate, endDate
    const data = await service.getList(req.query);
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

module.exports = {
  getList,
  getCabangOptions,
};
