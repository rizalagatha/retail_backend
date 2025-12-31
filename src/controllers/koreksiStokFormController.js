const service = require("../services/koreksiStokFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user);
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
    // Gunakan flag 'isNew' dari frontend sebagai acuan utama
    const isUpdate = payload.isNew === false;

    // Ambil nomor dokumen dari dalam object header (sesuai struktur service)
    const nomorDokumen = payload.header?.nomor || payload.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header (tkor_hdr)
        const [headerRows] = await pool.query(
          "SELECT * FROM tkor_hdr WHERE kor_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail Utama (tkor_dtl)
          const [detailRows] = await pool.query(
            "SELECT * FROM tkor_dtl WHERE kord_kor_nomor = ?",
            [nomorDokumen]
          );

          // C. Ambil Detail 2 (tkor_dtl2) - Jika ada logika terkait mutasi stok
          // Asumsi tabel detail 2 juga di-handle (biasanya untuk breakdown selisih/mutasi)
          const [detail2Rows] = await pool.query(
            "SELECT * FROM tkor_dtl2 WHERE kord2_nomor = ?",
            [nomorDokumen]
          );

          // D. Gabungkan menjadi struktur data lama yang lengkap
          oldData = {
            ...header,
            items: detailRows,
            items2: detail2Rows // Opsional, sesuaikan dengan kebutuhan frontend/service
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save koreksi stok:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";
    const note = `${action === "CREATE" ? "Input" : "Edit"} Koreksi Stok (Ref: ${payload.header?.keterangan || '-'})`;

    auditService.logActivity(
      req,
      action,
      "KOREKSI_STOK",
      targetId,
      oldData, // Data Lama (Null jika Create)
      payload, // Data Baru
      note
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang, tanggal } = req.query;
    if (!kode || !ukuran || !gudang || !tanggal) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await service.getProductDetails(kode, ukuran, gudang, tanggal);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang, tanggal } = req.query;
    if (!gudang || !tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter gudang dan tanggal diperlukan." });
    }
    const data = await service.findByBarcode(barcode, gudang, tanggal);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    // Langsung teruskan semua filter dari query ke service
    const data = await service.lookupProducts(req.query);
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

module.exports = {
  getForEdit,
  save,
  getProductDetails,
  findByBarcode,
  lookupProducts,
  getPrintData,
};
