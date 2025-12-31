const service = require("../services/qckeGarmenFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getGudangOptions = async (req, res) => {
  try {
    const data = await service.getGudangOptions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const data = await service.getDataForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveData = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    const isUpdate = payload.isEdit === true;
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tdc_qc_hdr WHERE mut_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail 1
          const [detail1Rows] = await pool.query(
            "SELECT * FROM tdc_qc_dtl WHERE mutd_nomor = ? ORDER BY mutd_kode",
            [nomorDokumen]
          );

          // C. Ambil Detail 2
          const [detail2Rows] = await pool.query(
            "SELECT * FROM tdc_qc_dtl2 WHERE mutd_nomor = ? ORDER BY mutd_kode",
            [nomorDokumen]
          );

          // D. Gabungkan
          oldData = {
            ...header,
            items: detail1Rows,
            itemsHistory: detail2Rows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save QC:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "QC_GARMEN",
      targetId,
      oldData, // Data Lama (Header + 2 Details)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} QC Garmen`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getBarangLookup = async (req, res) => {
  try {
    const data = await service.getBarangLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getVarianBarang = async (req, res) => {
  try {
    const { kodeBarang } = req.query;
    if (!kodeBarang)
      return res.status(400).json({ message: "Kode Barang diperlukan." });
    const data = await service.getVarianBarang(kodeBarang, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductByBarcodeGrid1 = async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode)
      return res.status(400).json({ message: "Barcode diperlukan." });
    const data = await service.getProductByBarcodeGrid1(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getProductByBarcodeGrid2 = async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode)
      return res.status(400).json({ message: "Barcode diperlukan." });
    const data = await service.getProductByBarcodeGrid2(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getGudangOptions,
  getDataForEdit,
  saveData,
  getBarangLookup,
  getVarianBarang,
  getProductByBarcodeGrid1,
  getProductByBarcodeGrid2,
  getPrintData,
};
