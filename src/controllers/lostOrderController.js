const service = require("../services/lostOrderService");

const createLostOrder = async (req, res) => {
  try {
    const { produkNama, ukuran, qty } = req.body;

    // Validasi input wajib
    if (!produkNama || !ukuran || !qty) {
      return res.status(400).json({
        success: false,
        message: "Nama produk, ukuran, dan QTY wajib diisi.",
      });
    }

    const result = await service.createLostOrder(req.body, req.user);

    res.status(201).json({
      success: true,
      message: "Data Lost Order berhasil dicatat.",
      data: { insertId: result.insertId },
    });
  } catch (error) {
    console.error("Error createLostOrder:", error);
    res
      .status(500)
      .json({ success: false, message: "Gagal menyimpan data Lost Order." });
  }
};

const getLostOrders = async (req, res) => {
  try {
    const result = await service.getLostOrders(req.query, req.user);

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Error getLostOrders:", error);
    res
      .status(500)
      .json({ success: false, message: "Gagal mengambil data Lost Order." });
  }
};

module.exports = {
  createLostOrder,
  getLostOrders,
};
