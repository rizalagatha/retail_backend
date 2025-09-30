const service = require("../services/koreksiStokFormService");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user);
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

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang, tanggal } = req.query;
    if (!kode || !ukuran || !gudang || !tanggal) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await service.getProductDetails(kode, ukuran, gudang, tanggal);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
    try {
        const { barcode } = req.params;
        const { gudang, tanggal } = req.query;
        if (!gudang || !tanggal) {
            return res.status(400).json({ message: 'Parameter gudang dan tanggal diperlukan.' });
        }
        const data = await service.findByBarcode(barcode, gudang, tanggal);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
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

const getPrintData = async (req, res) => {
    try {
        const data = await service.getPrintData(req.params.nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

module.exports = {
  getForEdit,
  save,
  getProductDetails,
  findByBarcode,
  lookupProducts,
  getPrintData,
};
