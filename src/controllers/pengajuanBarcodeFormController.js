const service = require("../services/pengajuanBarcodeFormService");
const fs = require("fs");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    // Langsung teruskan semua filter dari query ke service
    const data = await service.lookupProducts(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getJenisReject = async (req, res) => {
  try {
    const data = await service.getJenisReject();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    // Validasi parameter yang dibutuhkan
    const { kode, ukuran, gudang } = req.query;
    if (!kode || !ukuran || !gudang) {
      return res
        .status(400)
        .json({ message: "Parameter tidak lengkap (kode, ukuran, gudang)." });
    }
    const data = await service.getProductDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupStickers = async (req, res) => {
  try {
    const data = await service.lookupStickers(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForBarcodePrint = async (req, res) => {
  try {
    // Ambil 'nomor' dari parameter URL (req.params)
    const { nomor } = req.params;
    if (!nomor) {
      return res.status(400).json({ message: "Nomor dokumen diperlukan." });
    }
    const data = await service.getDataForBarcodePrint(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const uploadItemImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }

    // Ambil data dari form-data body
    const { nomor, kode, ukuran } = req.body;
    if (!nomor || !kode || !ukuran) {
      // Hapus file temp jika data tidak lengkap
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res
        .status(400)
        .json({ message: "Informasi item (nomor, kode, ukuran) diperlukan." });
    }

    // Panggil service baru
    const { imageUrl } = await service.processItemImage(
      req.file.path,
      nomor,
      kode,
      ukuran
    );

    res.status(200).json({
      success: true,
      message: "Gambar item berhasil diunggah.",
      imageUrl: imageUrl,
    });
  } catch (error) {
    console.error("UPLOAD ITEM IMAGE ERROR:", error);
    // Hapus file temp jika ada error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Gagal membersihkan temp file:", cleanupError);
      }
    }
    res.status(500).json({
      success: false,
      message: error.message || "Gagal mengunggah gambar item.",
    });
  }
};

module.exports = {
  getForEdit,
  save,
  lookupProducts,
  getJenisReject,
  getProductDetails,
  lookupStickers,
  getDataForBarcodePrint,
  uploadItemImage,
};
