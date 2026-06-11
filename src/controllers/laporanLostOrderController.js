const service = require("../services/laporanLostOrderService");

const getLostOrderReport = async (req, res) => {
  try {
    const { startDate, endDate, cabang, keyword, tab } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal awal dan akhir diperlukan." });
    }

    const filters = {
      startDate,
      endDate,
      cabang: cabang || "ALL",
      keyword: keyword || "",
    };

    // Percabangan penarikan data berdasarkan tab aktif di frontend
    if (tab === "kunjungan") {
      const dataKunjungan = await service.getKunjunganReport(filters, req.user);
      return res.json(dataKunjungan);
    } else {
      const dataLost = await service.getLostOrderReport(filters, req.user);
      return res.json(dataLost);
    }
  } catch (error) {
    console.error("Error getLostOrderReport unified:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getLostOrderReport,
};
