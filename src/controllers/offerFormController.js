const offerFormService = require("../services/offerFormService");

const getNextNumber = async (req, res) => {
  try {
    const { cabang, tanggal } = req.query;
    if (!cabang || !tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan tanggal diperlukan." });
    }
    const nextNumber = await offerFormService.generateNewOfferNumber(
      cabang,
      tanggal
    );
    res.json({ nextNumber });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchCustomers = async (req, res) => {
  try {
    // 1. Ambil parameter paginasi dan pencarian dari query string
    const { term, gudang, page, itemsPerPage } = req.query;

    // Perbaikan: Tambahkan nilai default untuk paginasi
    const pageNumber = parseInt(page, 10) || 1;
    const limit = parseInt(itemsPerPage, 10) || 10;

    // 2. Panggil service dengan semua parameter yang diperlukan
    const result = await offerFormService.searchCustomers(
      term || "",
      gudang,
      pageNumber,
      limit
    );

    // 3. Kirim kembali data dalam format { items, total } yang diharapkan frontend
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCustomerDetails = async (req, res) => {
  try {
    const { kode } = req.params;
    const details = await offerFormService.getCustomerDetails(kode);
    if (details) {
      res.json(details);
    } else {
      res.status(404).json({ message: "Customer tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveOffer = async (req, res) => {
  try {
    const result = await offerFormService.saveOffer(req.body);
    console.log("Data yang dikirim ke frontend:", result);
    // Gunakan status 201 untuk data baru, 200 untuk update
    const statusCode = req.body.isNew ? 201 : 200;
    res.status(statusCode).json(result);
  } catch (error) {
    console.error("Error saving offer:", error);
    // Kirim pesan error yang lebih spesifik dari service
    res
      .status(500)
      .json({ message: error.message || "Gagal menyimpan penawaran." });
  }
};

const getDefaultDiscount = async (req, res) => {
  try {
    const { level, total, gudang } = req.query;

    // Panggil Service
    // parseFloat(total) digunakan untuk memastikan input string "10000" jadi number 10000
    const result = await offerFormService.getDefaultDiscount(
      level,
      parseFloat(total),
      gudang
    );

    // Kirim response { discount: ... }
    res.status(200).json(result);
  } catch (error) {
    console.error("Error di Controller getDefaultDiscount:", error);
    res.status(500).json({
      message: "Gagal mengambil data diskon default",
      error: error.message,
    });
  }
};

const getDetailsForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getOfferForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const searchSoDtf = async (req, res) => {
  try {
    const { cabang, customerKode } = req.query;
    if (!cabang || !customerKode) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan customer diperlukan." });
    }
    const data = await offerFormService.searchAvailableSoDtf(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDtfDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getSoDtfDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchPriceProposals = async (req, res) => {
  try {
    const { cabang, customerKode } = req.query;
    if (!cabang || !customerKode) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan customer diperlukan." });
    }
    const data = await offerFormService.searchApprovedPriceProposals(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPriceProposalDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getPriceProposalDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getDataForPrint(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ message: "Data penawaran tidak ditemukan." });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query; // Gudang diambil dari query parameter
    if (!gudang) {
      return res.status(400).json({ message: "Parameter gudang diperlukan." });
    }
    const product = await offerFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getNextNumber,
  searchCustomers,
  getCustomerDetails,
  saveOffer,
  getDefaultDiscount,
  getDetailsForEdit,
  searchSoDtf,
  getSoDtfDetails,
  searchPriceProposals,
  getPriceProposalDetails,
  getPrintData,
  getByBarcode,
};
