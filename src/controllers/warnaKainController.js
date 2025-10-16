const service = require("../services/warnaKainService");

const getAll = async (req, res) => {
  try {
    const data = await service.getAll();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await service.remove(decodeURIComponent(req.params.warna));
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body);
    res.status(201).json(result);
  } catch (error) {
    // Gunakan status 400 untuk error validasi dari service
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getAll, remove, save };
