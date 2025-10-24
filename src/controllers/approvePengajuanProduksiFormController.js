const service = require("../services/approvePengajuanProduksiFormService");

const getDataForApprove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForApprove(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const saveApproval = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.saveApproval(nomor, req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getDataForApprove,
  saveApproval,
};
