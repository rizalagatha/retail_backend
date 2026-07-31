const priceProposalFormService = require("../services/priceProposalFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot
const fs = require("fs");
const path = require("path");

const getNextNumber = async (req, res) => {
  try {
    const { cabang, tanggal } = req.query;
    if (!cabang || !tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan tanggal diperlukan." });
    }
    const nextNumber = await priceProposalFormService.generateNewProposalNumber(
      cabang,
      tanggal,
    );
    res.json({ nextNumber });
  } catch (error) {
    res.status(500).json({ message: "Gagal membuat nomor baru." });
  }
};

const searchTshirtTypes = async (req, res) => {
  try {
    const { term, custom } = req.query;
    const types = await priceProposalFormService.searchTshirtTypes(
      term,
      custom,
    );
    res.json(types);
  } catch (error) {
    res.status(500).json({ message: "Gagal mencari jenis kaos." });
  }
};

const getTshirtTypeDetails = async (req, res) => {
  try {
    const { jenisKaos, custom } = req.query;
    if (!jenisKaos || !custom) {
      return res
        .status(400)
        .json({ message: "Parameter jenisKaos dan custom diperlukan." });
    }
    const details = await priceProposalFormService.getTshirtTypeDetails(
      jenisKaos,
      custom,
    );
    res.json(details);
  } catch (error) {
    res.status(500).json({ message: "Gagal mengambil detail jenis kaos." });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }

    const { nomor } = req.params;
    if (!nomor) {
      const fs = require("fs");
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "Nomor pengajuan diperlukan." });
    }

    const finalPath = await priceProposalFormService.renameProposalImage(
      req.file.path,
      nomor,
    );

    const cabang = nomor.substring(0, 3); // ← TAMBAH
    const timeStamp = Date.now();
    const imageUrl = `/images/${cabang}/${nomor}${path.extname(req.file.originalname)}?t=${timeStamp}`; // ← path relatif

    res.status(200).json({
      message: "Gambar berhasil diunggah.",
      filePath: finalPath,
      imageUrl: imageUrl,
    });
  } catch (error) {
    console.error("Upload Image Error:", error);

    if (req.file && req.file.path) {
      try {
        const fs = require("fs");
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Error cleaning up temp file:", cleanupError);
      }
    }

    res.status(500).json({ message: error.message });
  }
};

const getDiscount = async (req, res) => {
  try {
    const { bruto } = req.query;
    const diskonRp = await priceProposalFormService.getDiscountByBruto(bruto);
    res.json({ diskonRp });
  } catch (error) {
    res.status(500).json({ message: "Gagal menghitung diskon otomatis." });
  }
};

const searchProductsByType = async (req, res) => {
  try {
    const { jenisKaos } = req.query;
    const products =
      await priceProposalFormService.searchProductsByType(jenisKaos);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Gagal mencari produk." });
  }
};

const searchAdditionalCosts = async (req, res) => {
  try {
    const costs = await priceProposalFormService.searchAdditionalCosts();
    res.json(costs);
  } catch (error) {
    res.status(500).json({ message: "Gagal mencari biaya tambahan." });
  }
};

const getForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await priceProposalFormService.getProposalForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const uploadAccCustomerProof = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }
    const { nomor } = req.params;
    if (!nomor) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "Nomor pengajuan diperlukan." });
    }

    await priceProposalFormService.renameAccCustomerProof(req.file.path, nomor);

    const cabang = nomor.substring(0, 3);
    const imageUrl = `/images/${cabang}/acc-customer/${nomor}${path.extname(
      req.file.originalname,
    )}?t=${Date.now()}`;

    res
      .status(200)
      .json({ message: "Bukti Acc Customer berhasil diunggah.", imageUrl });
  } catch (error) {
    console.error("Upload Acc Customer Proof Error:", error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({ message: error.message });
  }
};

const getSublimKainOptions = async (req, res) => {
  try {
    res.json(await priceProposalFormService.getSublimKainOptions());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSublimJenisJerseyOptions = async (req, res) => {
  try {
    const { kain } = req.query;
    if (!kain) return res.status(400).json({ message: "kain diperlukan." });
    res.json(await priceProposalFormService.getSublimJenisJerseyOptions(kain));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSublimKatalog = async (req, res) => {
  try {
    res.json(await priceProposalFormService.getSublimKatalog());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const previewSublimHarga = async (req, res) => {
  try {
    res.json(await priceProposalFormService.previewSublimHarga(req.body));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getSublimKatalogByKategori = async (req, res) => {
  try {
    const { jeniskaos, lengan } = req.query;
    if (!jeniskaos || !lengan)
      return res
        .status(400)
        .json({ message: "jeniskaos dan lengan diperlukan." });
    res.json(
      await priceProposalFormService.getSublimKatalogByKategori(
        jeniskaos,
        lengan,
      ),
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Upload gambar desain sublim custom (bukan pilih dari katalog). Reuse pola
 * upload gambar existing (multer + rename by nomor), disimpan terpisah
 * dengan suffix -sublim biar gak nabrak file gambar utama header.
 */
const uploadSublimDesign = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    const { nomor } = req.params;
    const cabang = nomor.substring(0, 3);
    const path = require("path");
    const fs = require("fs");

    const folderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang,
      "sublim-custom",
    );
    fs.mkdirSync(folderPath, { recursive: true });
    const finalFileName = `${nomor}${path.extname(req.file.originalname)}`;
    const finalPath = path.join(folderPath, finalFileName);

    fs.renameSync(req.file.path, finalPath);
    const imageUrl = `/images/${cabang}/sublim-custom/${finalFileName}?t=${Date.now()}`;

    res.json({ message: "Desain custom berhasil diunggah.", imageUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;
    payload.user = req.user;

    const result = await priceProposalFormService.saveProposal(payload);

    res.status(payload.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getNextNumber,
  searchTshirtTypes,
  getTshirtTypeDetails,
  uploadImage,
  getDiscount,
  searchProductsByType,
  searchAdditionalCosts,
  getForEdit,
  uploadAccCustomerProof,
  getSublimKainOptions,
  getSublimJenisJerseyOptions,
  getSublimKatalog,
  previewSublimHarga,
  getSublimKatalogByKategori,
  uploadSublimDesign,
  save,
};
