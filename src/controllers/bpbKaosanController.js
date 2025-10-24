const service = require("../services/bpbKaosanService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getDetails = async (req, res) => {
  try {
    const data = await service.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const deleteBPB = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { nomorPO, cabang } = req.body; // Ambil nomorPO dari body
    if (!nomorPO || !cabang) {
      return res
        .status(400)
        .json({ message: "Informasi PO dan Cabang diperlukan." });
    }
    const result = await service.deleteBPB(nomor, nomorPO, cabang, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteBPB,
  exportDetails,
};
