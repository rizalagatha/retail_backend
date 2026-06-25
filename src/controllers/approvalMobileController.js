const service = require("../services/approvalMobileService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const approveDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    // Mengambil user_kode dari token JWT yang login di Web (Bisa req.user.user_kode atau req.user.kode tergantung setup Anda)
    const approver = req.user.user_kode || req.user.kode || "SYSTEM";

    const result = await service.approveDevice(deviceId, approver);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const rejectDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const approver = req.user.user_kode || req.user.kode || "SYSTEM";

    const result = await service.rejectDevice(deviceId, approver);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  approveDevice,
  rejectDevice,
};
