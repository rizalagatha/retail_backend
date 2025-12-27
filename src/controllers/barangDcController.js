const service = require("../services/barangDcService");

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
    const data = await service.getDetails(req.params.kode, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [BARU]
const exportHeaders = async (req, res) => {
  try {
    const data = await service.getExportHeaders(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [UPDATE] Implementasi yang sebelumnya kosong
const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getTotalProducts = async (req, res) => {
  try {
    const result = await service.getTotalProducts();
    res.json(result); // Langsung kirim seluruh objek hasil
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  exportHeaders, // <--- TAMBAHKAN
  exportDetails,
  getTotalProducts,
};
