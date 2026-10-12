# TOCFL Studio: lima Mock Test Reading Band A

Ekstrak seluruh ZIP, lalu buka **index.html**. Paket memuat 250 soal, kunci jawaban, 230 gambar dari PDF, dan seluruh 10 PDF sumber. Tidak ada dependensi aplikasi yang perlu diinstal.

Gunakan **Mock Test Band A** untuk satu paket lengkap atau satu bagian. Gunakan **Reading Lab** untuk mencari satu soal. Pilih jawaban, lalu kirim sesi untuk melihat hasil dan kunci. Progres tersimpan pada browser yang digunakan.

Materi listening belum tersedia dalam unggahan. Menu impor JSON dan audio tetap berfungsi. Kunci mengikuti PDF jawaban; sumber tidak menyertakan pembahasan rinci. Nilai adalah persentase benar, bukan skor resmi TOCFL.

Baca **panduan.txt** untuk format JSON, penggunaan server lokal, penggantian bank, pembaruan data offline, serta batasan penyimpanan.

Untuk mengedit JSON dan membacanya langsung melalui HTTP:

```bash
python -m http.server 8000
```

Buka `http://localhost:8000`. Untuk memperbarui data pembukaan langsung/offline setelah mengedit JSON:

```bash
node scripts/bundle-data.mjs
```

Untuk menjalankan pemeriksaan programatik:

```bash
node scripts/check.mjs
```

Kode mempertahankan struktur HTML, CSS, JavaScript vanilla, dan skema bank versi 1 dari template awal. Tidak ada pengujian tampilan browser otomatis dalam lingkungan pengerjaan ini; pemeriksaan logika/data dan inspeksi visual cuplikan PDF dilakukan secara terpisah.
