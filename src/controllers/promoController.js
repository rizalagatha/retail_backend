const service = require("../services/promoService");

const getList = async (req, res) => {
  try {
    const data = await service.getList();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await service.remove(req.params.nomor);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getList, remove };
