const { Client } = require('pg');

exports.handler = async (event, context) => {
    // 1. CEK DARURAT: Apakah Kunci Neon Kosong?
    if (!process.env.NETLIFY_DATABASE_URL) {
        return { statusCode: 500, body: JSON.stringify({ error: "DATABASE URL KOSONG DI NETLIFY!" }) };
    }

    // JURUS PELICIN SSL (ANTI NGE-HANG UNTUK NEON DB)
    const client = new Client({ 
        connectionString: process.env.NETLIFY_DATABASE_URL,
        ssl: { rejectUnauthorized: false } 
    });

    try {
        await client.connect();

        // 2. BIKIN TABEL KALAU BELUM ADA
        await client.query(`
            CREATE TABLE IF NOT EXISTS bbm_users (
                username VARCHAR(50) PRIMARY KEY,
                password VARCHAR(50) NOT NULL,
                chips INTEGER DEFAULT 0,
                totalPay INTEGER DEFAULT 0,
                guess VARCHAR(500), 
                isPaid BOOLEAN DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS bbm_settings (
                id SERIAL PRIMARY KEY,
                game_status VARCHAR(20) DEFAULT 'open'
            );
        `);

        // Pastikan status bandar (Theo) sudah terisi
        const checkSet = await client.query('SELECT * FROM bbm_settings');
        if(checkSet.rows.length === 0) {
            await client.query("INSERT INTO bbm_settings (game_status) VALUES ('open')");
        }

        // 3. JURUS BULDOSER: Paksa ubah tipe kolom tebakan jadi teks (buat nampung banyak tebakan)
        try {
            await client.query('ALTER TABLE bbm_users ALTER COLUMN guess TYPE VARCHAR(500) USING guess::VARCHAR');
        } catch(e) {
            // Abaikan kalau kolom sudah benar
        }

        const method = event.httpMethod;

        // --- TARIK DATA KE LAYAR ---
        if (method === 'GET') {
            const usersRes = await client.query('SELECT * FROM bbm_users ORDER BY totalPay DESC');
            const statusRes = await client.query('SELECT game_status FROM bbm_settings LIMIT 1');
            return {
                statusCode: 200,
                body: JSON.stringify({ users: usersRes.rows, status: statusRes.rows[0].game_status })
            };
        }

        // --- TERIMA INPUT DARI LAYAR ---
        if (method === 'POST') {
            const data = JSON.parse(event.body);

            if (data.action === 'register') {
                const check = await client.query('SELECT * FROM bbm_users WHERE username = $1', [data.username]);
                if (check.rows.length > 0) return { statusCode: 400, body: JSON.stringify({ error: 'Username terpakai' }) };

                await client.query(
                    'INSERT INTO bbm_users (username, password, chips, totalPay, guess, isPaid) VALUES ($1, $2, $3, $4, $5, $6)',
                    [data.username, data.password, 0, 0, null, true]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'update_user') {
                await client.query(
                    'UPDATE bbm_users SET chips = $1, totalPay = $2, guess = $3, isPaid = $4 WHERE username = $5',
                    [data.chips, data.totalPay, data.guess, data.isPaid, data.username]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'admin_confirm') {
                await client.query('UPDATE bbm_users SET isPaid = true WHERE username = $1', [data.username]);
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'admin_toggle') {
                await client.query('UPDATE bbm_settings SET game_status = $1', [data.status]);
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }
        }

        return { statusCode: 405, body: "Method Not Allowed" };
    } catch (error) {
        // KALAU MASIH ERROR, DIA AKAN MUNCULIN PESAN ERRORNYA (BUKAN NGE-HANG LAGI)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        await client.end();
    }
};
