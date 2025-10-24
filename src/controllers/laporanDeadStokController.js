const service = require("../services/laporanDeadStokService");

const getList = async (req, res) => {
  try {
    // Tambahkan validasi filter
    if (!req.query.minUmur) {
      return res
        .status(400)
        .json({ message: 'Filter "Umur (Hari)" harus diisi.' });
    }
    const data = await service.getList(req.query, req.user);
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
