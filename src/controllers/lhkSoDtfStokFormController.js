const lhkSoDtfStokFormService = require("../services/lhkSoDtfStokFormService");

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await lhkSoDtfStokFormService.loadForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSoStok = async (req, res) => {
  try {
    const data = await lhkSoDtfStokFormService.searchSoStok(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDetailsForGrid = async (req, res) => {
  try {
    const { soNomor } = req.params;
    const data = await lhkSoDtfStokFormService.getSoDetailsForGrid(soNomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await lhkSoDtfStokFormService.save(req.body, req.user);
    res.status(req.body.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  loadForEdit,
  searchSoStok,
  getSoDetailsForGrid,
  save,
};
