const service = require("../services/returDcFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadAllStock = async (req, res) => {
  try {
    const data = await service.loadAllStock(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
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
          "SELECT * FROM trbdc_hdr WHERE rb_nomor = ?",
          [nomorDokumen],
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan rbd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM trbdc_dtl WHERE rbd_nomor = ? ORDER BY rbd_kode",
            [nomorDokumen],
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows,
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save retur DC:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "RETUR_DC",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Retur DC`,
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const data = await service.getProductDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    const data = await service.findByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupGudangDc = async (req, res) => {
  try {
    const data = await service.lookupGudangDc(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupReturJualKON = async (req, res) => {
  try {
    // Fungsi ini memanggil service untuk mencari RJ Online di cabang KON
    const data = await service.lookupReturJualKON(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadFromRJ = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getItemsFromReturJual(nomor, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  loadAllStock,
  getForEdit,
  save,
  getProductDetails,
  findByBarcode,
  lookupGudangDc,
  getPrintData,
  lookupReturJualKON,
  loadFromRJ,
};
