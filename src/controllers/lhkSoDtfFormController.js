const lhkSoDtfFormService = require("../services/lhkSoDtfFormService");

const loadData = async (req, res) => {
  try {
    // Ambil nomorLhk dari parameter URL (misal: /detail/:nomorLhk)
    const { nomorLhk } = req.params;

    if (!nomorLhk) {
      return res.status(400).json({ message: "Nomor LHK diperlukan." });
    }

    const data = await lhkSoDtfFormService.loadData(nomorLhk);
    res.json(data);
  } catch (error) {
    console.error("❌ ERROR loadData:", error);
    res.status(500).json({ message: error.message });
  }
};

const getJenisOrder = async (req, res) => {
  try {
    const { term } = req.query;
    const result = await lhkSoDtfFormService.getJenisOrderList(term);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSoPo = async (req, res) => {
  try {
    // Tangkap 'prefix' dari query string (dikirim frontend berdasarkan jenis order terpilih)
    const { term, cabang, tipe, prefix, page = 1, limit = 50 } = req.query;

    if (!cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }

    const result = await lhkSoDtfFormService.searchSoPo(
      term,
      cabang,
      tipe,
      prefix, // <--- Kirim ke service
      page,
      limit,
    );

    res.json(result);
  } catch (error) {
    console.error("❌ Error searchSoPo:", error);
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await lhkSoDtfFormService.saveData(req.body, req.user);

    // Opsional: Gunakan status 200 jika update, 201 jika data baru
    const statusCode = req.body.isEdit ? 200 : 201;
    res.status(statusCode).json(result);
  } catch (error) {
    console.error("❌ Error saveData LHK:", error);
    res.status(500).json({ message: error.message });
  }
};

const removeData = async (req, res) => {
  try {
    // Ambil nomorLhk dari parameter URL (misal: DELETE /:nomorLhk)
    const { nomorLhk } = req.params;

    if (!nomorLhk) {
      return res
        .status(400)
        .json({ message: "Nomor LHK diperlukan untuk penghapusan." });
    }

    const result = await lhkSoDtfFormService.removeData(nomorLhk);
    res.json(result);
  } catch (error) {
    console.error("❌ Error removeData LHK:", error);
    res.status(400).json({ message: error.message });
  }
};

const getSpecs = async (req, res) => {
  try {
    const { nomorSo } = req.params;
    const result = await lhkSoDtfFormService.getSoDtfSpecs(nomorSo);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadBuktiRipping = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diunggah." });
    }

    // Kita butuh Nomor LHK (sementara atau sudah jadi) dan cabang dari request
    // Karena saat create LHK baru nomornya belum ada, Frontend harus mengirim "KODE SEMENTARA"
    // atau Frontend harus SIMPAN LHK dulu, baru upload gambarnya.
    const { nomorLhk, cabang } = req.body;

    if (!nomorLhk || !cabang) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ message: "Data nomor LHK atau cabang tidak lengkap." });
    }

    const finalPath = await lhkSoDtfFormService.processLhkRippingImage(
      req.file.path,
      nomorLhk,
      cabang,
    );

    const safeFileName = nomorLhk.replace(/\./g, "_") + ".jpg";
    // Path public yang bisa diakses via browser
    const imageUrl = `/images/lhk-dtf/${cabang}/${safeFileName}`;

    res.status(200).json({
      success: true,
      message: "Bukti ripping berhasil diunggah.",
      imageUrl: imageUrl,
    });
  } catch (error) {
    console.error("UPLOAD BUKTI RIPPING ERROR:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  loadData,
  searchSoPo,
  saveData,
  removeData,
  getSpecs,
  getJenisOrder,
  uploadBuktiRipping,
};
