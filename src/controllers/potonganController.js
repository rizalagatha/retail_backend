const potonganService = require("../services/potonganService");

// --- Lookup ---
const getCabangList = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.cabang) {
      return res.status(400).json({ message: "User atau cabang tidak valid." });
    }

    const data = await potonganService.getCabangList(user);
    res.status(200).json(data);
  } catch (error) {
    console.error("getCabangList error:", error.message);
    res.status(500).json({
      message: "Gagal mengambil daftar cabang.",
      error: error.message,
    });
  }
};

// --- List utama ---
const getPotonganList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
    };

    const data = await potonganService.getList(filters);
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Gagal mengambil daftar potongan.",
      error: error.message,
    });
  }
};

// === FUNGSI BARU UNTUK EXPANDED ROW ===
const getBrowseDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await potonganService.getBrowseDetails(nomor); // Memanggil service baru
    res.status(200).json(data);
  } catch (error) {
    console.error("getBrowseDetails error:", error.message);
    res.status(500).json({
      message: "Gagal mengambil detail browse potongan.",
      error: error.message,
    });
  }
};
// === BATAS FUNGSI BARU ===

// --- Detail (Untuk Halaman Edit) ---
const getPotonganDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    // PERBAIKAN: Memanggil 'getDetails' (sesuai service)
    const data = await potonganService.getDetails(nomor);
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Gagal mengambil detail potongan." });
  }
};

// --- Simpan (insert/update) ---
const savePotongan = async (req, res) => {
  try {
    const data = req.body;
    const user = req.user;
    const result = await potonganService.save(data, user);
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
};

// --- Hapus ---
const deletePotongan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user;
    const result = await potonganService.remove(nomor, user);
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
};

// --- Export ---
const exportPotonganDetails = async (req, res) => {
  try {
    const filters = req.query;
    // PERBAIKAN: Memanggil 'getExportDetails' (sesuai service)
    const data = await potonganService.getExportDetails(filters); // contoh response excel

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=potongan_export.xlsx"
    );
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Gagal mengekspor data potongan." });
  }
};

module.exports = {
  getCabangList,
  getPotonganList,
  getBrowseDetails, // <-- TAMBAHKAN FUNGSI BARU
  getPotonganDetails,
  savePotongan,
  deletePotongan,
  exportPotonganDetails,
};
