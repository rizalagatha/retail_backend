const service = require("../services/returDcFormService");

const loadAllStock = async (req, res) => {
  try {
    // 'cabang' diambil dari data user yang terotentikasi
    const data = await service.loadAllStock(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
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
    const data = await service.getProductDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    const data = await service.findByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupGudangDc = async (req, res) => {
  try {
    const data = await service.lookupGudangDc(req.query);
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
  loadAllStock,
  getForEdit,
  save,
  getProductDetails,
  findByBarcode,
  lookupGudangDc,
  getPrintData,
};
