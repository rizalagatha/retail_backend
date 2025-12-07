const pool = require("../config/database");
const { format, subMonths } = require("date-fns");

const getRealTimeStock = async (filters) => {
  const { gudang, kodeBarang, jenisStok, tampilkanKosong, tanggal } = filters;
  const connection = await pool.getConnection();

  try {
    // Logika Delphi sangat kompleks karena keterbatasan, di Node.js kita bisa lebih efisien.
    // Pendekatan ini menggunakan satu query utama dengan subquery dan pivot dinamis.

    let stockSourceTable = "";
    if (jenisStok === "showroom") {
      stockSourceTable = "tmasterstok";
    } else if (jenisStok === "pesanan") {
      stockSourceTable = "tmasterstokso";
    } else {
      // Semua
      stockSourceTable = `(
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstokso
    )`;
    }

    let params = [tanggal, gudang];
    let gudangFilter = `m.mst_cab = ?`;
    if (gudang === "ALL") {
      // Untuk 'ALL', kita tidak filter berdasarkan cabang di subquery stok
      gudangFilter = "1 = 1";
      params = [tanggal];
    }

    let kodeBarangFilter = "";
    if (kodeBarang) {
      kodeBarangFilter = "AND a.brg_kode = ?";
      params.push(kodeBarang);
    }

    const havingClause = !tampilkanKosong ? "HAVING TOTAL > 0" : "";

    const query = `
            SELECT
                a.brg_kode AS KODE,
                a.brg_ktgp AS KTGPRODUK,
                a.brg_ktg AS KTGBARANG,
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                SUM(CASE WHEN s.mst_ukuran = 'S' THEN s.stok ELSE 0 END) AS S,
                SUM(CASE WHEN s.mst_ukuran = 'M' THEN s.stok ELSE 0 END) AS M,
                SUM(CASE WHEN s.mst_ukuran = 'L' THEN s.stok ELSE 0 END) AS L,
                SUM(CASE WHEN s.mst_ukuran = 'XL' THEN s.stok ELSE 0 END) AS XL,
                SUM(CASE WHEN s.mst_ukuran = '2XL' THEN s.stok ELSE 0 END) AS \`2XL\`,
                SUM(CASE WHEN s.mst_ukuran = '3XL' THEN s.stok ELSE 0 END) AS \`3XL\`,
                SUM(CASE WHEN s.mst_ukuran = '4XL' THEN s.stok ELSE 0 END) AS \`4XL\`,
                SUM(CASE WHEN s.mst_ukuran = '5XL' THEN s.stok ELSE 0 END) AS \`5XL\`,
                SUM(s.stok) AS TOTAL,
                IFNULL((SELECT SUM(brgd_min) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode), 0) AS Buffer
            FROM tbarangdc a
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    m.mst_ukuran, 
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM ${stockSourceTable} m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode, m.mst_ukuran
            ) s ON a.brg_kode = s.mst_brg_kode
            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter}
            GROUP BY a.brg_kode, NAMA
            ${havingClause}
            ORDER BY NAMA;
        `;

    const [rows] = await connection.query(query, params);
    return rows;
  } finally {
    connection.release();
  }
};

const getGudangOptions = async (user) => {
  let query = "";
  if (user.cabang === "KDC") {
    query = `
            SELECT 'ALL' AS kode, 'SEMUA' AS nama
            UNION ALL
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode;
        `;
  } else {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_kode = ?';
  }
  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

const getLowStock = async (filters) => {
  const { gudang } = filters;
  const connection = await pool.getConnection();

  try {
    const threeMonthsAgo = format(subMonths(new Date(), 3), "yyyy-MM-dd");
    const today = format(new Date(), "yyyy-MM-dd");

    let params = [today, gudang, threeMonthsAgo];

    let gudangFilter = `m.mst_cab = ?`;
    let salesBranchFilter = `AND h.inv_cab = ?`;

    if (gudang === "KDC") {
      params.push(gudang);
    } else {
      params.push(gudang);
    }

    const query = `
            SELECT
                a.brg_kode AS KODE,
                b.brgd_barcode AS BARCODE,
                b.brgd_ukuran AS UKURAN, -- [BARU] Ambil Ukuran
                
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                
                -- Stok Per Ukuran
                IFNULL(s.stok, 0) AS TOTAL,
                
                -- Buffer (Min Stok) per Ukuran
                IFNULL(b.brgd_min, 0) AS Buffer,
                
                -- Rata-rata Penjualan Per Ukuran
                IFNULL(sales.total_qty, 0) / 3 AS AVG_SALE

            FROM tbarangdc a
            -- [PENTING] Join ke tabel detail barang untuk memecah per ukuran
            JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
            
            -- 1. JOIN KE STOK (Group by Kode + Ukuran)
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    m.mst_ukuran, -- [BARU] Grouping Ukuran
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM (
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstok
                    UNION ALL
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstokso
                ) m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode, m.mst_ukuran
            ) s ON a.brg_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran -- [BARU] Join Ukuran

            -- 2. JOIN KE PENJUALAN (Group by Kode + Ukuran)
            LEFT JOIN (
                SELECT 
                    d.invd_kode,
                    d.invd_ukuran, -- [BARU] Grouping Ukuran
                    SUM(d.invd_jumlah) as total_qty
                FROM tinv_hdr h
                JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
                WHERE h.inv_sts_pro = 0 
                  AND h.inv_tanggal >= ? 
                  ${salesBranchFilter}
                GROUP BY d.invd_kode, d.invd_ukuran
            ) sales ON a.brg_kode = sales.invd_kode AND b.brgd_ukuran = sales.invd_ukuran -- [BARU] Join Ukuran

            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
            
            -- Filter hanya yang stoknya habis DAN laku
            HAVING TOTAL <= 0 AND AVG_SALE > 0
            
            ORDER BY AVG_SALE DESC
            LIMIT 20;
        `;

    const [rows] = await connection.query(query, params);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = {
  getRealTimeStock,
  getGudangOptions,
  getLowStock,
};
