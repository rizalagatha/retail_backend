const service = require("../services/peminjamanFormService");

const lookupProductByBarcode = async (req, res) => {
  try {
    const { barcode, cabang } = req.query;
    const result = await service.lookupProductByBarcode(barcode, cabang);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi saveData tanpa Audit Trail rutin.
 * Logika anomali keterlambatan sebaiknya dipindahkan ke modul Pengembalian.
 */
const saveData = async (req, res) => {
  try {
    const payload = req.body;

    // Langsung eksekusi simpan ke database melalui service
    const result = await service.saveData(payload, req.user);

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const result = await service.lookupProducts(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    console.error("Error Get Print Data PK:", error);
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  lookupProductByBarcode,
  saveData,
  lookupProducts,
  getPrintData,
};
