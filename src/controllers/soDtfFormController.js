const soDtfFormService = require("../services/soDtfFormService");
const fs = require("fs");
const path = require("path");

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;

    const data = await soDtfFormService.findById(nomor);
    if (!data) {
      return res.status(404).json({ message: "Data tidak ditemukan" });
    }

    res.json(data);
  } catch (error) {
    console.error("Error in getById:", error); // DEBUG
    res.status(500).json({ message: error.message });
  }
};

const create = async (req, res) => {
  try {
    // user didapat dari middleware verifyToken
    const user = req.user;
    const newData = await soDtfFormService.create(req.body, user);
    res.status(201).json(newData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user;

    // Service sekarang mengembalikan data lengkap termasuk header dengan imageUrl
    const updatedData = await soDtfFormService.update(nomor, req.body, user);

    res.json({
      message: "Data berhasil diperbarui",
      data: updatedData, // Langsung kirim respons dari service
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSales = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const data = await soDtfFormService.searchSales(
      term,
      parseInt(page),
      parseInt(itemsPerPage)
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchJenisOrder = async (req, res) => {
  try {
    const { term } = req.query;
    const data = await soDtfFormService.searchJenisOrder(term);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchJenisKain = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const data = await soDtfFormService.searchJenisKain(
      term,
      parseInt(page),
      parseInt(itemsPerPage)
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchWorkshop = async (req, res) => {
  try {
    const { term } = req.query;
    const data = await soDtfFormService.searchWorkshop(term);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSisaKuota = async (req, res) => {
  try {
    const { cabang, tanggalKerja } = req.query;
    if (!cabang || !tanggalKerja) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan tanggal kerja diperlukan." });
    }
    const sisa = await soDtfFormService.getSisaKuota(cabang, tanggalKerja);
    res.json({ sisaKuota: sisa });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }

    const { nomor } = req.params;
    if (!nomor) {
      // Hapus file temp jika nomor tidak ada
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "Nomor SO DTF diperlukan." });
    }

    // Proses gambar (rename & pindah ke folder cabang)
    const finalPath = await soDtfFormService.processSoDtfImage(
      req.file.path,
      nomor
    );

    // Buat URL yang bisa diakses frontend
    const cabang = nomor.substring(0, 3);
    const fileExtension = path.extname(req.file.originalname);
    const imageUrl = `/images/${cabang}/${nomor}${fileExtension}`;

    res.status(200).json({
      success: true,
      message: "Gambar berhasil diunggah.",
      filePath: finalPath,
      imageUrl: imageUrl,
      nomor: nomor,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);

    // Hapus file temp jika ada error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Failed to cleanup temp file:", cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || "Gagal mengunggah gambar.",
    });
  }
};

const getUkuranKaos = async (req, res) => {
  try {
    const data = await soDtfFormService.getUkuranKaosList();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getUkuranSodtfDetail = async (req, res) => {
  try {
    const { jenisOrder, ukuran } = req.query;
    if (!jenisOrder || !ukuran) {
      return res
        .status(400)
        .json({ message: "Parameter jenisOrder dan ukuran diperlukan." });
    }
    const data = await soDtfFormService.getUkuranSodtfDetail(
      jenisOrder,
      ukuran
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const calculateDtgPrice = async (req, res) => {
  try {
    const { detailsTitik, totalJumlahKaos } = req.body;
    if (!detailsTitik || totalJumlahKaos === undefined) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const harga = await soDtfFormService.calculateDtgPrice(
      detailsTitik,
      totalJumlahKaos
    );
    res.json({ harga });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSizeCetak = async (req, res) => {
  try {
    const { jenisOrder } = req.query;
    if (!jenisOrder) {
      return res
        .status(400)
        .json({ message: "Parameter jenisOrder diperlukan." });
    }
    const data = await soDtfFormService.getSizeCetakList(jenisOrder);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soDtfFormService.getDataForPrint(nomor);
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

const searchSoForDtf = async (req, res) => {
  try {
    const { term = "", cabang, page = 1, itemsPerPage = 15 } = req.query;

    const result = await soDtfFormService.searchSoForDtf(
      term,
      cabang,
      Number(page),
      Number(itemsPerPage)
    );

    res.json({
      items: result.items,
      total: result.total,
    });
  } catch (error) {
    console.error("Error search SO for DTF:", error);
    res.status(500).json({ message: "Gagal memuat daftar SO DTF." });
  }
};

const getSoDetailForDtf = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await soDtfFormService.getSoDetailForDtf(nomor);
    if (!result) {
      return res.status(404).json({ message: "Nomor SO tidak ditemukan." });
    }
    res.json(result);
  } catch (error) {
    console.error("Error get SO detail for DTF:", error);
    res.status(500).json({ message: "Gagal memuat detail SO DTF." });
  }
};

module.exports = {
  getById,
  create,
  update,
  searchSales,
  searchJenisOrder,
  searchJenisKain,
  searchWorkshop,
  getSisaKuota,
  uploadImage,
  getUkuranKaos,
  getUkuranSodtfDetail,
  calculateDtgPrice,
  getSizeCetak,
  getPrintData,
  searchSoForDtf,
  getSoDetailForDtf,
};
