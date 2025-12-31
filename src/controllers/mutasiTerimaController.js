const service = require("../services/mutasiTerimaService");
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
    const { nomor } = req.params;
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const cancelReceipt = async (req, res) => {
  try {
    // 'nomor' di sini adalah nomor PENGIRIMAN (msk_nomor)
    const { nomor } = req.params;

    // 1. SNAPSHOT: Cari data Penerimaan (mst_nomor) yang akan dihapus
    let oldData = null;
    let nomorTerima = null;

    try {
      // Langkah A: Cari tahu dulu nomor terimanya apa dari tabel Pengiriman (tmsk_hdr)
      const [mskRows] = await pool.query(
        "SELECT msk_noterima FROM tmsk_hdr WHERE msk_nomor = ?",
        [nomor]
      );

      if (mskRows.length > 0 && mskRows[0].msk_noterima) {
        nomorTerima = mskRows[0].msk_noterima;

        // Langkah B: Ambil data Header Penerimaan (tmst_hdr)
        const [mstRows] = await pool.query(
          "SELECT * FROM tmst_hdr WHERE mst_nomor = ?",
          [nomorTerima]
        );

        if (mstRows.length > 0) {
          const header = mstRows[0];

          // Langkah C: Ambil Detail Penerimaan (tmst_dtl)
          const [detailRows] = await pool.query(
            "SELECT * FROM tmst_dtl WHERE mstd_nomor = ? ORDER BY mstd_kode", // Gunakan mstd_nomor
            [nomorTerima]
          );

          // Langkah D: Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData cancel receipt mutasi terima:", e.message);
    }

    // 2. PROSES: Jalankan service cancel
    const result = await service.cancelReceipt(nomor, req.user);

    // 3. AUDIT: Catat penghapusan dokumen terima
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action (Batal Terima = Hapus Dokumen Terima)
        "MUTASI_TERIMA",     // Module
        nomorTerima,         // Target ID adalah Nomor Terima (mst_nomor)
        oldData,             // Data Lama (Header + Items)
        { linked_shipment: nomor }, // New Value (Info link ke pengiriman asal)
        `Membatalkan Penerimaan Barang (Ref Kirim: ${nomor})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  exportDetails,
};
