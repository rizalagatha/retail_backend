const terimaWorkshopFormService = require("../services/terimaWorkshopFormService");

const loadFromKirim = async (req, res) => {
  try {
    // Ngambil nomorKirim dari parameter query (contoh: ?nomorKirim=K01.MWK...)
    const { nomorKirim } = req.query;
    if (!nomorKirim) {
      return res.status(400).json({ message: "Nomor Kirim harus diisi." });
    }

    const data = await terimaWorkshopFormService.loadFromKirim(nomorKirim);
    res.json(data);
  } catch (error) {
    console.error("Error loadFromKirim:", error);
    res
      .status(500)
      .json({ message: error.message || "Terjadi kesalahan pada server." });
  }
};

const save = async (req, res) => {
  try {
    // req.user didapat dari middleware verifyToken
    const result = await terimaWorkshopFormService.save(req.body, req.user);
    res.json(result);
  } catch (error) {
    console.error("Error save Terima Workshop:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

module.exports = {
  loadFromKirim,
  save,
};
