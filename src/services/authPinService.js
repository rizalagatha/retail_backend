/**
 * Memvalidasi PIN otorisasi berdasarkan kode yang diberikan.
 * Logika ini meniru perhitungan yang ada di aplikasi Delphi:
 * StrToFloat(edtkodeo.Text)*21+53*4 = noto
 */
const validatePin = async (code, pin) => {
    // 1. Konversi input ke tipe data angka (Number)
    const numericCode = parseFloat(code);
    const numericPin = parseFloat(pin);

    // 2. Lakukan pengecekan untuk memastikan input valid
    if (isNaN(numericCode) || isNaN(numericPin)) {
        throw new Error('Kode atau PIN tidak valid.');
    }

    // 3. Lakukan perhitungan sesuai formula Delphi
    const expectedPin = (numericCode * 21) + (53 * 4);

    // 4. Bandingkan hasilnya
    const isValid = (numericPin === expectedPin);

    if (!isValid) {
        throw new Error('Otorisasi salah.');
    }

    // Jika valid, kembalikan status sukses
    return { success: true, message: 'Otorisasi berhasil.' };
};

module.exports = {
    validatePin,
};
