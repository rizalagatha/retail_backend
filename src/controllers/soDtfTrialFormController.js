const service = require("../services/soDtfTrialFormService");

const getById = async (req, res) => {
  try {
    const data = await service.findById(req.params.nomor);
    if (!data) {
      return res
        .status(404)
        .json({ message: "Data SO DTF Trial tidak ditemukan" });
    }
    res.json(data);
  } catch (error) {
    console.error("Error getById SO DTF Trial:", error);
    // [FIX] Lempar error.message biar kelihatan di frontend
    res
      .status(500)
      .json({ message: error.message || "Terjadi kesalahan server" });
  }
};

const create = async (req, res) => {
  try {
    const result = await service.create(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    console.error("Error create SO DTF Trial:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menyimpan SO DTF Trial" });
  }
};

const update = async (req, res) => {
  try {
    const result = await service.update(req.params.nomor, req.body, req.user);
    res.json(result);
  } catch (error) {
    console.error("Error update SO DTF Trial:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal mengupdate SO DTF Trial" });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file gambar" });
    }
    const { nomor, revisiKe } = req.params;

    const imageUrl = await service.processSoDtfImage(
      req.file.path,
      nomor,
      revisiKe,
    );
    res.json({ success: true, imageUrl });
  } catch (error) {
    console.error("Error upload image Trial:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Fungsi Lookup Standar ---
const searchSales = async (req, res) => {
  try {
    const { search, page = 1, itemsPerPage = 20 } = req.query;
    const result = await service.searchSales(
      search,
      parseInt(page),
      parseInt(itemsPerPage),
    );
    res.json(result);
  } catch (error) {
    console.error("Error searchSales:", error);
    res.status(500).json({ message: "Gagal mencari sales" });
  }
};

const searchJenisOrder = async (req, res) => {
  try {
    const { search } = req.query;
    const result = await service.searchJenisOrder(search);
    res.json(result);
  } catch (error) {
    console.error("Error searchJenisOrder:", error);
    res.status(500).json({ message: "Gagal mencari jenis order" });
  }
};

const searchJenisKain = async (req, res) => {
  try {
    const { search } = req.query;
    const result = await service.searchJenisKain(search);
    res.json(result);
  } catch (error) {
    console.error("Error searchJenisKain:", error);
    res.status(500).json({ message: "Gagal mencari kain" });
  }
};

const searchWorkshop = async (req, res) => {
  try {
    const { search } = req.query;
    const result = await service.searchWorkshop(search);
    res.json(result);
  } catch (error) {
    console.error("Error searchWorkshop:", error);
    res.status(500).json({ message: "Gagal mencari workshop" });
  }
};

const getUkuranKaos = async (req, res) => {
  try {
    const result = await service.getUkuranKaosList();
    res.json(result);
  } catch (error) {
    console.error("Error getUkuranKaos:", error);
    res.status(500).json({ message: "Gagal memuat list ukuran" });
  }
};

const getSizeCetak = async (req, res) => {
  try {
    const result = await service.getSizeCetakList(req.query.jenisOrder);
    res.json(result);
  } catch (error) {
    console.error("Error getSizeCetak:", error);
    res.status(500).json({ message: "Gagal memuat size cetak" });
  }
};

const getUkuranDetail = async (req, res) => {
  try {
    const { jenisOrder, ukuran } = req.query;
    const result = await service.getUkuranSodtfDetail(jenisOrder, ukuran);
    res.json(result || { panjang: 0, lebar: 0 });
  } catch (error) {
    console.error("Error getUkuranDetail:", error);
    res.status(500).json({ message: "Gagal memuat detail ukuran" });
  }
};

const calculateDtgPrice = async (req, res) => {
  try {
    const { detailsTitik, totalJumlahKaos } = req.body;
    const harga = await service.calculateDtgPrice(
      detailsTitik,
      totalJumlahKaos,
    );
    res.json({ harga });
  } catch (error) {
    console.error("Error calculateDtgPrice:", error);
    res.status(500).json({ message: "Gagal hitung harga DTG" });
  }
};

const searchSoList = async (req, res) => {
  try {
    const { search, cabang, page = 1, itemsPerPage = 20 } = req.query;
    const userCabang = cabang || req.user.cabang;
    const result = await service.searchSoForDtf(
      search,
      userCabang,
      parseInt(page),
      parseInt(itemsPerPage),
    );
    res.json(result);
  } catch (error) {
    console.error("Error searchSoList:", error);
    res.status(500).json({ message: "Gagal mencari daftar SO" });
  }
};

const getSoDetail = async (req, res) => {
  try {
    const result = await service.getSoDetailForDtf(req.params.nomor);
    if (!result) return res.status(404).json({ message: "SO tidak ditemukan" });
    res.json(result);
  } catch (error) {
    console.error("Error getSoDetail:", error);
    res.status(500).json({ message: "Gagal mengambil detail SO" });
  }
};

module.exports = {
  getById,
  create,
  update,
  uploadImage,
  searchSales,
  searchJenisOrder,
  searchJenisKain,
  searchWorkshop,
  getUkuranKaos,
  getSizeCetak,
  getUkuranDetail,
  calculateDtgPrice,
  searchSoList,
  getSoDetail,
};
