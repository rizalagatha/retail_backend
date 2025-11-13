const service = require("../services/barangDcFormService");

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.kode);
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
    res.status(400).json({ message: error.message });
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

    const { kode } = req.params;

    if (!kode) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: "Kode barang diperlukan.",
      });
    }

    const imageUrl = await service.uploadImage(kode, req.file);

    res.json({
      success: true,
      imageUrl,
      message: "Gambar berhasil diunggah.",
    });
  } catch (error) {
    console.error("Upload image error:", error);

    // Cleanup file temp
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: error.message || "Gagal mengupload gambar.",
    });
  }
};

const searchWarnaKain = async (req, res) => {
  try {
    // req.query akan berisi { term, page, itemsPerPage }
    const data = await service.searchWarnaKain(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBuffer = async (req, res) => {
  try {
    const data = await service.getBuffer(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getNextBcdId = async (req, res) => {
  try {
    const nextId = await service.getNextBcdId();
    res.json({ success: true, nextId });
  } catch (error) {
    console.error('Error getNextBcdId:', error);
    res.status(500).json({ success: false, message: 'Gagal generate ID barcode.' });
  }
};

module.exports = {
  getInitialData,
  getForEdit,
  save,
  uploadImage,
  searchWarnaKain,
  getBuffer,
  getNextBcdId,
};
