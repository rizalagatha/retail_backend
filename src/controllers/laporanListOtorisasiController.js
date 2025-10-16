const service = require("../services/laporanListOtorisasiService");

const getListOtorisasi = async (req, res) => {
  try {
    const data = await service.getListOtorisasi(req.query);
    res.status(200).json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Terjadi kesalahan saat mengambil data otorisasi.",
    });
  }
};

module.exports = {
  getListOtorisasi,
};
