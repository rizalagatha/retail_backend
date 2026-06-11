const service = require("../services/laporanStokBahanService");

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getStokBahan = async (req, res) => {
  try {
    const { cabang, jenis, keyword, tanggal, tampilkanKosong } = req.query;

    if (!tanggal) {
      return res.status(400).json({ message: "Parameter tanggal diperlukan." });
    }

    const filters = {
      cabang: cabang || "ALL",
      jenis: jenis || "ALL",
      keyword: keyword || "",
      tanggal,
      tampilkanKosong: tampilkanKosong === "true",
    };

    const data = await service.getStokBahan(filters, req.user);
    res.json(data);
  } catch (error) {
    console.error("Error getStokBahan:", error);
    res.status(500).json({ message: error.message });
  }
};

const getKartuStokBahan = async (req, res) => {
  try {
    const { cabang, kodeBarang, tanggalAwal, tanggalAkhir } = req.query;

    if (!kodeBarang) {
      return res
        .status(400)
        .json({ message: "Parameter kodeBarang diperlukan." });
    }

    const filters = {
      cabang: cabang || "ALL", // Jangan dipaksa ke req.user.cabang dulu, biar divalidasi service
      kodeBarang,
      tanggalAwal,
      tanggalAkhir,
    };

    // Meneruskan req.user agar service bisa mengecek otorisasi Store vs KDC
    const data = await service.getKartuStokBahan(filters, req.user);
    res.json(data);
  } catch (error) {
    console.error("Error getKartuStokBahan:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCabangOptions,
  getStokBahan,
  getKartuStokBahan,
};
