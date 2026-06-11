// backend/src/controllers/userController.js

const userService = require("../services/userService");

const getAll = async (req, res) => {
  try {
    const searchTerm = req.query.search || "";
    const users = await userService.getAllUsers(searchTerm);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBranches = async (req, res) => {
  try {
    const branches = await userService.getAllBranches();
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { kode, cabang } = req.params;
    const userDetails = await userService.getUserDetails(kode, cabang);
    if (userDetails) {
      res.json(userDetails);
    } else {
      res.status(404).json({ message: "User tidak ditemukan" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userData = req.body;
    const result = await userService.saveUser(userData);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { kode, cabang } = req.body;
    if (!kode || !cabang) {
      return res.status(400).json({ message: "Kode dan Cabang diperlukan" });
    }
    const result = await userService.deleteUser(kode, cabang);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMenus = async (req, res) => {
  try {
    const menus = await userService.getAllMenus();
    res.json(menus);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updatePassword = async (req, res) => {
  try {
    const { kodeUser, passwordLama, passwordBaru } = req.body;
    if (!kodeUser || !passwordLama || !passwordBaru) {
      return res.status(400).json({ message: "Semua field wajib diisi." });
    }
    const result = await userService.changePassword(
      kodeUser,
      passwordLama,
      passwordBaru,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getAvailableForSalesCounter = async (req, res) => {
  try {
    const { cabang } = req.query;
    if (!cabang) {
      return res.status(400).json({ message: "Parameter cabang diperlukan." });
    }
    const users = await userService.getAvailableUsersForSalesCounter(cabang);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [BARU] Ambil daftar user per cabang (untuk fitur copy permission)
const getUsersByCabang = async (req, res) => {
  try {
    const { cabang, kasirOnly } = req.query;
    const data = await userService.getUsersByCabang(
      cabang ?? "",
      kasirOnly === "true",
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [BARU] Ambil template permission dari user referensi
const getTemplate = async (req, res) => {
  try {
    const { kode, cabang } = req.query;
    if (!kode || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter kode dan cabang diperlukan." });
    }
    const perms = await userService.getTemplateFromUser(kode, cabang);
    res.json(perms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [BARU] Deteksi menu baru yang belum dikonfigurasi untuk user tertentu
const getNewMenus = async (req, res) => {
  try {
    const { kode, cabang } = req.query;
    if (!kode || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter kode dan cabang diperlukan." });
    }
    const newMenuIds = await userService.getNewMenusForUser(kode, cabang);
    res.json(newMenuIds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const applyNewMenusToUsers = async (req, res) => {
  try {
    const { sourceKode, sourceCabang, targetUsers, menuIds } = req.body;
    if (
      !sourceKode ||
      !sourceCabang ||
      !targetUsers?.length ||
      !menuIds?.length
    ) {
      return res.status(400).json({ message: "Parameter tidak lengkap." });
    }
    const result = await userService.applyNewMenusToUsers(
      sourceKode,
      sourceCabang,
      targetUsers,
      menuIds,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getBranches,
  getDetails,
  save,
  remove,
  getMenus,
  updatePassword,
  getAvailableForSalesCounter,
  getUsersByCabang, // [BARU]
  getTemplate, // [BARU]
  getNewMenus, // [BARU]
  applyNewMenusToUsers,
};
