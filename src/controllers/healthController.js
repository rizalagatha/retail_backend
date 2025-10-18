const service = require("../services/healthService");

const check = async (req, res) => {
  try {
    const result = await service.checkHealth();
    res.status(200).json(result);
  } catch (error) {
    res.status(503).json({ status: "error", message: "Service unavailable" });
  }
};

module.exports = { check };
