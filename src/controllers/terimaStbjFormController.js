const service = require("../services/terimaStbjFormService");

const loadFromStbj = async (req, res) => {
  try {
    // Ambil 'nomorStbj' dari query parameter
    const { nomorStbj } = req.query;
    if (!nomorStbj) {
      return res
        .status(400)
        .json({ message: "Parameter nomorStbj diperlukan." });
    }
    const data = await service.loadFromStbj(nomorStbj);
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
    console.error("Save STBJ Controller Error:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

module.exports = {
  loadFromStbj,
  save,
};
