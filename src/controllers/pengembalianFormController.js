const service = require("../services/pengembalianFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getPinjamanData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPinjamanForReturn(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL APPLIED HERE]
const saveReturn = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETECT: Apakah ini Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.pk_nomor || payload.pk_nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika ini adalah Update (Header + Detail)
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header Pengembalian
        const [headerRows] = await pool.query(
          "SELECT * FROM tpengembalian_hdr WHERE pk_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail Pengembalian (pkd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tpengembalian_dtl WHERE pkd_nomor = ?",
            [nomorDokumen]
          );

          // C. Gabungkan untuk data audit
          oldData = {
            ...header,
            items: detailRows,
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData pengembalian:", e.message);
      }
    }

    // 3. PROCESS: Jalankan fungsi simpan di service
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat aktivitas
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "PENGEMBALIAN_BARANG",
      targetId,
      oldData, // Data lama (null jika CREATE)
      payload, // Data baru
      `${
        action === "CREATE" ? "Input" : "Edit"
      } Pengembalian Barang (Ref Pinjam: ${payload.header?.pk_ref_pinjam})`
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPinjamanData,
  saveReturn,
};
