const pool = require("../config/database");

const getList = async (filters) => {
  const { tahun, bulan } = filters;

  // Query ini dirombak total untuk memastikan hanya cabang dengan data yang muncul
  const query = `
        WITH SalesData AS (
            SELECT 
                LEFT(inv_nomor, 3) AS cabang,
                YEAR(inv_tanggal) AS tahun,
                MONTH(inv_tanggal) AS bulan,
                SUM(invd_jumlah) as qty,
                SUM(
                    (invd_harga - invd_diskon) * invd_jumlah
                ) - (inv_disc / (SELECT COUNT(*) FROM tinv_dtl i WHERE i.invd_inv_nomor = h.inv_nomor)) AS nominal
            FROM tinv_hdr h
            JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
            WHERE h.inv_sts_pro = 0
            GROUP BY h.inv_nomor
        ),
        TargetData AS (
            SELECT kode_gudang AS cabang, tahun, bulan, SUM(target_omset) AS target
            FROM kpi.ttarget_kaosan
            GROUP BY cabang, tahun, bulan
        ),
        BulanIni AS (
            SELECT cabang, SUM(qty) AS jumlah, SUM(nominal) AS nominal
            FROM SalesData WHERE tahun = ? AND bulan = ? GROUP BY cabang
        ),
        BulanLalu AS (
            SELECT cabang, SUM(qty) AS jumlah, SUM(nominal) AS nominal
            FROM SalesData 
            WHERE (tahun = ? AND bulan = ? - 1) OR (tahun = ? - 1 AND bulan = 12 AND ? = 1)
            GROUP BY cabang
        ),
        KumulatifBulanIni AS (
            SELECT cabang, SUM(nominal) AS nominal
            FROM SalesData WHERE tahun = ? AND bulan <= ? GROUP BY cabang
        ),
        BulanIniTahunLalu AS (
            SELECT cabang, SUM(nominal) AS nominal
            FROM SalesData WHERE tahun = ? - 1 AND bulan = ? GROUP BY cabang
        ),
        TargetBulanIni AS (
            SELECT cabang, SUM(target) AS target_omset FROM TargetData WHERE tahun = ? AND bulan = ? GROUP BY cabang
        ),
        TargetKumulatif AS (
            SELECT cabang, SUM(target) AS target_omset FROM TargetData WHERE tahun = ? AND bulan <= ? GROUP BY cabang
        ),
        TargetAkhirTahun AS (
            SELECT cabang, SUM(target) AS target_omset FROM TargetData WHERE tahun = ? GROUP BY cabang
        ),
        -- KUMPULKAN SEMUA CABANG YANG PUNYA DATA
        RelevantBranches AS (
            SELECT cabang FROM BulanIni
            UNION
            SELECT cabang FROM BulanLalu
            UNION
            SELECT cabang FROM TargetBulanIni
        )
        -- QUERY UTAMA SEKARANG DIMULAI DARI CABANG YANG RELEVAN
        SELECT 
            ? AS tahun,  
            ? AS bulan,
            rb.cabang AS kode_cabang,
            g.gdg_nama AS nama_cabang,
            IFNULL(bi.jumlah, 0) AS qty_bulan_ini,
            IFNULL(bi.nominal, 0) AS nominal_bulan_ini,
            IFNULL(tbi.target_omset, 0) AS target_bulan_ini,
            IFNULL(bl.jumlah, 0) AS qty_bulan_lalu,
            IFNULL(bl.nominal, 0) AS nominal_bulan_lalu,
            IFNULL(kbi.nominal, 0) AS realisasi_kumulatif,
            IFNULL(tk.target_omset, 0) AS target_kumulatif,
            IFNULL(bitl.nominal, 0) AS realisasi_bulan_ini_thn_lalu,
            IFNULL(tat.target_omset, 0) AS target_akhir_tahun,
            0 AS realisasi_akhir_tahun
        FROM RelevantBranches rb
        JOIN tgudang g ON rb.cabang = g.gdg_kode
        LEFT JOIN BulanIni bi ON rb.cabang = bi.cabang
        LEFT JOIN BulanLalu bl ON rb.cabang = bl.cabang
        LEFT JOIN KumulatifBulanIni kbi ON rb.cabang = kbi.cabang
        LEFT JOIN BulanIniTahunLalu bitl ON rb.cabang = bitl.cabang
        LEFT JOIN TargetBulanIni tbi ON rb.cabang = tbi.cabang
        LEFT JOIN TargetKumulatif tk ON rb.cabang = tk.cabang
        LEFT JOIN TargetAkhirTahun tat ON rb.cabang = tat.cabang
        ORDER BY rb.cabang;
    `;

  const params = [
    tahun,
    bulan,
    tahun,
    bulan, // BulanIni
    tahun,
    bulan,
    tahun,
    bulan, // BulanLalu
    tahun,
    bulan, // KumulatifBulanIni
    tahun,
    bulan, // BulanIniTahunLalu
    tahun,
    bulan, // TargetBulanIni
    tahun,
    bulan, // TargetKumulatif
    tahun, // TargetAkhirTahun
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDynamicCabangOptions = async (filters, user) => {
  const { startDate, endDate } = filters;
  let query = `
        SELECT DISTINCT 
            LEFT(h.inv_nomor, 3) AS kode, 
            g.gdg_nama AS nama 
        FROM tinv_hdr h
        JOIN tgudang g ON LEFT(h.inv_nomor, 3) = g.gdg_kode
        WHERE h.inv_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Jika user bukan KDC, batasi hanya untuk cabangnya sendiri
  if (user.cabang !== "KDC") {
    query += " AND LEFT(h.inv_nomor, 3) = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY kode";
  const [rows] = await pool.query(query, params);

  // Tambahkan opsi "ALL" jika user adalah KDC
  if (user.cabang === "KDC") {
    return [{ kode: "ALL", nama: "Semua Cabang" }, ...rows];
  }
  return rows;
};

module.exports = {
  getList,
  getDynamicCabangOptions,
};
