const lhkSoDtfFormService = require("../services/lhkSoDtfFormService");
const { remove } = require("./returDcController");

const loadData = async (req, res) => {
  try {
    const { tanggal, cabang } = req.params;
    const data = await lhkSoDtfFormService.loadData(tanggal, cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSoPo = async (req, res) => {
  try {
    // 1. Ambil 'tipe' dari query string
    const { term, cabang, tipe } = req.query;

    if (!cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }

    // 2. Teruskan 'tipe' sebagai argumen ketiga ke service
    const data = await lhkSoDtfFormService.searchSoPo(term, cabang, tipe);

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await lhkSoDtfFormService.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const removeData = async (req, res) => {
  try {
    const { tanggal, cabang } = req.params;
    const result = await lhkSoDtfFormService.removeData(tanggal, cabang);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  loadData,
  searchSoPo,
  saveData,
  removeData,
};
