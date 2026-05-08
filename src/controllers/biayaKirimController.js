const service = require("../services/biayaKirimService");
const auditService = require("../services/auditService");

const getBrowse = async (req, res) => {
  try {
    // FIX: Ambil startDate, endDate, cabang, ditambah parameter pagination & search
    const { startDate, endDate, cabang, page, limit, search } = req.query;

    // Lempar parameter secara berurutan sesuai dengan yang didefinisikan di Service
    const data = await service.getBrowseData(
      startDate,
      endDate,
      cabang,
      req.user,
      page, // Argumen ke-5: halaman saat ini
      limit, // Argumen ke-6: jumlah data per halaman
      search, // Argumen ke-7: kata kunci pencarian
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
      `Hapus data biaya kirim nomor: ${nomor}`,
    );

    res.json({ message: "Data berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getBrowse, getDetails, deleteData };
