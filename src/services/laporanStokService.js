// services/laporanStokService.js
import pool from "../config/database.js";

const generateLaporanStok = async (cabang, tanggal) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // nama tabel temporary
    const tmpTable = "tmp_stok";

    // drop kalau sudah ada
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS ${tmpTable}`);

    // buat tabel temporary mirip Delphi
    await conn.query(`
      CREATE TEMPORARY TABLE ${tmpTable} (
        kode VARCHAR(10) NOT NULL,
        nama VARCHAR(100) NOT NULL,
        XS DOUBLE NOT NULL DEFAULT 0,
        S DOUBLE NOT NULL DEFAULT 0,
        M DOUBLE NOT NULL DEFAULT 0,
        L DOUBLE NOT NULL DEFAULT 0,
        XL DOUBLE NOT NULL DEFAULT 0,
        \`2XL\` DOUBLE NOT NULL DEFAULT 0,
        \`3XL\` DOUBLE NOT NULL DEFAULT 0,
        \`4XL\` DOUBLE NOT NULL DEFAULT 0,
        \`5XL\` DOUBLE NOT NULL DEFAULT 0,
        \`6XL\` DOUBLE NOT NULL DEFAULT 0,
        \`7XL\` DOUBLE NOT NULL DEFAULT 0,
        \`8XL\` DOUBLE NOT NULL DEFAULT 0,
        \`9XL\` DOUBLE NOT NULL DEFAULT 0,
        \`10XL\` DOUBLE NOT NULL DEFAULT 0,
        PRIMARY KEY (kode)
      )
    `);

    // ambil stok per barang+ukuran
    const [stokRows] = await conn.query(
      `
      SELECT 
        b.brg_kode AS kode,
        b.brg_nama AS nama,
        s.stok_ukuran AS ukuran,
        SUM(s.stok_jumlah) AS jumlah
      FROM tstok s
      JOIN tbarang b ON b.brg_kode = s.stok_brg
      WHERE s.stok_cabang = ?
        AND s.stok_tanggal <= ?
      GROUP BY b.brg_kode, s.stok_ukuran
      `,
      [cabang, tanggal]
    );

    // masukkan data ke tabel temporary
    for (const row of stokRows) {
      // insert kalau belum ada
      await conn.query(
        `INSERT INTO ${tmpTable} (kode, nama) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
        [row.kode, row.nama]
      );

      // update kolom sesuai ukuran
      const ukuran = row.ukuran;
      const jumlah = row.jumlah || 0;
      await conn.query(
        `UPDATE ${tmpTable} SET \`${ukuran}\` = ? WHERE kode = ?`,
        [jumlah, row.kode]
      );
    }

    // ambil hasil akhir
    const [result] = await conn.query(`SELECT * FROM ${tmpTable}`);

    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    console.error("❌ LaporanStokService Error:", err);
    throw err;
  } finally {
    conn.release();
  }
};

export default {
  generateLaporanStok,
};
