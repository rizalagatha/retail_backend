const pool = require("../config/database");

const getList = async (filters) => {
  const { tahun, bulan } = filters;

  const query = `
        WITH 
        -- [BASE 1] Penjualan Bersih (Disinkronkan 100% dengan Laporan Monitoring)
        V_Nominal AS (
            -- 1. Ambil Qty dari tinv_dtl (karena v_sales_harian tidak punya Qty)
            SELECT 
                h.inv_cab AS cabang, YEAR(h.inv_tanggal) AS tahun, MONTH(h.inv_tanggal) AS bulan,
                SUM(d.invd_jumlah) AS jumlah, 0 AS nominal
            FROM tinv_hdr h
            JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
            WHERE h.inv_sts_pro = 0
            GROUP BY 1, 2, 3

            UNION ALL

            -- 2. Ambil Omset Kotor dari v_sales_harian
            SELECT 
                cabang, YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan,
                0 AS jumlah, SUM(nominal) AS nominal
            FROM v_sales_harian
            GROUP BY 1, 2, 3

            UNION ALL

            -- 3. Kurangi Biaya Platform / Fee Marketplace (Minus)
            SELECT 
                inv_cab AS cabang, YEAR(inv_tanggal) AS tahun, MONTH(inv_tanggal) AS bulan,
                0 AS jumlah, -SUM(COALESCE(inv_mp_biaya_platform, 0)) AS nominal
            FROM tinv_hdr
            WHERE inv_sts_pro = 0
            GROUP BY 1, 2, 3

            UNION ALL

            -- 4. Kurangi Retur Jual (Minus - Menggunakan Logika Akurat dari Monitoring)
            SELECT 
                rh.rj_cab AS cabang, YEAR(rh.rj_tanggal) AS tahun, MONTH(rh.rj_tanggal) AS bulan,
                0 AS jumlah,
                -SUM(
                    CASE 
                        WHEN rh.rj_jenis = 'N' THEN (
                            SELECT GREATEST(0, 
                                IFNULL(SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)), 0) - 
                                IFNULL((SELECT SUM(inv_rj_rp) FROM tinv_hdr WHERE inv_rj_nomor = rh.rj_nomor), 0)
                            )
                            FROM trj_dtl rd WHERE rd.rjd_nomor = rh.rj_nomor
                        )
                        WHEN rh.rj_jenis = 'Y' THEN (
                            SELECT IFNULL(SUM(rfd_refund), 0) 
                            FROM trefund_dtl 
                            WHERE rfd_notrs = rh.rj_inv
                        )
                        ELSE 0
                    END
                ) AS nominal
            FROM trj_hdr rh
            GROUP BY 1, 2, 3
        ),
        
        -- Gabungkan semua angka di atas berdasarkan Cabang, Tahun, dan Bulan
        V_Nominal_Agg AS (
            SELECT cabang, tahun, bulan, SUM(jumlah) as jumlah, SUM(nominal) as nominal
            FROM V_Nominal
            GROUP BY cabang, tahun, bulan
        ),

        -- [BASE 2] Target Omset (kpi.ttarget_kaosan)
        TargetData AS (
            SELECT kode_gudang AS cabang, tahun, bulan, SUM(target_omset) AS target
            FROM kpi.ttarget_kaosan
            GROUP BY kode_gudang, tahun, bulan
        ),

        -- =========================================================
        -- MAPPING LOGIKA (A, B, C, D, E, F, G)
        -- =========================================================

        -- A: Bulan Ini (Actual)
        Data_A AS (
            SELECT cabang, jumlah, nominal FROM V_Nominal_Agg WHERE tahun = ? AND bulan = ?
        ),
        -- B: Target Bulan Ini
        Data_B AS (
            SELECT cabang, target FROM TargetData WHERE tahun = ? AND bulan = ?
        ),
        -- C: Bulan Lalu (Actual)
        Data_C AS (
            SELECT cabang, jumlah, nominal FROM V_Nominal_Agg 
            WHERE (tahun = ? AND bulan = ? - 1) OR (tahun = ? - 1 AND bulan = 12 AND ? = 1)
        ),
        -- D: Kumulatif s.d Bulan Ini (Actual)
        Data_D AS (
            SELECT cabang, SUM(nominal) as nominal 
            FROM V_Nominal_Agg WHERE tahun = ? AND bulan <= ? 
            GROUP BY cabang
        ),
        -- E: Target Kumulatif s.d Bulan Ini
        Data_E AS (
            SELECT cabang, SUM(target) as target 
            FROM TargetData WHERE tahun = ? AND bulan <= ? 
            GROUP BY cabang
        ),
        -- F: Bulan Ini Tahun Lalu (Actual)
        Data_F AS (
            SELECT cabang, nominal FROM V_Nominal_Agg WHERE tahun = ? - 1 AND bulan = ?
        ),
        -- G: Target Akhir Tahun (Full Year Target)
        Data_G AS (
            SELECT cabang, SUM(target) as target 
            FROM TargetData WHERE tahun = ? 
            GROUP BY cabang
        ),

        -- List Semua Cabang
        AllBranches AS (
            SELECT gdg_kode AS cabang, gdg_nama FROM tgudang
        )

        -- SELECT FINAL
        SELECT 
            ? AS tahun,
            ? AS bulan,
            ab.cabang AS kode_cabang,
            ab.gdg_nama AS nama_cabang,

            -- A & B (Bulan Ini)
            IFNULL(a.jumlah, 0) AS qty_bulan_ini,
            IFNULL(a.nominal, 0) AS nominal_bulan_ini,
            IFNULL(b.target, 0) AS target_bulan_ini,
            
            -- C (Bulan Lalu)
            IFNULL(c.jumlah, 0) AS qty_bulan_lalu,
            IFNULL(c.nominal, 0) AS nominal_bulan_lalu,

            -- D & E (Kumulatif)
            IFNULL(d.nominal, 0) AS realisasi_kumulatif,
            IFNULL(e.target, 0) AS target_kumulatif,

            -- F (Tahun Lalu)
            IFNULL(f.nominal, 0) AS realisasi_bulan_ini_thn_lalu,

            -- G (Akhir Tahun)
            IFNULL(g.target, 0) AS target_akhir_tahun,
            IFNULL(d.nominal, 0) AS realisasi_akhir_tahun

        FROM AllBranches ab
        LEFT JOIN Data_A a ON ab.cabang = a.cabang
        LEFT JOIN Data_B b ON ab.cabang = b.cabang
        LEFT JOIN Data_C c ON ab.cabang = c.cabang
        LEFT JOIN Data_D d ON ab.cabang = d.cabang
        LEFT JOIN Data_E e ON ab.cabang = e.cabang
        LEFT JOIN Data_F f ON ab.cabang = f.cabang
        LEFT JOIN Data_G g ON ab.cabang = g.cabang
        
        -- Filter agar hanya muncul cabang yang punya data
        WHERE (
            IFNULL(a.nominal, 0) > 0 OR 
            IFNULL(b.target, 0) > 0 OR 
            IFNULL(c.nominal, 0) > 0 OR 
            IFNULL(d.nominal, 0) > 0
        )
        ORDER BY ab.cabang;
    `;

  const params = [
    tahun,
    bulan, // Params A
    tahun,
    bulan, // Params B
    tahun,
    bulan,
    tahun,
    bulan, // Params C
    tahun,
    bulan, // Params D
    tahun,
    bulan, // Params E
    tahun,
    bulan, // Params F
    tahun, // Params G
    tahun,
    bulan, // Select Constants
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDynamicCabangOptions = async (filters, user) => {
  const { startDate, endDate } = filters;
  let query = `
        SELECT DISTINCT 
            h.inv_cab AS kode, 
            g.gdg_nama AS nama 
        FROM tinv_hdr h
        JOIN tgudang g ON h.inv_cab = g.gdg_kode
        WHERE h.inv_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Jika user bukan KDC, batasi hanya untuk cabangnya sendiri
  if (user.cabang !== "KDC") {
    query += " AND h.inv_cab = ?";
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
