const service = require("../services/klerekService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const prosesKlerek = async (req, res) => {
  try {
    const { items, cabang } = req.body;
    const result = await service.prosesKlerek(items, cabang, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
  prosesKlerek,
  getCabangOptions,
};
