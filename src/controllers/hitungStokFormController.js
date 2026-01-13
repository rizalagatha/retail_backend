const service = require("../services/hitungStokFormService");

const getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const data = await service.getProductByBarcode(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const processScan = async (req, res) => {
  try {
    // req.body akan berisi { lokasi, barcode, product }
    const result = await service.processScan(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getScannedItemsByLocation = async (req, res) => {
  try {
    const { lokasi } = req.query;
    if (!lokasi) {
      return res.status(400).json({ message: "Parameter lokasi diperlukan." });
    }
    const data = await service.getScannedItemsByLocation(lokasi, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- Fungsi Baru: Update Qty Manual ---
const updateQty = async (req, res) => {
  try {
    // req.body berisi { lokasi, barcode, delta }
    const result = await service.updateQty(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const deleteItem = async (req, res) => {
  try {
    // Menggunakan body atau query, di sini kita gunakan query agar sesuai standar DELETE
    const result = await service.deleteItem(req.query, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getProductByBarcode,
  processScan,
  getScannedItemsByLocation,
  updateQty,
  deleteItem,
};
