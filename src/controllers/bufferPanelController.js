const bufferPanelService = require("../services/bufferPanelService");

const getPreview = async (req, res, next) => {
  try {
    const cabang = req.query.cabang || req.user.cabang;

    const data =
      cabang === "KDC"
        ? await bufferPanelService.getPreviewDataKDC()
        : await bufferPanelService.getPreviewData(cabang);

    res.json(data);
  } catch (error) {
    next(error);
  }
};

const getDetailSpk = async (req, res, next) => {
  try {
    const { kode, ukuran } = req.query;
    const data = await bufferPanelService.getDetailSpkByItem(kode, ukuran);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const saveSettings = async (req, res, next) => {
  try {
    const cabang = req.query.cabang || req.body.cabang || req.user.cabang;
    const itemsArray = req.body.items;
    const userKode = req.user.kode;

    if (!itemsArray || itemsArray.length === 0) {
      return res
        .status(400)
        .json({ message: "Data kalkulasi kosong. Tidak ada yang disimpan." });
    }

    // Kondisi untuk memisahkan penyimpanan buffer cabang vs KDC Pusat
    const result =
      cabang === "KDC"
        ? await bufferPanelService.saveCalculatedBufferKDC(itemsArray)
        : await bufferPanelService.saveCalculatedBuffer(
            cabang,
            itemsArray,
            userKode,
          );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

// --- [BARU] FUNGSI UNTUK CONFIG/RESEP ---

const getConfig = async (req, res, next) => {
  try {
    const cabang = req.query.cabang || req.user.cabang;

    // Panggil fungsi getConfig dari Service
    const configData = await bufferPanelService.getConfig(cabang);

    res.json(configData);
  } catch (error) {
    next(error);
  }
};

const saveConfig = async (req, res, next) => {
  try {
    // Ambil cabang dari request body, fallback ke cabang user login
    const cabang = req.body.cabang || req.user.cabang;

    // req.body berisi objek cfg { leadTime, threshold, weightTerkini, dll... }
    const cfg = req.body;

    // Ambil kode user yang melakukan perubahan (untuk log user_update)
    const user = req.user.kode;

    // Panggil fungsi saveConfig dari Service
    const result = await bufferPanelService.saveConfig(cabang, cfg, user);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const getStokPerCabang = async (req, res, next) => {
  try {
    const { kode, ukuran } = req.query;
    if (!kode || !ukuran)
      return res.status(400).json({ message: "Kode dan ukuran wajib diisi." });
    const data = await bufferPanelService.getStokPerCabang(kode, ukuran);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const getSesionalItems = async (req, res, next) => {
  try {
    const cabang = req.query.cabang || req.user.cabang;
    const data = await bufferPanelService.getSesionalItems(cabang);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const saveSesionalItems = async (req, res, next) => {
  try {
    const cabang = req.body.cabang || req.user.cabang;
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Data sesional kosong." });
    }

    const result = await bufferPanelService.saveSesionalItems(cabang, items);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const triggerGenerateLog = async (req, res, next) => {
  try {
    const result = await bufferPanelService.generateMonthlyLog();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPreview,
  getDetailSpk,
  saveSettings,
  getConfig,
  saveConfig,
  getStokPerCabang,
  getSesionalItems,
  saveSesionalItems,
  triggerGenerateLog,
};
