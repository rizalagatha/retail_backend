const lhkSoDtfFormService = require("../services/lhkSoDtfFormService");

const loadData = async (req, res) => {
  try {
    // Ambil nomorLhk dari parameter URL (misal: /detail/:nomorLhk)
    const { nomorLhk } = req.params;

    if (!nomorLhk) {
      return res.status(400).json({ message: "Nomor LHK diperlukan." });
    }

    const data = await lhkSoDtfFormService.loadData(nomorLhk);
    res.json(data);
  } catch (error) {
    console.error("❌ ERROR loadData:", error);
    res.status(500).json({ message: error.message });
  }
};

const getJenisOrder = async (req, res) => {
  try {
    const { term } = req.query;
    const result = await lhkSoDtfFormService.getJenisOrderList(term);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSoPo = async (req, res) => {
  try {
    // Tangkap 'prefix' dari query string (dikirim frontend berdasarkan jenis order terpilih)
    const { term, cabang, tipe, prefix, page = 1, limit = 50 } = req.query;

    if (!cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }

    const result = await lhkSoDtfFormService.searchSoPo(
      term,
      cabang,
      tipe,
      prefix, // <--- Kirim ke service
      page,
      limit,
    );

    res.json(result);
  } catch (error) {
    console.error("❌ Error searchSoPo:", error);
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await lhkSoDtfFormService.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const removeData = async (req, res) => {
  try {
    const { tanggal, cabang } = req.params;
    const result = await lhkSoDtfFormService.removeData(tanggal, cabang);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getSpecs = async (req, res) => {
  try {
    const { nomorSo } = req.params;
    const result = await lhkSoDtfFormService.getSoDtfSpecs(nomorSo);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loadData,
  searchSoPo,
  saveData,
  removeData,
  getSpecs,
  getJenisOrder,
};
