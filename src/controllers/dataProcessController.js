const dataProcessService = require("../services/dataProcessService");
require("dotenv/config");

// Ambil PIN dari file .env, jika tidak ada, gunakan PIN default dari Delphi
const PROCESS_PIN = process.env.PROCESS_PIN || "303058";

const runInsertSalesDetails = async (req, res) => {
  const { pin } = req.body;
  if (pin !== PROCESS_PIN) {
    return res.status(401).json({ message: "PIN salah." });
  }
  try {
    const result = await dataProcessService.insertSalesDetails();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const runInsertCashPayments = async (req, res) => {
  const { pin } = req.body;
  if (pin !== PROCESS_PIN) {
    return res.status(401).json({ message: "PIN salah." });
  }
  try {
    const result = await dataProcessService.insertCashPaymentDetails();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  runInsertSalesDetails,
  runInsertCashPayments,
};
