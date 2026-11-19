const service = require("../services/proformaFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getDataFromSO = async (req, res) => {
  try {
    const { soNumber } = req.params;
    const { branchCode } = req.query;
    if (!soNumber || !branchCode) {
      return res
        .status(400)
        .json({ message: "Nomor SO dan kode cabang diperlukan." });
    }
    const data = await service.getDataFromSO(soNumber, branchCode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataFromInvoice = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res.status(400).json({ message: "Nomor Invoice diperlukan." });
    }
    // Cabang dari user login, bukan dari query
    const data = await service.getDataFromInvoice(nomor, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupInvoice = async (req, res) => {
  try {
    const result = await service.lookupInvoice(req.user.cabang);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveNew = async (req, res) => {
  try {
    const payload = req.body;

    // 1. PROSES: Simpan Baru
    const result = await service.saveData(payload, req.user);

    // 2. AUDIT: Catat Log Create
    const targetId = result.nomor || "UNKNOWN";
    const refSO = payload.header?.nomorSo || "-";
    const refInv = payload.header?.refInvoice;

    auditService.logActivity(
      req,
      "CREATE",
      "PROFORMA_INVOICE",
      targetId,
      null, // Old Data (Null karena Create)
      payload, // New Data (Payload Form sudah lengkap Header + Items)
      `Input Proforma Baru (Ref SO: ${refSO}${refInv ? `, Ref Invoice: ${refInv}` : ""})`,
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const updateExisting = async (req, res) => {
  try {
    const nomorDokumen = req.params.id;
    const payload = {
      header: { ...req.body.header, nomor: nomorDokumen },
      items: req.body.items,
    };

    // 1. SNAPSHOT: Ambil data lama LENGKAP jika Update
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
        [nomorDokumen],
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan invd_inv_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tinv_dtl WHERE invd_inv_nomor = ? ORDER BY invd_nourut",
          [nomorDokumen],
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows,
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData update proforma:", e.message);
    }

    // 2. PROSES: Update Data
    const result = await service.saveData(payload, req.user);

    // 3. AUDIT: Catat Log Update
    auditService.logActivity(
      req,
      "UPDATE",
      "PROFORMA_INVOICE",
      nomorDokumen,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `Update Proforma Invoice`,
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupSO = async (req, res) => {
  try {
    const result = await service.lookupSO(req.query);
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
    res.status(404).json({ message: error.message });
  }
};

// Status yang boleh dicetak. '' = proforma lama sebelum fitur ACC.
const STATUS_BOLEH_CETAK = ["", "ACC"];

// Gerbang akses per dokumen, dipasang di route:
// - non-KDC hanya boleh membuka/mengubah/mencetak proforma cabangnya sendiri
// - { cetak: true }: hanya yang sudah ACC
const batasiAkses =
  ({ cetak = false } = {}) =>
  async (req, res, next) => {
    try {
      const nomor = req.params.id || req.params.nomor;
      const info = await service.getInfoAkses(nomor);
      if (!info) {
        return res.status(404).json({ message: "Proforma tidak ditemukan." });
      }
      if (req.user.cabang !== "KDC" && info.cabang !== req.user.cabang) {
        return res
          .status(403)
          .json({ message: "Proforma ini milik cabang lain." });
      }
      if (cetak && !STATUS_BOLEH_CETAK.includes(info.statusAcc)) {
        const pesan =
          info.statusAcc === "DITOLAK"
            ? "Pengajuan proforma ditolak Manager Retail. Ubah lalu ajukan ulang."
            : "Proforma belum disetujui Manager Retail. Cetak baru bisa setelah ACC.";
        return res.status(403).json({ message: pesan });
      }
      next();
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  };

module.exports = {
  getDataFromSO,
  getDataFromInvoice,
  getDataForEdit,
  saveNew,
  updateExisting,
  lookupSO,
  lookupInvoice,
  getPrintData,
  batasiAkses,
};
