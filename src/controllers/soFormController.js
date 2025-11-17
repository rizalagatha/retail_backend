const soFormService = require("../services/soFormService");

const getForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    // Panggil fungsi service yang sudah kita buat
    const data = await soFormService.getSoForEdit(nomor);
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ message: "Data Surat Pesanan tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await soFormService.save(req.body, req.user);
    res.status(req.body.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchPenawaran = async (req, res) => {
  try {
    const data = await soFormService.searchAvailablePenawaran(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPenawaranDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soFormService.getPenawaranDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDefaultDiscount = async (req, res) => {
  try {
    const { level, total, gudang } = req.query;
    const levelCode = level ? level.split(" - ")[0] : "";
    const result = await soFormService.getDefaultDiscount(
      levelCode,
      total,
      gudang
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSetoran = async (req, res) => {
  try {
    const data = await soFormService.searchAvailableSetoran(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveDp = async (req, res) => {
  try {
    const result = await soFormService.saveNewDp(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchRekening = async (req, res) => {
  try {
    const data = await soFormService.searchRekening(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDpPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soFormService.getDataForDpPrint(nomor);
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
    const product = await soFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchJenisOrder = async (req, res) => {
  try {
    const term = req.query.term || "";
    const result = await soFormService.searchJenisOrder(term);
    res.json(result);
  } catch (error) {
    console.error("searchJenisOrder error:", error);
    res.status(500).json({ message: error.message });
  }
};

const hitungHarga = async (req, res) => {
  try {
    const result = await soFormService.hitungHarga(req.body);
    res.json({ items: result });
  } catch (error) {
    console.error("hitungHarga error:", error);
    res.status(500).json({ message: error.message });
  }
};

const calculateHargaCustom = async (req, res) => {
  try {
    const result = await soFormService.calculateHargaCustom(req.body);
    res.json(result);
  } catch (error) {
    console.error("Error calculateHargaCustom:", error);
    res.status(500).json({ message: "Gagal menghitung harga custom" });
  }
};

const deleteDp = async (req, res) => {
  try {
    const { nomor } = req.body;
    const result = await soFormService.deleteDp(nomor);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  searchPenawaran,
  getPenawaranDetails,
  getDefaultDiscount,
  searchSetoran,
  saveDp,
  searchRekening,
  getDpPrintData,
  getByBarcode,
  searchJenisOrder,
  hitungHarga,
  calculateHargaCustom,
  deleteDp,
};
