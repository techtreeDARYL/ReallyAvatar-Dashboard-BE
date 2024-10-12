import express from 'express';
import session from 'express-session';
import mysql from 'mysql2';
import cors from 'cors';
import { config } from 'dotenv';

// Use require for express-mysql-session
const MySQLStore = require('express-mysql-session')(session); // Fixes the issue

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

const sessionStore = new MySQLStore({}, pool.promise());

app.use(session({
  //key: 'reallyavatar_cookie',  // The name of the session cookie
  secret: process.env.SESSION_SECRET || 'techtreeglobal', // Ensure this is set in .env
  store: sessionStore, // Store sessions in MySQL
  resave: false,  // Don't save session if unmodified
  saveUninitialized: true,  // Don't create session until something stored
  cookie: {
      maxAge: 1000 * 60 * 60 * 24,  // Session cookie will expire after 24 hours
      secure: false, // Should be true if you're using HTTPS (in production)
  }
}));

// Example login endpoint using async/await with ES6 modules
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [results] = await pool.promise().query(
      'SELECT * FROM clients WHERE (email = ? AND password = ?) AND isActive = 1',
      [email, password]
    );
    if (results.length > 0) {
      // Save user info in session
      req.session.user = { id: results[0].id, email: results[0].email, name: results[0].name };
      res.status(200).json({ message: 'Login successful', user: results[0] });
      console.log('Session after login:', req.session); // Log session data for debugging
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/logout', (req, res) => {
  // Destroy the session
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed', error: err });
    }

    // Clear the cookie on the client side
    res.clearCookie('reallyavatar_cookie');
    
    return res.status(200).json({ message: 'Logout successful' });
  });
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

