import laporanStokService from "../services/laporanStokService.js";

const getLaporanStok = async (req, res) => {
  try {
    const { cabang, tanggal } = req.query;
    if (!cabang || !tanggal) {
      return res.status(400).json({ message: "Cabang dan tanggal wajib diisi" });
    }

    const data = await laporanStokService.generateLaporanStok(cabang, tanggal);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan di server", error: err.message });
  }
};

export default { getLaporanStok };
