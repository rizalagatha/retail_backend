const service = require("../services/mutasiKirimFormService");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    if (error.message === "Dokumen tidak ditemukan") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi Save tanpa Audit Trail dan Snapshot Database.
 */
const save = async (req, res) => {
  try {
    const payload = req.body;

    // Langsung eksekusi simpan ke database melalui service
    const result = await service.save(payload, req.user);

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupTujuanStore = async (req, res) => {
  try {
    const data = await service.lookupTujuanStore(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang } = req.query;
    if (!kode || !ukuran || !gudang) {
      return res.status(400).json({ message: "Parameter tidak lengkap" });
    }
    const data = await service.getProductDetails(kode, ukuran, gudang);
    res.json(data);
  } catch (error) {
    if (error.message === "Detail produk tidak ditemukan") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res, next) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    if (!gudang) throw new Error("Parameter gudang diperlukan");
    const data = await service.findByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    if (res.headersSent) return next(error);
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res, next) => {
  try {
    const data = await service.getPrintData(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    if (res.headersSent) return next(error);
    res.status(500).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const gudang = req.user.cabang;
    if (!gudang) {
      return res.status(400).json({ message: "Gudang asal tidak ditemukan." });
    }
    const data = await service.lookupProductsForMutasiKirim(gudang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  lookupTujuanStore,
  getProductDetails,
  findByBarcode,
  getPrintData,
  lookupProducts,
};
