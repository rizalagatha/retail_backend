// src/controllers/laporanStokMinusController.js

const laporanStokMinusService = require("../services/laporanStokMinusService");

const getLaporan = async (req, res) => {
  try {
    const filters = {
      tanggal: req.query.tanggal || new Date().toISOString().split("T")[0],
      cabang: req.query.cabang,
    };
    const data = await laporanStokMinusService.getLaporanStokMinus(filters);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await laporanStokMinusService.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getLaporan,
  getCabangOptions,
};
