const service = require("../services/jenisKainService");

const getAll = async (req, res) => {
  try {
    const data = await service.getAll();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    // Nama jenis kain dikirim sebagai parameter URL yang di-encode
    const result = await service.remove(
      decodeURIComponent(req.params.jenisKain)
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const save = async (req, res) => {
    try {
        const result = await service.save(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { getAll, remove, save };
