const service = require("../services/mintaAccesoriesFormService");

const searchBarang = async (req, res) => {
  try {
    const { keyword } = req.query;
    const data = await service.searchBarangKaosan(keyword);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.loadData(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    // req.body berisi { header, items, isNew }
    const result = await service.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  searchBarang,
  loadData,
  saveData,
};
