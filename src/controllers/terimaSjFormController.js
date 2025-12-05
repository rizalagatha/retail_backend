const terimaSjFormService = require("../services/terimaSjFormService");

const load = async (req, res) => {
  try {
    const { nomorSj } = req.params;
    const data = await terimaSjFormService.loadInitialData(nomorSj);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await terimaSjFormService.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  load,
  save,
};
