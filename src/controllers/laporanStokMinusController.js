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

/**
 * [TAMBAHAN] Mengambil detail histori transaksi per barang
 * Digunakan untuk pengelompokan detail berdasarkan size
 */
const getDetails = async (req, res) => {
  try {
    const { kode, cabang, tanggal } = req.query;
    // Memanggil service getDetailStokMinus dengan parameter yang sesuai
    const data = await laporanStokMinusService.getDetailStokMinus(
      kode,
      cabang,
      tanggal,
    );
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
  getDetails, // Export fungsi baru
  getCabangOptions,
};
