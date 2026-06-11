const pool = require("../config/database");

const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const params = [startDate, endDate];
  let branchFilter = "";

  if (cabang && cabang !== "ALL") {
    branchFilter = "AND h.sjw_tujuan_cab = ?";
    params.push(cabang);
  }

  const query = `
    SELECT 
      h.sjw_nomor       AS Nomor,
      h.sjw_tanggal     AS Tanggal,
      h.sjw_tujuan_cab  AS Store,
      g.gdg_nama        AS Nama_Store,
      h.sjw_ket         AS Keterangan,
      h.user_create     AS Usr,
      h.sjw_closing     AS Closing,
      (
        SELECT t.tj_nomor 
        FROM ttrm_sj_hdr t 
        WHERE t.tj_sj_workshop = h.sjw_nomor
        LIMIT 1
      ) AS NoTerima
    FROM tsj_workshop_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.sjw_tujuan_cab
    WHERE h.sjw_tanggal BETWEEN ? AND ?
    ${branchFilter}
    ORDER BY h.sjw_tanggal DESC, h.sjw_nomor DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
      d.sjwd_kode AS Kode,
      TRIM(CONCAT(
        IFNULL(a.brg_jeniskaos,''), ' ',
        IFNULL(a.brg_tipe,''), ' ',
        IFNULL(a.brg_lengan,''), ' ',
        IFNULL(a.brg_jeniskain,''), ' ',
        IFNULL(a.brg_warna,'')
      )) AS Nama,
      d.sjwd_ukuran AS Ukuran,
      d.sjwd_jumlah AS Jumlah,
      IFNULL(td.tjd_jumlah, 0) AS JumlahTerima
    FROM tsj_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjwd_kode
    -- Join ke penerimaan via header workshop
    LEFT JOIN ttrm_sj_hdr th ON th.tj_sj_workshop = d.sjwd_nomor
    LEFT JOIN ttrm_sj_dtl td 
      ON td.tjd_nomor = th.tj_nomor
      AND td.tjd_kode = d.sjwd_kode
      AND td.tjd_ukuran = d.sjwd_ukuran
    WHERE d.sjwd_nomor = ?
    ORDER BY d.sjwd_kode, d.sjwd_ukuran
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

module.exports = { getList, getDetails };
