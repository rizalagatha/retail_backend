const service = require("../services/pengembalianFormService");
const auditService = require("../services/auditService");
const pool = require("../config/database");

const getPinjamanData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPinjamanForReturn(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi saveReturn dengan Audit Trail Kondisional.
 * Hanya mencatat log jika pengembalian melebihi deadline (14 hari).
 */
const saveReturn = async (req, res) => {
  try {
    const payload = req.body;
    const refPinjam = payload.header?.pk_ref_pinjam;

    // 1. DETEKSI ANOMALI: Cek Deadline dari data Peminjaman asli
    let isOverdue = false;
    let deadlineDate = null;

    if (refPinjam) {
      const [loan] = await pool.query(
        "SELECT pj_deadline FROM tpeminjaman_hdr WHERE pj_nomor = ?",
        [refPinjam],
      );

      if (loan.length > 0) {
        deadlineDate = new Date(loan[0].pj_deadline);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset jam untuk perbandingan tanggal saja

        if (today > deadlineDate) {
          isOverdue = true;
        }
      }
    }

    // 2. PROSES: Simpan Data
    const result = await service.saveData(payload, req.user);

    // 3. AUDIT: Hanya catat jika pengembalian terlambat (Anomali)
    if (isOverdue) {
      auditService.logActivity(
        req,
        "ANOMALY_RETURN_OVERDUE",
        "PENGEMBALIAN_BARANG",
        result.nomor || "UNKNOWN",
        null, // Snapshot lama dihapus untuk efisiensi
        payload,
        `⚠️ PENGEMBALIAN TERLAMBAT: Melebihi batas 14 hari (Deadline: ${deadlineDate.toISOString().split("T")[0]})`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPinjamanData,
  saveReturn,
};
