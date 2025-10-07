const service = require("../services/pengajuanBarcodeFormService");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    // Langsung teruskan semua filter dari query ke service
    const data = await service.lookupProducts(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getJenisReject = async (req, res) => {
  try {
    const data = await service.getJenisReject();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    // Validasi parameter yang dibutuhkan
    const { kode, ukuran, gudang } = req.query;
    if (!kode || !ukuran || !gudang) {
      return res
        .status(400)
        .json({ message: "Parameter tidak lengkap (kode, ukuran, gudang)." });
    }
    const data = await service.getProductDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupStickers = async (req, res) => {
  try {
    const data = await service.lookupStickers(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForBarcodePrint = async (req, res) => {
    try {
        // Ambil 'nomor' dari parameter URL (req.params)
        const { nomor } = req.params; 
        if (!nomor) {
            return res.status(400).json({ message: 'Nomor dokumen diperlukan.' });
        }
        const data = await service.getDataForBarcodePrint(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

module.exports = {
  getForEdit,
  save,
  lookupProducts,
  getJenisReject,
  getProductDetails,
  lookupStickers,
  getDataForBarcodePrint,
};
