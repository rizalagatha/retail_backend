const service = require("../services/pesananOnlineFormService");

const savePesanan = async (req, res) => {
  try {
    const payload = req.body;
    const user = req.user; // Dari middleware auth

    // Validasi Sederhana
    if (!payload.sourceGudang) {
      return res.status(400).json({ message: "Gudang sumber belum dipilih." });
    }
    if (!payload.items || payload.items.length === 0) {
      return res.status(400).json({ message: "Tidak ada item barang." });
    }
    if (!payload.mpInfo?.noPesanan) {
      return res.status(400).json({ message: "Nomor Pesanan wajib diisi." });
    }
    if (!payload.mpInfo?.customerKode) {
      return res.status(400).json({ message: "Kode Customer tidak valid." });
    }

    const result = await service.savePesanan(payload, user);
    res.json(result);
  } catch (error) {
    console.error("Error savePesanan:", error);
    res
      .status(500)
      .json({ message: error.message || "Terjadi kesalahan server." });
  }
};

// [BARU] GET Gudang Options
const getGudangOptions = async (req, res) => {
  try {
    const list = await service.getSourceGudangList();
    res.json(list);
  } catch (error) {
    console.error("Error getGudangOptions:", error);
    res.status(500).json({ message: "Gagal memuat data gudang." });
  }
};

// [BARU] Endpoint Cek Stok
const checkStock = async (req, res) => {
  try {
    const { gudang, items } = req.body; // Expect JSON body

    if (!gudang || !items) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }

    const stockData = await service.checkStock(gudang, items);
    res.json(stockData);
  } catch (error) {
    console.error("Error checkStock:", error);
    res.status(500).json({ message: "Gagal mengecek stok." });
  }
};

module.exports = {
  savePesanan,
  getGudangOptions, // <-- Export
  checkStock,
};
