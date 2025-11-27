const lhkSoDtfFormService = require("../services/lhkSoDtfFormService");

const loadData = async (req, res) => {
  try {
    const { tanggal, cabang } = req.params;
    const data = await lhkSoDtfFormService.loadData(tanggal, cabang);
    res.json(data);
  } catch (error) {
    console.error("❌ ERROR loadData:", error);
    res.status(500).json({ message: error.message });
  }
};

const searchSoPo = async (req, res) => {
  try {
    const { term, cabang, tipe, page = 1, limit = 50 } = req.query;

    if (!cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }

    const result = await lhkSoDtfFormService.searchSoPo(
      term,
      cabang,
      tipe,
      page,
      limit
    );

    res.json({
      data: result.data,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error("❌ Error searchSoPo:", error);
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    console.log(
      "🔵 [LHK SAVE] Incoming payload:",
      JSON.stringify(req.body, null, 2)
    );
    console.log("🔵 [LHK SAVE] User:", req.user);

    const result = await lhkSoDtfFormService.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    console.error("❌ ERROR saveData:");
    console.error("📌 Message:", error.message);
    console.error("📌 Stack:", error.stack);

    // Jika error MySQL, tampilkan detailnya
    if (error.sql) {
      console.error("📌 SQL:", error.sql);
      console.error("📌 SQL Message:", error.sqlMessage);
      console.error("📌 SQL State:", error.sqlState);
      console.error("📌 Errno:", error.errno);
    }

    res.status(500).json({ message: error.message });
  }
};

const removeData = async (req, res) => {
  try {
    const { tanggal, cabang } = req.params;
    const result = await lhkSoDtfFormService.removeData(tanggal, cabang);
    res.json(result);
  } catch (error) {
    console.error("❌ ERROR removeData:", error);
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  loadData,
  searchSoPo,
  saveData,
  removeData,
};
