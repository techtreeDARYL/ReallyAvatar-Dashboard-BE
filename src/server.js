import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import { config } from 'dotenv';

config(); // Load environment variables from .env file

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json()); // Built-in middleware for express to handle JSON

// Create a MySQL pool
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

// Example login endpoint using async/await with ES6 modules
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [results] = await pool.promise().query(
      'SELECT * FROM clients WHERE email = ? AND password = ?',
      [email, password]
    );
    if (results.length > 0) {
      res.status(200).json({ message: 'Login successful', user: results[0] });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
