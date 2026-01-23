// controllers/laporanListOtorisasiController.js
const service = require("../services/laporanListOtorisasiService");

const getListOtorisasi = async (req, res) => {
  try {
    const data = await service.getListOtorisasi(req.query);
    res.status(200).json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetailTransaksi = async (req, res) => {
  try {
    const { auth_nomor } = req.query; // Sesuai dengan params di Vue: { auth_nomor: item.nomor }

    if (!auth_nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor otorisasi kosong." });
    }

    const data = await service.getDetailTransaksi(auth_nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getListOtorisasi, getDetailTransaksi };
