const pool = require("../config/database");

// Mengambil daftar user, dengan opsi pencarian
const getAllUsers = async (searchTerm = "") => {
  let query =
    "SELECT user_kode as kode, user_nama as nama, user_cab as cabang FROM tuser";
  const params = [];

  // Jika ada parameter pencarian, tambahkan klausa WHERE
  if (searchTerm) {
    query += " WHERE user_kode LIKE ? OR user_nama LIKE ?";
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  query += " ORDER BY user_kode";

  const [rows] = await pool.query(query, params);
  return rows;
};

// Mengambil daftar semua cabang/gudang
const getAllBranches = async () => {
  const [rows] = await pool.query(
    "SELECT gdg_kode FROM tgudang ORDER BY gdg_kode"
  );
  return rows;
};

// Mengambil detail lengkap user beserta hak aksesnya
const getUserDetails = async (kode, cabang) => {
  // 1. Ambil data user
  const [userRows] = await pool.query(
    "SELECT * FROM tuser WHERE user_kode = ? AND user_cab = ?",
    [kode, cabang]
  );
  if (userRows.length === 0) {
    return null; // User tidak ditemukan
  }
  const user = userRows[0];

  // 2. Ambil semua menu yang tersedia
  const [menuRows] = await pool.query(
    "SELECT men_id, men_nama, men_keterangan FROM tmenu WHERE men_modul=1 ORDER BY men_id"
  );

  // 3. Ambil hak akses spesifik user ini
  const [hakRows] = await pool.query(
    "SELECT * FROM thakuser WHERE hak_user_kode = ? AND hak_cab = ?",
    [kode, cabang]
  );

  // 4. Gabungkan data menu dengan hak aksesnya
  const permissions = menuRows.map((menu) => {
    const hak = hakRows.find((h) => h.hak_men_id === menu.men_id);
    return {
      id: menu.men_id,
      nama: menu.men_nama,
      keterangan: menu.men_keterangan,
      view: hak ? hak.hak_men_view === "Y" : false,
      insert: hak ? hak.hak_men_insert === "Y" : false,
      edit: hak ? hak.hak_men_edit === "Y" : false,
      delete: hak ? hak.hak_men_delete === "Y" : false,
    };
  });

  return { user, permissions };
};

// Menyimpan user baru atau mengupdate user yang ada (beserta hak akses)
const saveUser = async (userData) => {
  const { kode, nama, password, cabang, permissions, isNewUser } = userData;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Langkah 1: Simpan atau Update data di tabel tuser
    if (isNewUser) {
      await connection.query(
        "INSERT INTO tuser (user_kode, user_nama, user_password, user_cab) VALUES (?, ?, ?, ?)",
        [kode, nama, password, cabang]
      );
    } else {
      // --- PERUBAHAN DI SINI ---
      // Logika Delphi 'simpandata' HANYA mengupdate 'user_nama'.
      // Jika password diisi, kita juga update password.
      if (password) {
        // Update nama DAN password
        await connection.query(
          "UPDATE tuser SET user_nama = ?, user_password = ? WHERE user_kode = ? AND user_cab = ?",
          [nama, password, kode, cabang]
        );
      } else {
        // Update nama SAJA (sesuai Delphi)
        await connection.query(
          "UPDATE tuser SET user_nama = ? WHERE user_kode = ? AND user_cab = ?",
          [nama, kode, cabang]
        );
      }
      // --- BATAS PERUBAHAN ---
    }

    // Langkah 2: Hapus semua hak akses lama user ini
    await connection.query(
      "DELETE FROM thakuser WHERE hak_user_kode = ? AND hak_cab = ?",
      [kode, cabang]
    );

    // Langkah 3: Insert hak akses yang baru
    // (Logika Anda di sini sudah benar, sesuai Delphi 'simpandetailuser')
    for (const p of permissions) {
      if (p.view) {
        // Sesuai Delphi: "if (GridDetail.cells[4,i] = 'Y')"
        await connection.query(
          `INSERT INTO thakuser (hak_user_kode, hak_cab, hak_men_id, hak_men_view, hak_men_insert, hak_men_edit, hak_men_delete) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            kode,
            cabang,
            p.id,
            p.view ? "Y" : "N",
            p.insert ? "Y" : "N",
            p.edit ? "Y" : "N",
            p.delete ? "Y" : "N",
          ]
        );
      }
    }

    await connection.commit();
    return { success: true, message: "Data user berhasil disimpan." };
  } catch (error) {
    await connection.rollback();
    console.error("Error saving user:", error);
    throw new Error("Gagal menyimpan data user.");
  } finally {
    connection.release();
  }
};

// Menghapus user
const deleteUser = async (kode, cabang) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "DELETE FROM thakuser WHERE hak_user_kode = ? AND hak_cab = ?",
      [kode, cabang]
    );
    await connection.query(
      "DELETE FROM tuser WHERE user_kode = ? AND user_cab = ?",
      [kode, cabang]
    );
    await connection.commit();
    return { success: true, message: "User berhasil dihapus." };
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting user:", error);
    throw new Error("Gagal menghapus user.");
  } finally {
    connection.release();
  }
};

const getAllMenus = async () => {
  const [rows] = await pool.query(
    "SELECT men_id, men_nama, men_keterangan FROM tmenu WHERE men_modul=1 ORDER BY men_id"
  );
  return rows;
};

const changePassword = async (kodeUser, passwordLama, passwordBaru) => {
  // 1. Verifikasi password lama
  const [userRows] = await pool.query(
    "SELECT * FROM tuser WHERE user_kode = ? AND user_password = ?",
    [kodeUser, passwordLama]
  );

  // Jika user tidak ditemukan dengan password lama, berarti password salah
  if (userRows.length === 0) {
    // Throw error yang akan ditangkap oleh controller
    throw new Error("Password lama yang Anda masukkan salah.");
  }

  // 2. Jika password lama benar, update ke password baru
  const [updateResult] = await pool.query(
    "UPDATE tuser SET user_password = ? WHERE user_kode = ?",
    [passwordBaru, kodeUser]
  );

  // Periksa apakah proses update berhasil
  if (updateResult.affectedRows > 0) {
    return { success: true, message: "Password berhasil diganti." };
  } else {
    throw new Error("Gagal memperbarui password.");
  }
};

const getAvailableUsersForSalesCounter = async (cabang) => {
  const query = `
        SELECT u.user_kode as kode, u.user_nama as nama 
        FROM tuser u 
        WHERE u.user_cab = ? AND u.user_aktif = 0
        AND u.user_kode NOT IN (SELECT sc_kode FROM tsalescounter)
        ORDER BY u.user_kode;
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

module.exports = {
  getAllUsers,
  getAllBranches,
  getUserDetails,
  saveUser,
  deleteUser,
  getAllMenus,
  changePassword,
  getAvailableUsersForSalesCounter,
};
