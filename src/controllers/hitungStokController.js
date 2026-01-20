const service = require("../services/hitungStokService");

const getList = async (req, res) => {
  try {
    if (!req.query.cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const bulkGenerateLocations = async (req, res) => {
  try {
    const { cabang, locations } = req.body;

    if (
      !cabang ||
      !locations ||
      !Array.isArray(locations) ||
      locations.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Data cabang atau daftar lokasi tidak valid." });
    }

    // Teruskan ke service dengan menyertakan kode user dari token
    const result = await service.bulkGenerateLocations({
      cabang,
      locations,
      user: req.user.kode,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getCabangOptions,
  bulkGenerateLocations,
};
