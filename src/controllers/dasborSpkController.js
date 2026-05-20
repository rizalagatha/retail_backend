const dasborSpkService = require("../services/dasborSpkService");

const getCabangList = async (req, res) => {
  try {
    const data = await dasborSpkService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getKuota = async (req, res) => {
  try {
    // Karena sekarang global, cabang tidak lagi wajib dari query parameter
    const kuota = await dasborSpkService.getKuota();
    res.json({ kuota });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveKuota = async (req, res) => {
  try {
    const { kuota } = req.body;
    if (kuota === undefined)
      return res.status(400).json({ message: "Parameter kuota diperlukan." });

    // Simpan kuota global
    const result = await dasborSpkService.saveKuota(kuota, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDasborData = async (req, res) => {
  try {
    const data = await dasborSpkService.getDasborData(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDasborDetail = async (req, res) => {
  try {
    const { tanggal } = req.query;
    // HAPUS validasi cabang karena sekarang datanya global
    if (!tanggal)
      return res
        .status(400)
        .json({ message: 'Parameter "tanggal" diperlukan.' });

    const data = await dasborSpkService.getDasborDetail(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportHeader = async (req, res) => {
  try {
    const data = await dasborSpkService.exportHeader(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const data = await dasborSpkService.exportDetail(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCabangList,
  getKuota,
  saveKuota,
  getDasborData,
  getDasborDetail,
  exportHeader,
  exportDetail,
};
