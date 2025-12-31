const service = require("../services/pengajuanBarcodeFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot
const fs = require("fs");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor || payload.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail 1 (Barang)
          const [detail1Rows] = await pool.query(
            "SELECT * FROM tpengajuanbarcode_dtl WHERE pcd_nomor = ? ORDER BY pcd_nourut",
            [nomorDokumen]
          );

          // C. Ambil Detail 2 (Harga)
          const [detail2Rows] = await pool.query(
            "SELECT * FROM tpengajuanbarcode_dtl2 WHERE pcd2_nomor = ? ORDER BY pcd2_nourut",
            [nomorDokumen]
          );

          // D. Gabungkan
          oldData = {
            ...header,
            itemsBarang: detail1Rows,
            itemsHarga: detail2Rows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save pengajuan barcode:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    let action = isUpdate ? "UPDATE" : "CREATE";
    let note = `${action === "CREATE" ? "Input" : "Edit"} Pengajuan Barcode`;

    if (payload.isApproved) {
      action = "APPROVE";
      note = `Approve Pengajuan Barcode (Status: ACC)`;
    }

    auditService.logActivity(
      req,
      action,
      "PENGAJUAN_BARCODE",
      targetId,
      oldData, // Data Lama (Header + 2 Details)
      payload, // Data Baru (Payload Form)
      note
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const data = await service.lookupProducts(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getJenisReject = async (req, res) => {
  try {
    const data = await service.getJenisReject();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang } = req.query;
    if (!kode || !ukuran || !gudang) {
      return res
        .status(400)
        .json({ message: "Parameter tidak lengkap (kode, ukuran, gudang)." });
    }
    const data = await service.getProductDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupStickers = async (req, res) => {
  try {
    const data = await service.lookupStickers(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForBarcodePrint = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res.status(400).json({ message: "Nomor dokumen diperlukan." });
    }
    const data = await service.getDataForBarcodePrint(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const uploadItemImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }

    const { nomor, kode, ukuran } = req.body;
    if (!nomor || !kode || !ukuran) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res
        .status(400)
        .json({ message: "Informasi item (nomor, kode, ukuran) diperlukan." });
    }

    const { imageUrl } = await service.processItemImage(
      req.file.path,
      nomor,
      kode,
      ukuran
    );

    res.status(200).json({
      success: true,
      message: "Gambar item berhasil diunggah.",
      imageUrl: imageUrl,
    });
  } catch (error) {
    console.error("UPLOAD ITEM IMAGE ERROR:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Gagal membersihkan temp file:", cleanupError);
      }
    }
    res.status(500).json({
      success: false,
      message: error.message || "Gagal mengunggah gambar item.",
    });
  }
};

const getDataForPrint = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForPrint(nomor);
    res.json(data);
  } catch (error) {
    if (error.message === "Dokumen tidak ditemukan.") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  lookupProducts,
  getJenisReject,
  getProductDetails,
  lookupStickers,
  getDataForBarcodePrint,
  uploadItemImage,
  getDataForPrint,
};
