const service = require("../services/stokOpnameSettingService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const setDate = async (req, res) => {
  try {
    const { tanggal } = req.body;
    if (!tanggal) {
      return res.status(400).json({ message: "Tanggal harus diisi." });
    }
    const result = await service.setDate(tanggal, req.user);
    res.status(201).json(result);
  } catch (error) {
    // Gunakan status 409 (Conflict) untuk error validasi "sudah ada"
    res.status(409).json({ message: error.message });
  }
};

const deleteDate = async (req, res) => {
  try {
    const { tanggal } = req.params;
    const result = await service.deleteDate(tanggal, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  setDate,
  deleteDate,
};
