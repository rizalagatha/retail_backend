const service = require("../services/pelunasanInvoiceService");

// GET: Ambil daftar piutang user
const getOutstandingPiutang = async (req, res) => {
  try {
    const { customerKode } = req.params;

    if (!customerKode) {
      return res.status(400).json({ message: "Kode Customer diperlukan." });
    }

    // req.user disuntikkan oleh middleware auth
    const data = await service.getOutstandingPiutang(customerKode, req.user);
    res.json(data);
  } catch (error) {
    console.error("Error getOutstandingPiutang:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi savePelunasan tanpa Audit Trail.
 */
const savePelunasan = async (req, res) => {
  try {
    const payload = req.body;

    // Validasi sederhana
    if (!payload.customerKode)
      return res.status(400).json({ message: "Customer harus diisi." });
    if (!payload.totalBayar || payload.totalBayar <= 0)
      return res
        .status(400)
        .json({ message: "Total bayar harus lebih dari 0." });
    if (!payload.invoices || payload.invoices.length === 0)
      return res
        .status(400)
        .json({ message: "Tidak ada invoice yang dipilih." });

    // Langsung eksekusi simpan ke database melalui service
    const result = await service.savePelunasan(payload, req.user);

    res.json(result);
  } catch (error) {
    console.error("Error savePelunasan:", error);
    res.status(500).json({ message: error.message });
  }
};

const getPaymentHistory = async (req, res) => {
  try {
    const data = await service.getPaymentHistory(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPaymentDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPaymentDetail(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getOutstandingPiutang,
  savePelunasan,
  getPaymentHistory,
  getPaymentDetail,
};
