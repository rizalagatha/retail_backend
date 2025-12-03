const historyUpdateService = require("../services/historyUpdateService");

const getHistoryUpdates = async (req, res) => {
  try {
    // Ambil parameter 'limit' dari query URL, default-nya 10
    const limit = req.query.limit || 10;
    const historyData = await historyUpdateService.getHistory(limit);

    // Mengelompokkan data berdasarkan versi (mirip logika di Delphi)
    const groupedHistory = {};
    historyData.forEach((item) => {
      if (!groupedHistory[item.r_versi]) {
        groupedHistory[item.r_versi] = {
          releaseDate: item.tgl,
          notes: [],
        };
      }
      groupedHistory[item.r_versi].notes.push(item.r_ket);
    });

    res.json(groupedHistory);
  } catch (error) {
    console.error("Error di getHistoryUpdates:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

module.exports = {
  getHistoryUpdates,
};
