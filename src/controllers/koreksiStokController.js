const service = require("../services/koreksiStokService.js");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const data = await service.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const toggleApproval = async (req, res) => {
  try {
    const result = await service.toggleApproval(req.params.nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.remove(nomor, req.user);
    res.json(result);
  } catch (error) {
    // Gunakan status 400 untuk error validasi (misal: sudah di-ACC)
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    // [PENTING] Pastikan req.user dikirim sebagai parameter kedua
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getList, getDetails, toggleApproval, remove, exportDetails };
