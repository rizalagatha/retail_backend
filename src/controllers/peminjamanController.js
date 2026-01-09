// backend/src/controllers/peminjamanController.js
const service = require("../services/peminjamanService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Gunakan nama 'getDetails' (jamak) agar sinkron dengan router
const getDetails = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await service.getDetail(nomor); // Service tetap getDetail
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const savePeminjaman = async (req, res) => {
  try {
    const result = await service.savePeminjaman(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Tambahkan stub lookupProducts agar router tidak error
const lookupProducts = async (req, res) => {
  try {
    const result = await service.lookupProducts(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deletePeminjaman = async (req, res) => {
  try {
    const result = await service.deletePeminjaman(req.params.nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// EKSPOR SEMUA FUNGSI DISINI
module.exports = {
  getList,
  getDetails,
  savePeminjaman,
  lookupProducts,
  deletePeminjaman,
};
