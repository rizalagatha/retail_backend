const service = require("../services/terimaRepairFormService");

const loadFromKirim = async (req, res) => {
  try {
    const data = await service.loadFromKirim(req.query.nomorKirim);
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
    console.error("Save Terima Repair Controller Error:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

module.exports = {
  loadFromKirim,
  save,
};
