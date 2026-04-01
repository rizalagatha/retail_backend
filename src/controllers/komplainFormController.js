const komplainFormService = require("../services/komplainFormService");

const getDetail = async (req, res) => {
  try {
    const result = await komplainFormService.getKomplainDetail(
      req.params.nomor,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await komplainFormService.saveKomplain(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const changeStatus = async (req, res) => {
  try {
    const { status, catatan, solusi } = req.body;
    const result = await komplainFormService.updateStatus(
      req.params.nomor,
      status,
      catatan,
      solusi,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mengembalikan NAMA FILE TEMP ke frontend
const uploadFoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }
    // Cukup kembalikan nama file sementaranya (contoh: temp-1632...jpg)
    res.json({ fileName: req.file.filename });
  } catch (error) {
    res.status(500).json({ message: "Gagal mengunggah foto bukti." });
  }
};

const lookupInvoice = async (req, res) => {
  try {
    const result = await komplainFormService.lookupInvoice(req.user.cabang);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getInvoiceDetails = async (req, res) => {
  try {
    const result = await komplainFormService.getInvoiceDetailsForKomplain(
      req.params.nomor,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await komplainFormService.getPrintData(nomor);
    res.json(result);
  } catch (error) {
    console.error("Error getPrintData:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal mengambil data cetak." });
  }
};

module.exports = {
  getDetail,
  save,
  changeStatus,
  uploadFoto,
  lookupInvoice,
  getInvoiceDetails,
  getPrintData,
};
