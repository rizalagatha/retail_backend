const service = require("../services/setoranBayarFormService");

const loadForEdit = async (req, res) => {
  try {
    const data = await service.loadForEdit(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchUnpaidInvoices = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10, customerKode } = req.query;
    if (!customerKode) {
      return res.status(400).json({ message: "Kode customer diperlukan." });
    }

    const result = await service.searchUnpaidInvoices(
      term,
      Number(page),
      Number(itemsPerPage),
      customerKode,
      req.user
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchSoForSetoran = async (req, res) => {
  try {
    const {
      customer,
      cabang,
      term = "",
      page = 1,
      itemsPerPage = 10,
    } = req.query;

    if (!customer) {
      return res
        .status(400)
        .json({ message: "Parameter 'customer' wajib diisi." });
    }

    const result = await service.searchSoForSetoran({
      customer,
      cabang,
      term,
      page: Number(page),
      itemsPerPage: Number(itemsPerPage),
    });

    res.json(result);
  } catch (error) {
    console.error("searchSoForSetoran error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getSoDetails = async (req, res) => {
  try {
    const nomorSo = req.params.nomor;
    if (!nomorSo)
      return res.status(400).json({ message: "Nomor SO diperlukan." });

    const data = await service.getSoDetails(nomorSo, req.user);
    if (!data) return res.status(404).json({ message: "SO tidak ditemukan." });

    res.json(data);
  } catch (error) {
    console.error("getSoDetails error:", error);
    res.status(500).json({ message: "Gagal memuat data SO." });
  }
};

const getInvoicesFromSo = async (req, res) => {
  try {
    const nomorSo = req.query.nomorSo;
    if (!nomorSo) return res.status(400).json({ message: "Nomor SO diperlukan." });

    const result = await service.getInvoicesFromSo(nomorSo);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Gagal mengambil invoice dari SO." });
  }
};


module.exports = {
  loadForEdit,
  save,
  searchUnpaidInvoices,
  getPrintData,
  searchSoForSetoran,
  getSoDetails,
  getInvoicesFromSo
};
