// File: src/services/refundService.js
const pool = require('../config/database');
const { format } = require('date-fns');

// --- Perbaikan pada semua fungsi ---
const getMaster = async (startDate, endDate) => {
  const sql = `
    SELECT
      rf_nomor AS Nomor,
      rf_tanggal AS Tanggal,
      user_create AS User,
      rf_acc AS ApvUser,
      rf_status AS Status,
      (SELECT SUM(rfd_nominal) FROM trefund_dtl WHERE rfd_nomor = h.rf_nomor) AS Nominal,
      rf_acc AS Appvoved,
      DATE_FORMAT(date_acc, '%d-%m-%Y') AS TglApvove,
      rf_closing AS Clossing
    FROM trefund_hdr h
    WHERE rf_tanggal BETWEEN ? AND ? 
    ORDER BY rf_nomor DESC
  `;
  const [rows] = await pool.query(sql, [startDate, endDate]); 
  return rows;
};

const getDetails = async (nomor) => {
  const sql = `
    SELECT
      d.rfd_iddrec AS iddrec,
      d.rfd_notrs AS nomor,
      IFNULL(DATE_FORMAT(i.inv_tanggal, '%Y-%m-%d'), DATE_FORMAT(s.sh_tanggal, '%Y-%m-%d')) AS tanggal,
      d.rfd_cus_kode AS kdcus,
      c.cus_nama AS customer,
      d.rfd_nominal AS nominal,
      d.rfd_refund AS refund,
      CASE WHEN d.rfd_refund > 0 THEN TRUE ELSE FALSE END AS apv,
      d.rfd_ket AS ket,
      d.rfd_bank AS bank,
      d.rfd_norek AS norek,
      d.rfd_atasnama AS atasnama
    FROM trefund_dtl d
    INNER JOIN trefund_hdr h ON h.rf_nomor = d.rfd_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = d.rfd_cus_kode
    LEFT JOIN tinv_hdr i ON i.inv_nomor = d.rfd_notrs
    LEFT JOIN tsetor_hdr s ON s.sh_nomor = d.rfd_notrs
    WHERE d.rfd_nomor = ?
    ORDER BY d.rfd_nourut
  `;
  const [rows] = await pool.query(sql, [nomor]);
  return rows;
};

const getMaxNomor = async (cabang) => {
  const yearMonth = format(new Date(), 'yyMM');
  const prefix = `${cabang}RF${yearMonth}`;
  const sql = `SELECT IFNULL(MAX(RIGHT(rf_nomor, 5)), 0) AS max_num FROM trefund_hdr WHERE LEFT(rf_nomor, 9) = ?`;
  
  const [result] = await pool.query(sql, [prefix]);
  const maxNum = parseInt(result[0].max_num, 10);
  const newNum = maxNum + 1;
  
  return `${prefix}${String(newNum).padStart(5, '0')}`;
};

const saveRefund = async (data, user, isEdit, userRole) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    let nomor = data.Nomor;
    const tanggal = format(new Date(data.Tanggal), 'yyyy-MM-dd HH:mm:ss');
    const now = new Date();
    const cidrec = `${user.cabang}RF${format(now, 'yyyyMMddHHmmss.SSS')}`;

    if (isEdit) {
      const status = data.ckApv ? 'APPROVE' : (userRole === 'koordinator' ? 'PROSES' : '');
      let sql = `
        UPDATE trefund_hdr SET
          rf_tanggal = ?,
          user_modified = ?,
          date_modified = NOW()
      `;
      const params = [tanggal, user.kduser];
      if (userRole === 'koordinator') {
        sql += `, rf_acc = ?, rf_status = ?`;
        params.push(data.ApvUser, status);
      }
      sql += ` WHERE rf_nomor = ?`;
      params.push(nomor);
      await connection.execute(sql, params);

      if (userRole !== 'koordinator') {
        await connection.execute(`DELETE FROM trefund_dtl WHERE rfd_nomor = ?`, [nomor]);
      }
    } else {
      nomor = await getMaxNomor(user.cabang);
      const sql = `
        INSERT INTO trefund_hdr (rf_idrec, rf_nomor, rf_tanggal, user_create, date_create)
        VALUES (?, ?, ?, ?, NOW())
      `;
      await connection.execute(sql, [cidrec, nomor, tanggal, user.kduser]);
    }

    let nourut = 1;
    for (const detail of data.details) {
      if (detail.customer) {
        if (userRole !== 'koordinator') {
          const sql = `
            INSERT INTO trefund_dtl (
              rfd_idrec, rfd_iddrec, rfd_nomor, rfd_notrs,
              rfd_cus_kode, rfd_nominal, rfd_ket, rfd_nourut
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;
          await connection.execute(sql, [cidrec, detail.iddrec, nomor, detail.nomor,
            detail.kdcus, detail.nominal, detail.ket, nourut]);
        } else {
          let sql = `
            UPDATE trefund_dtl SET
              rfd_bank = ?,
              rfd_norek = ?,
              rfd_atasnama = ?
          `;
          const params = [detail.bank, detail.norek, detail.atasnama];
          if (data.ckApv) {
            sql += `, rfd_refund = ?`;
            params.push(detail.refund);
          }
          sql += ` WHERE rfd_nomor = ? AND rfd_iddrec = ?`;
          params.push(nomor, detail.iddrec);
          await connection.execute(sql, params);

          if (data.ckApv) {
            if (detail.nomor.includes('INV')) {
              const piutangSql = `
                INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur)
                VALUES (?, ?, 'REFUND', ?, ?, ?) ON DUPLICATE KEY UPDATE pd_kredit = ?
              `;
              await connection.execute(piutangSql, [
                `${detail.kdcus}${detail.nomor}`, tanggal, detail.refund * -1,
                nomor, detail.iddrec, detail.refund
              ]);
            } else if (detail.nomor.includes('STR')) {
              const [shidrecRows] = await connection.execute(`SELECT sh_idrec FROM tsetor_hdr WHERE sh_nomor = ?`, [detail.nomor]);
              const shidrec = shidrecRows.length > 0 ? shidrecRows[0].sh_idrec : '';
              
              const setoranSql = `
                INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur)
                VALUES (?, ?, NOW(), '', ?, ?, ?) ON DUPLICATE KEY UPDATE sd_bayar = ?
              `;
              await connection.execute(setoranSql, [
                shidrec, detail.nomor, detail.refund, nomor, detail.iddrec, detail.refund
              ]);
            }
          }
        }
        nourut++;
      }
    }

    await connection.commit();
    return { success: true, nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Pastikan fungsi ini juga di-export
const getNewRefundForm = async (cabang) => {
    const newNomor = await getMaxNomor(cabang);
    return {
      nomor: newNomor,
      tanggal: format(new Date(), 'yyyy-MM-dd'),
      details: []
    };
};

module.exports = { getMaster, getDetails, saveRefund, getMaxNomor, getNewRefundForm };