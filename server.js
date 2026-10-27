const express = require('express');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const { Pool } = require('pg'); // Koresha 'pg' niba uri kuri Supabase/Neon (PostgreSQL)

const app = express();
app.use(express.json());

// Guhuza na Database (Uzuza amakuru yawe hano)
const db = new Pool({
    connectionString: "postgresql://postgres:GSho0t@?@?P@db.noklchutcnorhlnoxklb.supabase.co:5432/postgres"
});

// ================= 1. AUTHENTICATION (IYANDIKISHA & KWINJIRA) =================

app.post('/api/auth/register', async (req, res) => {
    const { fullName, phoneNumber, password } = req.body;
    try {
        const existing = await db.query("SELECT id FROM users WHERE phone_number = $1", [phoneNumber]);
        if (existing.rows.length > 0) return res.status(400).json({ message: "Iyi nomero isanzwe ifite konti!" });

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await db.query(
            "INSERT INTO users (full_name, phone_number, password_hash) VALUES ($1, $2, $3) RETURNING id",
            [fullName, phoneNumber, passwordHash]
        );
        
        await db.query("INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00)", [newUser.rows[0].id]);
        res.status(201).json({ success: true, message: "Konti yafunguwe neza!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { phoneNumber, password } = req.body;
    try {
        const user = await db.query("SELECT * FROM users WHERE phone_number = $1 AND status = 'active'", [phoneNumber]);
        if (user.rows.length === 0) return res.status(404).json({ message: "Nta nomero nk iyo yanditswe!" });

        const valid = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!valid) return res.status(401).json({ message: "Ijambo ry'ibanga si ryo!" });

        res.status(200).json({ success: true, user: { id: user.rows[0].id, fullName: user.rows[0].full_name } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= 2. MANUAL FINANCE (KUBITSA & KUBIKUZA KU NOMERO GUSA) =================

app.post('/api/manual/deposit', async (req, res) => {
    const { userId, amount, phoneNumber } = req.body;
    try {
        await db.query(
            "INSERT INTO transactions (user_id, phone_number, amount, type, status) VALUES ($1, $2, $3, 'deposit', 'pending')",
            [userId, phoneNumber, amount]
        );
        res.status(200).json({ success: true, message: "Ubusabe bwoherejwe! Admin ari kubugenzura mu gatoroshi." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/manual/withdraw', async (req, res) => {
    const { userId, amount, phoneNumber } = req.body;
    try {
        const original = await db.query("SELECT phone_number FROM transactions WHERE user_id = $1 AND type = 'deposit' AND status = 'approved' LIMIT 1", [userId]);
        if (original.rows.length > 0 && original.rows[0].phone_number !== phoneNumber) {
            return res.status(400).json({ message: "Umutekano: Ugomba kubikuriza kuri nomero yakoreshejwe ukora deposit gusa!" });
        }

        const wallet = await db.query("SELECT balance FROM wallets WHERE user_id = $1", [userId]);
        if (wallet.rows[0].balance < amount) return res.status(400).json({ message: "Amafaranga ufite ntahagije!" });

        await db.query("UPDATE wallets SET balance = balance - $1 WHERE user_id = $2", [amount, userId]);
        await db.query(
            "INSERT INTO transactions (user_id, phone_number, amount, type, status) VALUES ($1, $2, $3, 'withdrawal', 'pending')",
            [userId, phoneNumber, amount]
        );
        res.status(200).json({ success: true, message: "Ubusabe bwo kubikuza bwoherejwe!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= 3. ADMIN PANEL SYSTEM (KWEMEZA MANUAL DEPOSITS/WITHDRAWALS) =================

app.post('/api/admin/verify', async (req, res) => {
    const { transactionId, action } = req.body; // action: 'approve' cyangwa 'reject'
    try {
        const tx = await db.query("SELECT * FROM transactions WHERE id = $1 AND status = 'pending'", [transactionId]);
        if (tx.rows.length === 0) return res.status(400).json({ message: "Nta transaction itegereje ihari!" });

        const currentTx = tx.rows[0];
        if (action === 'approve') {
            if (currentTx.type === 'deposit') {
                await db.query("UPDATE wallets SET balance = balance + $1 WHERE user_id = $2", [currentTx.amount, currentTx.user_id]);
            }
            await db.query("UPDATE transactions SET status = 'approved' WHERE id = $1", [transactionId]);
        } else {
            if (currentTx.type === 'withdrawal') {
                await db.query("UPDATE wallets SET balance = balance + $1 WHERE user_id = $2", [currentTx.amount, currentTx.user_id]);
            }
            await db.query("UPDATE transactions SET status = 'rejected' WHERE id = $1", [transactionId]);
        }
        res.status(200).json({ success: true, message: `Transaction yakorewe ${action} neza!` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= 4. INVESTMENTS & DAILY BONUS (CHECK-IN & PRODUCTS) =================

app.post('/api/user/purchase', async (req, res) => {
    const { userId, productId } = req.body;
    const today = new Date().toISOString().split('T')[0];
    try {
        const prod = await db.query("SELECT * FROM shop_products WHERE id = $1 AND status = 'active'", [productId]);
        const wallet = await db.query("SELECT balance FROM wallets WHERE user_id = $1", [userId]);

        if (wallet.rows[0].balance < prod.rows[0].price) return res.status(400).json({ message: "In sanduku yawe ntihagije!" });

        await db.query("UPDATE wallets SET balance = balance - $1 WHERE user_id = $2", [prod.rows[0].price, userId]);
        await db.query(
            "INSERT INTO product_purchases (user_id, product_name, cost, daily_roi, status, last_payout_date) VALUES ($1, $2, $3, $4, 'active', $5)",
            [userId, prod.rows[0].display_name, prod.rows[0].price, prod.rows[0].internal_daily_roi, today]
        );
        res.status(200).json({ success: true, message: "Wamaze gushora mu bworozi!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/checkin', async (req, res) => {
    const { userId } = req.body;
    const today = new Date().toISOString().split('T')[0];
    try {
        await db.query("INSERT INTO checkins (user_id, checkin_date) VALUES ($1, $2)", [userId, today]);
        await db.query("UPDATE wallets SET balance = balance + 100.00 WHERE user_id = $1", [userId]);
        res.status(200).json({ success: true, message: "Watsindiye 100 RWF y'uyu munsi!" });
    } catch (err) { res.status(400).json({ message: "Wamaze gukora Check-in y'uyu munsi!" }); }
});

// ================= 5. AUTOMATION (CRON JOB INYUNGU Z'IBICURUZWA MU GICUKU) =================

cron.schedule('0 0 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const active = await db.query("SELECT * FROM product_purchases WHERE status = 'active' AND last_payout_date < $1", [today]);
        for (let row of active.rows) {
            await db.query("UPDATE wallets SET balance = balance + $1, total_earned = total_earned + $1 WHERE user_id = $2", [row.daily_roi, row.user_id]);
            await db.query("UPDATE product_purchases SET last_payout_date = $1 WHERE id = $2", [today, row.id]);
        }
        console.log("Inyungu z'ubworozi zatanzwe byikora!");
    } catch (err) { console.error(err); }
});

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Smart Ubworozi backend irakora'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Ubworozi Server running on port ${PORT}`);
});

