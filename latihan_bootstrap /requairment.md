esign tampilan website yang akan dibuat adalah seperti ini. Website hanya terdiri dari satu halaman yang akan dibagi menjadi beberapa section. Navigasi menu akan mengarahkan ke section di bawahnya sesuai dengan yang user pilih. Berikut adalah rancangan desainnya.

Pada tampilan layar **mobile** : 

- Teks pada bagian hero rata tengah ditampilkan setelah gambar.
- Semua konten ditampilkan 1 kolom saja per baris.

Pada tampilan layar **selain mobile (layar yang lebarnya diatas lebar layar mobile)**:

- Bagian hero terdiri dari 2 kolom, kolom pertama teks dan kolom kedua gambar. Teks dibuat rata kiri.
- Bagian article terdiri dari 3 kolom.

Mulai dengan membuat mapping untuk 5 bagian tampilan website pada file index.html, yaitu bagian : navigasi (menu), hero (fokus utama), article, gallery, dan footer.

Bagian navigasi menggunakan tag <nav> dan bagian footer menggunakan tag <footer>.

Sedangkan untuk bagian hero, article, dan gallery menggunakan tag <section> yang diberi id sesuai dengan masing-masing bagiannya.


Gunakan Comment Tag untuk penanda awal dan akhir bagian supaya lebih memudahkan penandaan. Untuk membuat comment tag <!-- … --> bisa menggunakan shortcut dengan menekan tombol ctrl kemudian / (garis miring) pada keyboard.


2. Tambahkan class **text-center** dan **p-5** pada section hero, article, gallery, footer.
    
    **text-center** : membuat teks rata tengah

3. Atur warna background dengan menambahkan class **bg-danger-subtle** pada section hero dan gallery. Bootstrap menyediakan serangkaian "warna tema" (misalnya, primary, secondary, success, info, warning, danger, light, dan dark). Warna tema ini bisa diterapkan untuk warna background (bg-) dan warna teks (text-). 
    
    Misalnya : class **bg-danger** untuk memberikan warna latar belakang merah, class **text-danger** untuk memberikan warna merah pada teks.