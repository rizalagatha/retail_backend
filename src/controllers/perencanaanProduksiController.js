const perencanaanProduksiService = require("../services/perencanaanProduksiService");

// Ganti fungsi getPriorityList dengan ini
const getPriorityList = async (req, res) => {
  try {
    const filters = {
      kategori: req.query.kategori,
      keyword: req.query.keyword,
      page: req.query.page || 1,
      itemsPerPage: req.query.itemsPerPage || 50,
    };

    const result = await perencanaanProduksiService.getPriorityData(filters);
    res.json({ success: true, data: result.data, summary: result.summary });
  } catch (error) {
    console.error("Error in getPriorityList:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStoreDetails = async (req, res) => {
  try {
    const { kode, ukuran } = req.query;
    if (!kode || !ukuran) {
      return res
        .status(400)
        .json({ success: false, message: "Kode dan ukuran diperlukan." });
    }

    const data = await perencanaanProduksiService.getStoreDetails(kode, ukuran);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error in getStoreDetails:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const generateBulkSpk = async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada data SPK yang dikirim." });
    }

    const result = await perencanaanProduksiService.generateBulkSpk(
      items,
      req.user,
    );
    res.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Error in generateBulkSpk:", error);
    res
      .status(500)
      .json({ success: false, message: "Gagal memproses SPK Masal." });
  }
};

const getKepentinganOptions = async (req, res) => {
  try {
    const data = await perencanaanProduksiService.getKepentinganOptions();
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error in getKepentinganOptions:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDatelineRange = async (req, res) => {
  try {
    const { kepentingan, joKode } = req.query;
    if (!kepentingan || !joKode) {
      return res.status(400).json({
        success: false,
        message: "Kepentingan dan joKode diperlukan.",
      });
    }
    const range = await perencanaanProduksiService.getDatelineRange(
      kepentingan,
      joKode,
    );
    res.json({ success: true, ...range });
  } catch (error) {
    console.error("Error in getDatelineRange:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPriorityList,
  getStoreDetails,
  generateBulkSpk,
  getKepentinganOptions,
  getDatelineRange,
};
