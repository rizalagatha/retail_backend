const service = require("../services/cekSelisihService");

const getList = async (req, res) => {
  try {
    if (!req.query.cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }
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
