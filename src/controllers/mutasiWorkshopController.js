const mutasiWorkshopService = require("../services/mutasiWorkshopService");

const getCabangList = async (req, res) => {
  try {
    const result = await mutasiWorkshopService.getCabangList(req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getWorkshopList = async (req, res) => {
  try {
    const result = await mutasiWorkshopService.getWorkshopList();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const filters = req.query;
    const result = await mutasiWorkshopService.getList(filters);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await mutasiWorkshopService.getDetails(nomor);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await mutasiWorkshopService.remove(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportData = async (req, res) => {
  try {
    const filters = req.query;
    const result = await mutasiWorkshopService.getExportDetails(filters);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCabangList,
  getWorkshopList,
  getList,
  getDetails,
  remove,
  exportData,
};
