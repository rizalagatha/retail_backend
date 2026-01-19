const customerService = require("../services/customerService");

const getAll = async (req, res) => {
  try {
    // Ambil parameter query (term, page, itemsPerPage) dari request
    const filters = {
      term: req.query.term,
      page: req.query.page,
      itemsPerPage: req.query.itemsPerPage,
    };

    // Teruskan filters dan data user ke service
    const result = await customerService.getAllCustomers(filters, req.user);

    // Kembalikan hasil berupa { items, total }
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @description Menangani permintaan untuk membuat customer baru.
 */
const create = async (req, res) => {
  try {
    const result = await customerService.createCustomer(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @description Menangani permintaan untuk memperbarui customer.
 */
const update = async (req, res) => {
  try {
    const { kode } = req.params;
    const result = await customerService.updateCustomer(kode, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { kode } = req.params;
    const result = await customerService.deleteCustomer(kode);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { kode } = req.params;
    const details = await customerService.getCustomerDetails(kode);
    if (details) {
      res.json(details);
    } else {
      res.status(404).json({ message: "Customer tidak ditemukan" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getNextCode = async (req, res) => {
  try {
    // AMBIL DARI USER YANG LOGIN, BUKAN HARDCODED
    const userCabang = req.user.cabang;

    if (!userCabang) {
      return res.status(400).json({ message: "Cabang user tidak ditemukan." });
    }

    const nextCode = await customerService.generateNewCustomerCode(userCabang);
    res.json({ nextCode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLevels = async (req, res) => {
  try {
    const levels = await customerService.getCustomerLevels();
    res.json(levels);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  create,
  update,
  remove,
  getDetails,
  getNextCode,
  getLevels,
};
