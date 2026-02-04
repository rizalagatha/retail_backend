const service = require("../services/lokasiOpnameService");

const getSoDates = async (req, res) => {
  try {
    const { cabang } = req.query;
    const data = await service.getSoDates(cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMasterOptions = async (req, res) => {
  try {
    const data = await service.getMasterOptions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const bulkGenerate = async (req, res) => {
  try {
    // TAMBAHKAN jenisNama di sini
    const { cabang, locations, jenisNama } = req.body;

    if (
      !cabang ||
      !locations ||
      !Array.isArray(locations) ||
      locations.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Cabang dan daftar lokasi harus diisi." });
    }

    const result = await service.bulkGenerate({
      cabang,
      locations,
      jenisNama, // TERUSKAN ke service
      user: req.user.kode,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await service.deleteLocation(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getSoDates,
  getList,
  getMasterOptions,
  bulkGenerate,
  remove,
};
