const service = require("../services/stokOpnameSettingService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const setDate = async (req, res) => {
  try {
    // PENTING: Kirim req.body secara utuh agar service mendapatkan 'cabangTarget'
    const result = await service.setDate(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const deleteDate = async (req, res) => {
  try {
    const { tanggal } = req.params;
    // PENTING: Ambil cabang dari query parameter (params di axios frontend)
    const { cabang } = req.query;

    const result = await service.deleteDate(tanggal, cabang, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  setDate,
  deleteDate,
};
