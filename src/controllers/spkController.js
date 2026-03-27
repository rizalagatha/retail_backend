const spkService = require("../services/spkService");

const getDivisi = async (req, res) => {
  try {
    const data = await spkService.getDivisiList(); // Memanggil service divisi
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getJenisOrder = async (req, res) => {
  try {
    const { divisi } = req.params;
    const { cabang } = req.user; // Diambil dari verifyToken
    const data = await spkService.getJenisOrderList(divisi, cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await spkService.getSpkLookups();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const generateSpk = async (req, res) => {
  try {
    const result = await spkService.createSpkFromSo(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    console.error("Error Generate SPK:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getDivisi, getJenisOrder, getLookups, generateSpk };
