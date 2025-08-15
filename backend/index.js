const express= require('express');
const app=express();
app.use(express.json()); 
const pool = require('./db.js');


app.get('/', (req,res)=>{
    res.json({
        name:"Suruchi"
    });
});

//signup

// Signup Route
app.post('/signup', async (req, res) => {
    try {
        const {full_name, email, password } = req.body;
        console.log(req.body.full_name);
        console.log(req.body.email);
        console.log(req.body.password);

        if (!full_name || !email || !password) {
            return res.status(400).json({ error: "All fields are required" });
        }
        
        const users = await pool.query(
            
            'INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3) RETURNING id, full_name, email',
            
            [full_name, email, password]
        );

        res.status(201).json({
            message: "User registered successfully",
            users: users.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

//login route
// Login Route
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Find user in DB
        const userResult = await pool.query(
            'SELECT id, full_name, email, password FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "User not found" });
        }

        const user = userResult.rows[0];

        // Check password (plain text comparison here)
        if (user.password !== password) {
            return res.status(400).json({ error: "Invalid password" });
        }

        res.json({
            message: "Login successful",
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// Get user details
app.get('/userdetails', async (req, res) => {
    try {
        const { email } = req.query; // GET parameter ?email=value

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // Fetch user info from both tables
        const result = await pool.query(
            `SELECT u.full_name, u.email, w.balance
             FROM users u
             JOIN wallet w ON u.id = w.user_id
             WHERE u.email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({
            name: result.rows[0].full_name,
            email: result.rows[0].email,
            balance: result.rows[0].balance
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/deposit', async (req, res) => {
    try {
        const { email, amount } = req.body;

        if (!email || !amount) {
            return res.status(400).json({ error: "Email and amount are required" });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: "Amount must be greater than 0" });
        }

        // Step 1: Find the user
        const userResult = await pool.query(
            `SELECT id FROM users WHERE email = $1`,
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const userId = userResult.rows[0].id;

        // Step 2: Update wallet balance
        await pool.query(
            `UPDATE wallet 
             SET balance = balance + $1 
             WHERE user_id = $2`,
            [amount, userId]
        );

        // Step 3: Return updated balance
        const updatedWallet = await pool.query(
            `SELECT balance FROM wallet WHERE user_id = $1`,
            [userId]
        );

        res.json({
            message: "Deposit successful",
            newBalance: updatedWallet.rows[0].balance
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});


//route to withdraw 
app.post('/withdraw', async (req, res) => {
    try {
        const { email, amount } = req.body;

        if (!email || !amount) {
            return res.status(400).json({ error: "Email and amount are required" });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: "Withdrawal amount must be greater than zero" });
        }

        // Get user ID and current balance
        const userResult = await pool.query(
            `SELECT u.id, w.balance 
             FROM users u
             JOIN wallet w ON u.id = w.user_id
             WHERE u.email = $1`,
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const userId = userResult.rows[0].id;
        const currentBalance = parseFloat(userResult.rows[0].balance);

        if (currentBalance < amount) {
            return res.status(400).json({ error: "Insufficient balance" });
        }

        // Update balance
        const newBalance = currentBalance - amount;
        await pool.query(
            `UPDATE wallet SET balance = $1 WHERE user_id = $2`,
            [newBalance, userId]
        );

        res.json({
            message: "Withdrawal successful",
            newBalance
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

//to transfer money
app.post('/send', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sender_email, receiver_email, amount } = req.body;

        if (!sender_email || !receiver_email || !amount) {
            return res.status(400).json({ error: "Sender email, receiver email, and amount are required" });
        }
        if (amount <= 0) {
            return res.status(400).json({ error: "Amount must be greater than zero" });
        }

        await client.query('BEGIN');

        // Sender wallet
        const sender = await client.query(`
            SELECT u.id, w.balance
            FROM users u
            JOIN wallet w ON u.id = w.user_id
            WHERE u.email = $1
        `, [sender_email]);

        if (sender.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Sender not found" });
        }

        const senderId = sender.rows[0].id;
        const senderBalance = parseFloat(sender.rows[0].balance);

        if (senderBalance < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient balance" });
        }

        // Receiver wallet
        const receiver = await client.query(`
            SELECT u.id, w.balance
            FROM users u
            JOIN wallet w ON u.id = w.user_id
            WHERE u.email = $1
        `, [receiver_email]);

        if (receiver.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Receiver not found" });
        }

        const receiverId = receiver.rows[0].id;
        const receiverBalance = parseFloat(receiver.rows[0].balance);

        // Update balances
        await client.query(`UPDATE wallet SET balance = $1 WHERE user_id = $2`, [senderBalance - amount, senderId]);
        await client.query(`UPDATE wallet SET balance = $1 WHERE user_id = $2`, [receiverBalance + amount, receiverId]);

        await client.query('COMMIT');

        res.json({
            message: "Transfer successful",
            sender_new_balance: senderBalance - amount,
            receiver_new_balance: receiverBalance + amount
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server error" });
    } finally {
        client.release();
    }
});

// get all users details
app.get('/alluserdetails', async (req, res) => {
    try {
        // Join users and wallet table to fetch details
        const result = await pool.query(`
            SELECT u.id, u.full_name, u.email, w.balance
            FROM users u
            JOIN wallet w ON u.id = w.user_id
            ORDER BY u.id
        `);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});



app.listen(3000,()=>{
    console.log("server is running on 3000 port");
});