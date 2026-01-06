const service = require("../services/biayaKirimService");
const auditService = require("../services/auditService");

const getBrowse = async (req, res) => {
  try {
    // FIX: Ambil startDate dan endDate sesuai parameter URL di browser Anda
    const { startDate, endDate, cabang } = req.query;

    // FIX: Pastikan req.user dilempar sebagai argumen KE-4 agar tidak error undefined 'cabang'
    const data = await service.getBrowseData(
      startDate,
      endDate,
      cabang,
      req.user
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetailPayments(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.deleteBiayaKirim(nomor, req.user);

    auditService.logActivity(
      req,
      "DELETE",
      "BIAYA_KIRIM",
      nomor,
      null,
      null,
      `Hapus data biaya kirim nomor: ${nomor}`
    );

    res.json({ message: "Data berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getBrowse, getDetails, deleteData };
