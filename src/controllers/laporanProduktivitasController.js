const laporanProduktivitasService = require("../services/laporanProduktivitasService");

const getOpenPipeline = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getOpenPipelinePerUser(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    console.error(
      "❌ Controller Error (open-pipeline):",
      error.sqlMessage || error.message,
    );
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getUserOptions = async (req, res) => {
  try {
    const data = await laporanProduktivitasService.getUserOptions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getBranchOptions = async (req, res) => {
  try {
    const { userCabang } = req.query;
    if (!userCabang) {
      return res
        .status(400)
        .json({ message: "Parameter userCabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getBranchOptions(userCabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getOpenPenawaranDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getOpenPenawaranDetail(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    console.error(
      "❌ Controller Error (open-penawaran-detail):",
      error.sqlMessage || error.message,
    );
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getOpenSoDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getOpenSoDetail(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    console.error(
      "❌ Controller Error (open-so-detail):",
      error.sqlMessage || error.message,
    );
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getClosedPipeline = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getClosedPipelinePerUser(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const makeClosedDetailHandler = (serviceFn) => async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await serviceFn(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

// controller
const getOpenPipelineTree = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const data = await laporanProduktivitasService.getOpenPipelineTree(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    console.error(
      "❌ Controller Error (open-pipeline-tree):",
      error.sqlMessage || error.message,
    );
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getPenawaranBucketDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate, bucket } = req.query;
    if (!startDate || !endDate || !cabang || !bucket) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await laporanProduktivitasService.getOpenPenawaranBucketDetail(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
      bucket,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getSoInternalBucketDetailHandler = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate, bucket } = req.query;
    if (!startDate || !endDate || !cabang || !bucket) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await laporanProduktivitasService.getSoInternalBucketDetail(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
      bucket,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getSoPabrikBucketDetailHandler = async (req, res) => {
  try {
    const { startDate, endDate, cabang, pic, bucket } = req.query;
    if (!startDate || !endDate || !cabang || !bucket) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await laporanProduktivitasService.getSoPabrikBucketDetail(
      startDate,
      endDate,
      cabang,
      pic || "ALL",
      bucket,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getSoInternalAllDetailHandler = async (req, res) => {
  try {
    const { startDate, endDate, cabang, userCreate } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await laporanProduktivitasService.getSoInternalAllDetail(
      startDate,
      endDate,
      cabang,
      userCreate || "ALL",
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getSoPabrikAllDetailHandler = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const data = await laporanProduktivitasService.getSoPabrikAllDetail(
      startDate,
      endDate,
      cabang,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

module.exports = {
  getOpenPipeline,
  getOpenPenawaranDetail,
  getOpenSoDetail,
  getClosedPipeline,
  getClosedPenawaranWonDetail: makeClosedDetailHandler(
    laporanProduktivitasService.getClosedPenawaranWonDetail,
  ),
  getClosedPenawaranLostDetail: makeClosedDetailHandler(
    laporanProduktivitasService.getClosedPenawaranLostDetail,
  ),
  getClosedSoWonDetail: makeClosedDetailHandler(
    laporanProduktivitasService.getClosedSoWonDetail,
  ),
  getClosedSoLostDetail: makeClosedDetailHandler(
    laporanProduktivitasService.getClosedSoLostDetail,
  ),
  getUserOptions,
  getBranchOptions,
  getOpenPipelineTree,
  getPenawaranBucketDetail,
  getSoInternalBucketDetailHandler,
  getSoPabrikBucketDetailHandler,
  getSoInternalAllDetailHandler,
  getSoPabrikAllDetailHandler,
};
