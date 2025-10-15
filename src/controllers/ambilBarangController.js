const service = require("../services/ambilBarangService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res.status(400).json({ message: "Parameter 'nomor' diperlukan." });
    }
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteAmbilBarang = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.deleteAmbilBarang(nomor);
    res.json(result);
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

const exportDetail = async (req, res) => {
    try {
        const data = await service.getExportDetails(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
  getList,
  getDetails,
  deleteAmbilBarang,
  lookupProducts,
  exportDetail
};
