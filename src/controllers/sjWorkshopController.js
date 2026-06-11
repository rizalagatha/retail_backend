const sjWorkshopService = require("../services/sjWorkshopService");

const getList = async (req, res) => {
  try {
    const data = await sjWorkshopService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const data = await sjWorkshopService.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getList, getDetails };
