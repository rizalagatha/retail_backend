// File: src/controllers/refundController.js
const refundService = require('../services/refundService');

// Controller untuk mendapatkan data master refund
exports.getMaster = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await refundService.getMaster(startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil data master refund.' });
  }
};

// Controller untuk mendapatkan data detail refund
exports.getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await refundService.getDetails(nomor);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil data detail refund.' });
  }
};

// Controller untuk menyimpan data refund
exports.saveRefund = async (req, res) => {
  try {
    const { data, user, isEdit, userRole } = req.body;
    const result = await refundService.saveRefund(data, user, isEdit, userRole);
    res.status(200).json({ message: 'Data refund berhasil disimpan.', nomor: result.nomor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal menyimpan data refund.' });
  }
};

// Controller untuk mendapatkan data form baru
exports.getNewData = async (req, res) => {
    try {
        const cabang = 'K01'; // Asumsi hardcode, sesuaikan dengan logic auth
        const data = await refundService.getNewRefundForm(cabang);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Gagal mendapatkan data form baru.' });
    }
};