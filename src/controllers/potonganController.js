const potonganService = require("../services/potonganService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

// --- Lookup ---
const getCabangList = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.cabang) {
      return res.status(400).json({ message: "User atau cabang tidak valid." });
    }

    const data = await potonganService.getCabangList(user);
    res.status(200).json(data);
  } catch (error) {
    console.error("getCabangList error:", error.message);
    res.status(500).json({
      message: "Gagal mengambil daftar cabang.",
      error: error.message,
    });
  }
};

// --- List utama ---
const getPotonganList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
    };

    const data = await potonganService.getList(filters);
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Gagal mengambil daftar potongan.",
      error: error.message,
    });
  }
};

// === FUNGSI BARU UNTUK EXPANDED ROW ===
const getBrowseDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await potonganService.getBrowseDetails(nomor);
    res.status(200).json(data);
  } catch (error) {
    console.error("getBrowseDetails error:", error.message);
    res.status(500).json({
      message: "Gagal mengambil detail browse potongan.",
      error: error.message,
    });
  }
};

// --- Detail (Untuk Halaman Edit) ---
const getPotonganDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await potonganService.getDetails(nomor);
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Gagal mengambil detail potongan." });
  }
};

// --- Simpan (insert/update) ---
// [AUDIT TRAIL DITERAPKAN DI SINI]
const savePotongan = async (req, res) => {
  try {
    const data = req.body;
    const user = req.user;

    // 1. DETEKSI: Apakah ini Update?
    // Gunakan flag 'isEdit' dari frontend
    const isUpdate = data.isEdit === true;
    const nomorDokumen = data.header?.pt_nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // Tabel: tpotongan_hdr, PK: pt_nomor
        const [rows] = await pool.query(
          "SELECT * FROM tpotongan_hdr WHERE pt_nomor = ?",
          [nomorDokumen]
        );
        if (rows.length > 0) oldData = rows[0];
      } catch (e) {
        console.warn("Gagal snapshot oldData save potongan:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await potonganService.save(data, user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "POTONGAN",
      targetId,
      oldData, // Data Lama (Null jika Create)
      data, // Data Baru
      `${action === "CREATE" ? "Input" : "Edit"} Potongan Piutang (Rp ${
        data.header.pt_nominal
      })`
    );

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
};

// --- Hapus ---
// [AUDIT TRAIL DITERAPKAN DI SINI]
const deletePotongan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tpotongan_hdr WHERE pt_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan ptd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tpotongan_dtl WHERE ptd_nomor = ? ORDER BY ptd_inv", // Order by inv
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData delete potongan:", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await potonganService.remove(nomor, user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "POTONGAN",          // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Potongan Piutang (Customer: ${oldData.pt_cus_kode || "Unknown"})`
      );
    }

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
};

// --- Export ---
const exportPotonganHeaders = async (req, res) => {
  try {
    const data = await potonganService.getExportHeaders(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportPotonganDetails = async (req, res) => {
  try {
    const data = await potonganService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCabangList,
  getPotonganList,
  getBrowseDetails,
  getPotonganDetails,
  savePotongan,
  deletePotongan,
  exportPotonganHeaders,
  exportPotonganDetails,
};
