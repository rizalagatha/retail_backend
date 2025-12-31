const service = require("../services/mutasiKirimFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    if (error.message === "Dokumen tidak ditemukan") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    // Menggunakan logika payload.nomor ada dan bukan "AUTO"
    const isUpdate = payload.nomor && payload.nomor !== "AUTO";
    
    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tmsk_hdr WHERE msk_nomor = ?",
          [payload.nomor]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan mskd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tmsk_dtl WHERE mskd_nomor = ? ORDER BY mskd_kode",
            [payload.nomor]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save mutasi kirim:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || payload.nomor || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "MUTASI_KIRIM",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Pengiriman Barang (Mutasi Out)`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupTujuanStore = async (req, res) => {
  try {
    const data = await service.lookupTujuanStore(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang } = req.query;
    if (!kode || !ukuran || !gudang) {
      return res.status(400).json({ message: "Parameter tidak lengkap" });
    }
    const data = await service.getProductDetails(kode, ukuran, gudang);
    res.json(data);
  } catch (error) {
    if (error.message === "Detail produk tidak ditemukan") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res, next) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    if (!gudang) throw new Error("Parameter gudang diperlukan"); // Disederhanakan error throw-nya
    const data = await service.findByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    // Sesuaikan handling error agar konsisten (pakai next atau res.json)
    if (res.headersSent) return next(error);
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res, next) => {
  try {
    const data = await service.getPrintData(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    if (res.headersSent) return next(error);
    res.status(500).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const gudang = req.user.cabang;
    if (!gudang) {
      return res.status(400).json({ message: "Gudang asal tidak ditemukan." });
    }
    const data = await service.lookupProductsForMutasiKirim(gudang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  lookupTujuanStore,
  getProductDetails,
  findByBarcode,
  getPrintData,
  lookupProducts,
};
