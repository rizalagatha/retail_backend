const service = require("../services/mintaAccesoriesService");

const getAll = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      keyword: req.query.keyword,
    };
    const data = await service.getAll(filters, req.user);
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

const deletePermintaan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.deletePermintaan(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const closeManual = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    const result = await service.closeManual(nomor, alasan, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const checkUnapproved = async (req, res) => {
  try {
    // Menggunakan kode user yang sedang login
    const count = await service.checkUnapprovedRealisasi(req.user.kode);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const approveRealisasi = async (req, res) => {
  try {
    const { prominNomor } = req.params;
    await service.approveRealisasi(prominNomor);
    res.json({ message: "Realisasi berhasil di-approve." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  deletePermintaan,
  closeManual,
  checkUnapproved,
  approveRealisasi,
};
