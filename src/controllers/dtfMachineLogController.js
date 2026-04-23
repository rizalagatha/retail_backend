// File: controllers/dtfMachineLogController.js

const dtfMachineLogService = require("../services/dtfMachineLogService");

const getLogList = async (req, res) => {
  try {
    // req.query berisi startDate, endDate, cabang, search
    // req.user berisi data user yang login (dari middleware verifyToken)
    const result = await dtfMachineLogService.getLogList(req.query, req.user);
    res.json(result);
  } catch (error) {
    console.error("Error di getLogList (dtfMachineLogController):", error);
    res.status(500).json({
      message: error.message || "Gagal mengambil daftar log mesin.",
    });
  }
};

const importLogMesin = async (req, res) => {
  try {
    // Pastikan ada file yang diunggah
    if (!req.file) {
      return res.status(400).json({
        message: "File Excel/CSV tidak ditemukan. Silakan upload file.",
      });
    }

    // req.file.buffer berasal dari multer (memoryStorage)
    const result = await dtfMachineLogService.importLogMesin(
      req.file.buffer,
      req.user,
    );

    // Kembalikan respon sukses
    res.json(result);
  } catch (error) {
    console.error("Error di dtfMachineLogController:", error);
    res.status(500).json({
      message: error.message || "Terjadi kesalahan saat memproses file.",
    });
  }
};

module.exports = {
  getLogList,
  importLogMesin,
};
