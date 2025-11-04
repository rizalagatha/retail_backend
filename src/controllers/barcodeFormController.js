const barcodeFormService = require("../services/barcodeFormService");

const getNextNumber = async (req, res) => {
  try {
    const { cabang, tanggal } = req.query;
    if (!cabang || !tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan tanggal diperlukan." });
    }
    const nextNumber = await barcodeFormService.getNextBarcodeNumber(
      cabang,
      tanggal
    );
    res.json({ nextNumber });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchProducts = async (req, res) => {
  try {
    // Ambil semua parameter dari query string
    const { term, category, gudang, page, itemsPerPage } = req.query;

    // 1. Tambahkan validasi untuk parameter yang wajib ada
    if (!gudang || !category) {
      return res
        .status(400)
        .json({ message: "Parameter gudang dan kategori diperlukan." });
    }

    // 2. Berikan nilai default untuk paginasi jika tidak ada
    const pageNumber = parseInt(page, 10) || 1;
    const limit = parseInt(itemsPerPage, 10) || 10;

    const result = await barcodeFormService.searchProducts(
      term || "",
      category,
      gudang,
      pageNumber,
      limit
    );

    res.json(result);
  } catch (error) {
    // Tambahkan logging untuk melihat error detail di terminal backend
    console.error("Error in searchProducts controller:", error);
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { productCode } = req.params;
    const details = await barcodeFormService.getProductDetails(productCode);
    res.json(details);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await barcodeFormService.saveBarcode(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchMaster = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const result = await barcodeFormService.searchMaster(
      term,
      Number(page),
      Number(itemsPerPage)
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params; // <-- Ganti ke req.params
    if (!barcode) {
      return res.status(400).json({ message: 'Parameter barcode diperlukan.' });
    }
    const product = await barcodeFormService.findByBarcode(barcode);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message || 'Error mencari barcode' });
  }
};

module.exports = {
  getNextNumber,
  searchProducts,
  getProductDetails,
  save,
  searchMaster,
  findByBarcode,
};
