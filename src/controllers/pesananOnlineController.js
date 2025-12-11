const service = require("../services/pesananOnlineService");

const index = async (req, res) => {
  try {
    const filters = req.query;
    // req.user dari middleware auth
    const result = await service.getList(filters, req.user);
    res.json(result);
  } catch (error) {
    console.error("Error fetching pesanan online list:", error);
    res
      .status(500)
      .json({ message: error.message || "Terjadi kesalahan server." });
  }
};

module.exports = { index };
