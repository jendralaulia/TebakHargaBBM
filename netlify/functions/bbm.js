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

        // 1. BUAT TABEL DASAR
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

        // 2. JURUS ANTI BENTROK: Bikin Kolom Baru Khusus Banyak Tebakan
        await client.query(`
            ALTER TABLE bbm_users ADD COLUMN IF NOT EXISTS guesses VARCHAR(500);
        `);

        const checkSet = await client.query('SELECT * FROM bbm_settings');
        if(checkSet.rows.length === 0) {
            await client.query("INSERT INTO bbm_settings (game_status) VALUES ('open')");
        }

        const method = event.httpMethod;

        if (method === 'GET') {
            // Tarik data dengan kolom 'guesses' yang baru
            const usersRes = await client.query('SELECT username, password, chips, totalpay, guesses, ispaid FROM bbm_users ORDER BY totalpay DESC');
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
                    'INSERT INTO bbm_users (username, password, chips, totalPay, guesses, isPaid) VALUES ($1, $2, $3, $4, $5, $6)',
                    [data.username, data.password, 0, 0, null, true]
                );
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }

            if (data.action === 'update_user') {
                await client.query(
                    'UPDATE bbm_users SET chips = $1, totalPay = $2, guesses = $3, isPaid = $4 WHERE username = $5',
                    [data.chips, data.totalPay, data.guesses, data.isPaid, data.username]
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
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        await client.end();
    }
};
