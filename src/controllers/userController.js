// backend/src/controllers/userController.js

const userService = require("../services/userService");

// Handler untuk mengambil semua user (dengan pencarian)
const getAll = async (req, res) => {
  try {
    // Ambil 'search' dari query string, contoh: /api/users?search=admin
    const searchTerm = req.query.search || "";
    const users = await userService.getAllUsers(searchTerm);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Handler untuk mengambil semua cabang
const getBranches = async (req, res) => {
  try {
    const branches = await userService.getAllBranches();
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Handler untuk mengambil detail spesifik user
const getDetails = async (req, res) => {
  try {
    // Ambil 'kode' dan 'cabang' dari parameter URL, contoh: /api/users/ADM/01
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

// Handler untuk menyimpan (create/update) user
const save = async (req, res) => {
  try {
    // Ambil seluruh data user dari body request
    const userData = req.body;
    const result = await userService.saveUser(userData);
    res.status(201).json(result); // 201 Created/Updated
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Handler untuk menghapus user
const remove = async (req, res) => {
  try {
    // Data untuk penghapusan dikirim via body request
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
    // Asumsi: kode user yang sedang login didapat dari request (misal: dari token JWT nanti)
    // Untuk sekarang, kita kirim manual dari frontend
    const { kodeUser, passwordLama, passwordBaru } = req.body;

    if (!kodeUser || !passwordLama || !passwordBaru) {
      return res.status(400).json({ message: "Semua field wajib diisi." });
    }

    const result = await userService.changePassword(
      kodeUser,
      passwordLama,
      passwordBaru
    );
    res.json(result);
  } catch (error) {
    // Tangkap error dari service (misal: password salah)
    res.status(400).json({ message: error.message });
  }
};

const getAvailableForSalesCounter = async (req, res) => {
  try {
    // Ambil cabang dari query string, contoh: /api/users/available-for-sc?cabang=K03
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

// Export semua fungsi agar bisa digunakan di userRoutes.js
module.exports = {
  getAll,
  getBranches,
  getDetails,
  save,
  remove,
  getMenus,
  updatePassword,
  getAvailableForSalesCounter,
};
