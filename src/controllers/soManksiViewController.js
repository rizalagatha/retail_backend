const soManksiViewService = require("../services/soManksiViewService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soManksiViewService.getSoManksiDetail(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = { getDetail };
