const komplainService = require("../services/komplainService");

const getList = async (req, res) => {
  try {
    const filters = req.query;
    const result = await komplainService.getKomplainList(filters, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
};
