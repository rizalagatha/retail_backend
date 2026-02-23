const service = require("../services/priceListService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const data = await service.getDetails(req.params.kode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const updatePrices = async (req, res) => {
  try {
    const payload = req.body; // { kode: "...", variants: [...] }
    const { kode } = payload;

    // 1. SNAPSHOT: Ambil harga lama sebelum diupdate
    // Kita ambil semua varian dari kode tersebut untuk perbandingan
    let oldData = null;
    try {
      const [rows] = await pool.query(
        "SELECT brgd_kode, brgd_ukuran, brgd_hpp, brgd_harga FROM tbarangdc_dtl WHERE brgd_kode = ?",
        [kode],
      );
      if (rows.length > 0) oldData = rows;
    } catch (e) {
      console.warn("Gagal snapshot oldData price update:", e.message);
    }

    // 2. PROSES: Update Harga
    const result = await service.updatePrices(payload);

    // 3. AUDIT: Catat Log
    // Kita simpan oldData (Array harga lama) dan newData (Array harga baru dari payload)
    if (oldData) {
      auditService.logActivity(
        req,
        "UPDATE", // Action
        "PRICE_LIST", // Module
        kode, // Target ID (Kode Barang)
        oldData, // Data Lama (List Harga per ukuran)
        payload.variants, // Data Baru (List Harga baru yang dikirim user)
        `Update Harga/HPP Barang: ${kode}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getExportData = async (req, res) => {
  try {
    // Mengambil filter (kategori, search, hargaKosong) dari query string
    const data = await service.getExportData(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  updatePrices,
  getExportData,
};
