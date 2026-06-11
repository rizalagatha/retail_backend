const service = require("../services/customerVisitService");

const checkVisitToday = async (req, res) => {
  try {
    const { customerKode, tanggal } = req.query;
    const cabang = req.user.cabang; // Ambil cabang dari user yang login

    if (!customerKode || !tanggal) {
      return res
        .status(400)
        .json({ message: "Customer Kode dan Tanggal diperlukan." });
    }

    const result = await service.checkVisitToday(cabang, customerKode, tanggal);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error checkVisitToday:", error);
    res.status(500).json({ message: "Gagal mengecek status kunjungan." });
  }
};

module.exports = {
  checkVisitToday,
};
