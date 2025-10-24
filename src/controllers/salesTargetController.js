const service = require("../services/salesTargetService");

const getList = async (req, res) => {
  try {
    // Check for required filters from the frontend
    if (!req.query.tahun || !req.query.bulan) {
      return res
        .status(400)
        .json({ message: "Parameter tahun dan bulan diperlukan." });
    }
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    console.error("Error in getList controller for Sales vs Target:", error);
    res.status(500).json({ message: error.message });
  }
};

const getDynamicCabangOptions = async (req, res) => {
    try {
        const data = await service.getDynamicCabangOptions(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
  getList,
  getDynamicCabangOptions,
};
