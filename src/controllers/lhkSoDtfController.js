const lhkSoDtfService = require("../services/lhkSoDtfService");

const getAll = async (req, res) => {
  try {
    const data = await lhkSoDtfService.getLhkList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetailList = async (req, res) => {
  try {
    const { nomorLhk } = req.params;
    const data = await lhkSoDtfService.getLhkDetail(nomorLhk);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await lhkSoDtfService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    // [FIX] Ambil string nomorLhk dari params, bukan mengirim objek req.params
    const { nomorLhk } = req.params;

    if (!nomorLhk) {
      return res
        .status(400)
        .json({ message: "Nomor LHK tidak ditemukan di URL." });
    }

    const result = await lhkSoDtfService.remove(nomorLhk, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetailList,
  getCabangList,
  remove,
};
