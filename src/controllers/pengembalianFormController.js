const service = require("../services/pengembalianFormService");

const getPinjamanData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPinjamanForReturn(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveReturn = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPinjamanData,
  saveReturn,
};
