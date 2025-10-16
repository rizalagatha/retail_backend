const service = require("../services/promoFormService");

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
    try {
        const data = await service.lookupProducts(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
  getInitialData,
  getForEdit,
  save,
  lookupProducts,
};
