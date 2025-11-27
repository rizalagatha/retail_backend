const service = require("../services/mutasiKirimFormService");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    // Jika error "Tidak ditemukan", kirim status 404
    if (error.message === "Dokumen tidak ditemukan") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.status(201).json(result); // Gunakan status 201 untuk "Created"
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
      // Untuk validasi input, gunakan status 400 Bad Request
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
    if (!gudang) throw new AppError("Parameter gudang diperlukan", 400);
    const data = await service.findByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const getPrintData = async (req, res, next) => {
  try {
    const data = await service.getPrintData(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const lookupProducts = async (req, res) => {
  try {
    // Ambil gudang dari user yang login (atau dari query jika perlu)
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
