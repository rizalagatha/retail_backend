const service = require("../services/invoiceService");

const getCabangList = async (req, res) => {
  try {
    const data = await service.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

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

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.remove(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getExportHeader = async (req, res) => {
  try {
    // 1. Ambil User & Query
    const user = req.user;

    // Copy req.query ke variabel baru agar bisa dimodifikasi
    const filters = { ...req.query };

    // 2. [SECURITY] Paksa Filter Cabang
    // Ini LOGIKA PENTING yang tidak ada di exportDetails lama
    if (user.cabang !== "KDC") {
      filters.cabang = user.cabang;
    }

    // 3. Panggil Service (Langsung oper object filters)
    const rows = await service.getExportHeader(filters);

    res.json(rows);
  } catch (error) {
    console.error("Error getExportHeader:", error);
    res.status(500).json({ message: error.message || "Gagal export header." });
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

const checkIfInvoiceInFsk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const used = await service.checkIfInvoiceInFsk(nomor);
    res.json({ used });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const changePayment = async (req, res) => {
  try {
    // req.user didapat dari middleware auth (token)
    const user = req.user;
    const payload = req.body;

    // Panggil logic di service
    const result = await service.changePaymentMethod(payload, user);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error changePayment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Terjadi kesalahan internal server.",
    });
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportHeader,
  exportDetails,
  checkIfInvoiceInFsk,
  changePayment,
};
