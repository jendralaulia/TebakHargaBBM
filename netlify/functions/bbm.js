const { Client } = require('pg');

exports.handler = async (event, context) => {
    if (!process.env.NETLIFY_DATABASE_URL) {
        return { statusCode: 500, body: JSON.stringify({ error: "DATABASE URL KOSONG DI NETLIFY!" }) };
    }

    const client = new Client({ 
        connectionString: process.env.NETLIFY_DATABASE_URL,
        ssl: { rejectUnauthorized: false } 
    });

    try {
        await client.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS bbm_users (
                username VARCHAR(50) PRIMARY KEY,
                password VARCHAR(50) NOT NULL,
                chips INTEGER DEFAULT 0,
                totalPay INTEGER DEFAULT 0,
                isPaid BOOLEAN DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS bbm_settings (
                id SERIAL PRIMARY KEY,
                game_status VARCHAR(20) DEFAULT 'open'
            );
        `);

        // UPGRADE DATABASE: Tambah kolom antrean transaksi
        await client.query(`ALTER TABLE bbm_users ADD COLUMN IF NOT EXISTS guesses VARCHAR(500);`);
        await client.query(`ALTER TABLE bbm_users ADD COLUMN IF NOT EXISTS pending_chips INTEGER DEFAULT 0;`);
        await client.query(`ALTER TABLE bbm_users ADD COLUMN IF NOT EXISTS unpaid_bill INTEGER DEFAULT 0;`);

        const checkSet = await client.query('SELECT * FROM bbm_settings');
        if(checkSet.rows.length === 0) {
            await client.query("INSERT INTO bbm_settings (game_status) VALUES ('open')");
        }

        const method = event.httpMethod;

        if (method === 'GET') {
            const usersRes = await client.query('SELECT username, password, chips, totalpay, guesses, ispaid, pending_chips, unpaid_bill FROM bbm_users ORDER BY totalpay DESC');
            const statusRes = await client.query('SELECT game_status FROM bbm_settings LIMIT 1');
            return {
                statusCode: 200,
                body: JSON.stringify({ users: usersRes.rows, status: statusRes.rows[0].game_status })
            };
        }

        if (method === 'POST') {
            const data = JSON.parse(event.body);

            if (data.action === 'register') {
                const check = await client.query('SELECT * FROM bbm_users WHERE username = $1', [data.username]);
                if (check.rows.length > 0) return { statusCode: 400, body: JSON.stringify({ error: 'Username terpakai' }) };

                await client.query(
                    'INSERT INTO bbm_users (username, password, chips, totalPay, guesses, isPaid, pending_chips, unpaid_bill) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [data.username, data.password, 0, 0, null, true, 0, 0]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            // AKSI: USER BELI CHIP (Masuk ke antrean)
            if (data.action === 'buy_chips') {
                await client.query(
                    'UPDATE bbm_users SET pending_chips = pending_chips + $1, unpaid_bill = unpaid_bill + $2, isPaid = false WHERE username = $3',
                    [data.qty, data.cost, data.username]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            // AKSI: USER SIMPAN TEBAKAN
            if (data.action === 'save_guesses') {
                await client.query(
                    'UPDATE bbm_users SET guesses = $1 WHERE username = $2',
                    [data.guesses, data.username]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            // AKSI: THEO MENGESAHKAN PEMBAYARAN
            if (data.action === 'admin_confirm') {
                // Pindahkan chip pending ke chip aktif, lalu reset tagihan jadi 0
                await client.query(
                    'UPDATE bbm_users SET chips = chips + pending_chips, totalPay = totalPay + unpaid_bill, pending_chips = 0, unpaid_bill = 0, isPaid = true WHERE username = $1',
                    [data.username]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'admin_toggle') {
                await client.query('UPDATE bbm_settings SET game_status = $1', [data.status]);
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'admin_reset') {
                if (data.password !== 'Monica') return { statusCode: 403, body: JSON.stringify({ error: 'Password Nuklir Salah!' }) };
                await client.query('UPDATE bbm_users SET chips = 0, totalPay = 0, guesses = NULL, isPaid = true, pending_chips = 0, unpaid_bill = 0');
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }
        }

        return { statusCode: 405, body: "Method Not Allowed" };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        await client.end();
    }
};
