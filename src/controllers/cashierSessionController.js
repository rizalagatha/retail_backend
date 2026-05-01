const cashierSessionService = require("../services/cashierSessionService");

const getCurrentSession = async (req, res) => {
  try {
    // Asumsi req.user di-set oleh middleware auth
    const cabang = req.user.cabang;
    const session = await cashierSessionService.getCurrentSession(cabang);

    res.status(200).json({
      success: true,
      data: session, // Akan null jika tidak ada sesi aktif
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const startSession = async (req, res) => {
  try {
    const cabang = req.user.cabang;
    const kasirUtama = req.user.kode;
    const { modalAwal } = req.body;

    const result = await cashierSessionService.startSession(
      cabang,
      kasirUtama,
      modalAwal,
    );
    res.status(200).json({
      success: true,
      message: "Shift berhasil dibuka.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const pauseSession = async (req, res) => {
  try {
    const kasirUtama = req.user.kode;
    const { sesiId, kasirPengganti, pinPengganti, keterangan } = req.body;

    if (!kasirPengganti || !pinPengganti) {
      return res
        .status(400)
        .json({ message: "Kasir Pengganti dan PIN wajib diisi." });
    }

    const result = await cashierSessionService.pauseSession(
      sesiId,
      kasirUtama,
      kasirPengganti,
      pinPengganti,
      keterangan,
    );
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const resumeSession = async (req, res) => {
  try {
    const kasirUtama = req.user.kode;
    const { sesiId, pinUtama } = req.body;

    if (!pinUtama) {
      return res.status(400).json({ message: "PIN Kasir Utama wajib diisi." });
    }

    const result = await cashierSessionService.resumeSession(
      sesiId,
      kasirUtama,
      pinUtama,
    );
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const endSession = async (req, res) => {
  try {
    const kasirUtama = req.user.kode;
    const {
      sesiId,
      kasirPenerima,
      pinPenerima,
      // saldoSistem, <--- INI DIHAPUS (Tidak usah ambil dari Frontend)
      saldoFisik,
      keteranganSelisih,
    } = req.body;

    if (!kasirPenerima || !pinPenerima) {
      return res
        .status(400)
        .json({ message: "Kasir Shift 2 dan PIN Penerima wajib diisi." });
    }

    // Panggil service tanpa saldoSistem
    const result = await cashierSessionService.endSession(
      sesiId,
      kasirUtama,
      kasirPenerima,
      pinPenerima,
      saldoFisik,
      keteranganSelisih,
    );

    res.status(200).json({
      success: true,
      message: result.message,
      selisih: result.selisih,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getCurrentSession,
  startSession,
  pauseSession,
  resumeSession,
  endSession,
};
