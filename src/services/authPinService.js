const validatePin = async (code, pin) => {
    // 1. Validasi dasar
    if (!pin || pin.length < 2) { // PIN harus punya setidaknya 1 angka dan 1 huruf
        throw new Error('Format PIN tidak valid.');
    }

    // 2. Pisahkan angka dan karakter otorisator (seperti di Delphi)
    const numericPinString = pin.substring(0, pin.length - 1);
    const authorizerChar = pin.substring(pin.length - 1);
    
    // 3. Konversi ke angka
    const numericCode = parseFloat(code);
    const numericPin = parseFloat(numericPinString);
    if (isNaN(numericCode) || isNaN(numericPin)) {
        throw new Error('Kode atau PIN mengandung karakter angka yang tidak valid.');
    }

    // 4. Lakukan perhitungan sesuai formula Delphi
    const expectedPin = (numericCode * 21) + (53 * 4);

    // 5. Bandingkan hasilnya
    // TODO: Tambahkan validasi untuk authorizerChar jika perlu (meniru `isotoritator`)
    if (numericPin !== expectedPin) {
        throw new Error('Otorisasi salah.');
    }

    return { success: true, message: 'Otorisasi berhasil.' };
};

module.exports = {
    validatePin,
};