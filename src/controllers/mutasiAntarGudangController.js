const service = require("../services/mutasiAntarGudangService");

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
    const { nomor } = req.params;
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const deleteMutasi = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.deleteMutasi(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const submitPengajuan = async (req, res) => {
  try {
    const { nomor, tanggal, keterangan, alasan } = req.body;
    const result = await service.submitPengajuan(
      nomor,
      tanggal,
      keterangan,
      alasan,
      req.user
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
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
  deleteMutasi,
  submitPengajuan,
  exportDetails,
};
