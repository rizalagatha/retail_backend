const upload = require("../middleware/uploadMiddleware");
const soDtfStokFormService = require("../services/soDtfStokFormService");
const fs = require("fs");
const path = require('path');

const getTemplateItems = async (req, res) => {
  try {
    const { jenisOrder } = req.params;
    const data = await soDtfStokFormService.getTemplateItems(jenisOrder);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadDataForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soDtfStokFormService.loadDataForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const { nomor } = req.params; // Bisa undefined untuk data baru
    const result = await soDtfStokFormService.saveData(
      nomor,
      req.body,
      req.user
    );
    res.status(nomor ? 200 : 201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchJenisOrderStok = async (req, res) => {
  try {
    const { term } = req.query;
    const data = await soDtfStokFormService.searchJenisOrderStok(term);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Tidak ada file yang diunggah.",
      });
    }

    const { nomor } = req.params;
    if (!nomor) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: "Nomor SO DTF Stok diperlukan.",
      });
    }

    // Proses gambar (rename & pindah ke folder cabang)
    await soDtfStokFormService.processSoDtfStokImage(req.file.path, nomor);

    // Tentukan URL gambar yang akan dikembalikan
    const cabang = nomor.substring(0, 3);
    const ext = path.extname(req.file.originalname);
    const imageUrl = `/images/${cabang}/${nomor}${ext}`;

    res.status(200).json({
      success: true,
      message: "Gambar berhasil diunggah.",
      imageUrl, // Frontend expect 'imageUrl', bukan 'filePath'
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soDtfStokFormService.getDataForPrint(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ message: "Data untuk dicetak tidak ditemukan." });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getTemplateItems,
  loadDataForEdit,
  saveData,
  searchJenisOrderStok,
  uploadImage,
  getPrintData,
};
