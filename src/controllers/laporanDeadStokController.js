const service = require("../services/laporanDeadStokService");

const getList = async (req, res) => {
  try {
    const { minUmur, avgPeriod } = req.query;

    // 1. Validasi Umur Barang
    if (!minUmur) {
      return res
        .status(400)
        .json({ message: 'Filter "Umur (Hari)" harus diisi.' });
    }

    // 2. Set Default Periode jika tidak dikirim dari frontend
    const filters = {
      ...req.query,
      avgPeriod: parseInt(avgPeriod) || 12, // Default 1 tahun jika kosong
    };

    const data = await service.getList(filters, req.user);
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
