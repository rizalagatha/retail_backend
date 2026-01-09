const service = require("../services/peminjamanFormService");
const auditService = require("../services/auditService");
const pool = require("../config/database");

const lookupProductByBarcode = async (req, res) => {
  try {
    const { barcode, cabang } = req.query;
    const result = await service.lookupProductByBarcode(barcode, cabang);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL APPLIED HERE]
const saveData = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETECT: Apakah ini Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.pj_nomor || payload.pj_nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika ini adalah Update (Header + Detail)
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header Peminjaman
        const [headerRows] = await pool.query(
          "SELECT * FROM tpeminjaman_hdr WHERE pj_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail Peminjaman (pjd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tpeminjaman_dtl WHERE pjd_nomor = ?",
            [nomorDokumen]
          );

          // C. Gabungkan untuk disimpan di log audit
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData peminjaman:", e.message);
      }
    }

    // 3. PROCESS: Jalankan fungsi simpan di service
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat aktivitas ke database audit
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "PEMINJAMAN_BARANG",
      targetId,
      oldData, // Data sebelum diedit
      payload, // Data yang dikirim (Payload baru)
      `${action === "CREATE" ? "Input" : "Edit"} Peminjaman Barang (PIC: ${payload.header?.pj_nama})`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    // req.query akan berisi { term, gudang, category, page, itemsPerPage }
    const result = await service.lookupProducts(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    console.error("Error Get Print Data PK:", error);
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  lookupProductByBarcode,
  saveData,
  lookupProducts,
  getPrintData,
};
