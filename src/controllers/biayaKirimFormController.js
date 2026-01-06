const service = require("../services/biayaKirimFormService");
const auditService = require("../services/auditService");
const pool = require("../config/database");

const lookupInvoice = async (req, res) => {
  try {
    const { term, customerKode } = req.query; // Ambil customerKode jika ada
    const data = await service.lookupInvoice(term, req.user, customerKode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getInvoiceDetails = async (req, res) => {
  try {
    const data = await service.getInvoiceDetails(req.params.nomorInv);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const data = await service.loadForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // SNAPSHOT: Ambil data lama jika Update
    if (isUpdate && nomorDokumen) {
      try {
        const [rows] = await pool.query(
          "SELECT * FROM tbiayakirim WHERE bk_nomor = ?",
          [nomorDokumen]
        );
        if (rows.length > 0) oldData = rows[0];
      } catch (e) {
        console.warn("Gagal snapshot oldData save BK:", e.message);
      }
    }

    const result = await service.saveData(payload, req.user);

    // AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen;
    const action = isUpdate ? "UPDATE" : "CREATE";
    const note = `${isUpdate ? "Edit" : "Input"} Biaya Kirim (Invoice: ${
      payload.header?.inv_nomor
    })`;

    auditService.logActivity(
      req,
      action,
      "BIAYA_KIRIM",
      targetId,
      oldData,
      payload,
      note
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    let oldData = null;

    try {
      const [rows] = await pool.query(
        "SELECT * FROM tbiayakirim WHERE bk_nomor = ?",
        [nomor]
      );
      if (rows.length > 0) oldData = rows[0];
    } catch (e) {
      console.warn("Gagal snapshot oldData remove BK:", e.message);
    }

    const result = await service.remove(nomor, req.user);

    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",
        "BIAYA_KIRIM",
        nomor,
        oldData,
        null,
        `Menghapus Biaya Kirim Nomor: ${nomor}`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);

    if (!data) {
      return res
        .status(404)
        .json({ message: "Data Cetak Biaya Kirim tidak ditemukan." });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  lookupInvoice,
  getInvoiceDetails,
  loadForEdit,
  save,
  remove,
  getPrintData,
};
