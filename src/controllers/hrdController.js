const hrdService = require("../services/hrdService");

const checkKaryawan = async (req, res) => {
  try {
    const { nik } = req.params;
    const result = await hrdService.getKaryawanInfo(nik);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Gagal memvalidasi data karyawan." });
  }
};

const searchKaryawan = async (req, res) => {
  try {
    const { term } = req.query; // Ambil dari query param ?term=rizal
    const result = await hrdService.searchKaryawan(term);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

module.exports = { checkKaryawan, searchKaryawan };
