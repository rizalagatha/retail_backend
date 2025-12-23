const laporanStokService = require("../services/laporanStokService");

const getRealTimeStock = async (req, res) => {
  try {
    const filters = {
      gudang: req.query.gudang,
      kodeBarang: req.query.kodeBarang,
      jenisStok: req.query.jenisStok,
      tampilkanKosong: req.query.tampilkanKosong === "true",
      tanggal: req.query.tanggal,
    };

    if (!filters.gudang || !filters.tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter gudang dan tanggal diperlukan." });
    }

    const data = await laporanStokService.getRealTimeStock(filters);
    res.json(data);
  } catch (error) {
    console.error("Error in getRealTimeStock controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getGudangOptions = async (req, res) => {
  try {
    const data = await laporanStokService.getGudangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLowStock = async (req, res) => {
  try {
    const filters = {
      gudang: req.user.cabang, // Ambil cabang dari user yang login
    };
    // Panggil fungsi service yang baru
    const data = await laporanStokService.getLowStock(filters);
    res.json(data);
  } catch (error) {
    console.error("Error in getLowStock controller:", error);
    res.status(500).json({ message: error.message });
  }
};

const getRealTimeStockExport = async (req, res) => {
  try {
    const data = await laporanStokService.getRealTimeStockExport(req.query);
    res.json(data);
  } catch (error) {
    console.error("Error export real time stock:", error);
    res.status(500).json({ message: "Gagal mengambil data export." });
  }
};

module.exports = {
  getRealTimeStock,
  getGudangOptions,
  getLowStock,
  getRealTimeStockExport,
};
