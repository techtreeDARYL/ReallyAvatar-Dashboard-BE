import express from 'express';
import session from 'express-session';
import mysql from 'mysql2';
import cors from 'cors';
import { config } from 'dotenv';
import OpenAI from "openai";

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sessionStore = new MySQLStore({}, pool.promise());

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

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

app.get('/asst_list/:id', async (req, res) => {
  try {
    const clientId = req.params.id;
    const [results] = await pool.promise().query(
      'SELECT asst_id, name, instructions, avatar_name, DATE_FORMAT(updated_at, "%Y-%m-%d %H:%i:%s") as updated_at FROM assistants WHERE client_id = ?', [clientId]
    );
    if (results.length > 0) {
      res.send(results);
    } else {
      res.status(401).json({ message: 'Failed to fetch Assistants List' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.get('/avatars_list/:id', async (req, res) => {
  try {
  const  clientId  = req.params.id;
  const [results] = await pool.promise().query(
    'SELECT name FROM client_avatars WHERE client_id = ?', [clientId]
  );
  if (results.length > 0) {
    res.send(results);
   } else {
    res.status(401).json({ message: 'Failed to fetch Assistants List' });
  }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/update_assistant/:asst_id', async (req, res) => {
  try {
    const asst_id = req.params.asst_id;
    const { name, instructions, avatar_name } = req.body;

    const myUpdatedAssistant = await openai.beta.assistants.update(
      asst_id, 
      {
        instructions: instructions, 
        name: name, 
      }
    );

    const [results] = await pool.promise().query(
      'UPDATE assistants SET name = ?, instructions = ?, avatar_name = ? WHERE asst_id = ?',
      [name, instructions, avatar_name, asst_id]
    );

 
    if (results.affectedRows > 0) {
      res.status(200).json({
        asst_id,
        name,
        instructions,
        avatar_name,
      });
    } else {
      res.status(404).json({ message: 'Assistant not found or no changes made' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/create_assistant/:client_id', async (req, res) => {
  try {
    const clientId = req.params.client_id; 
    const { name, instructions, avatar_name } = req.body; 
    const currentTimestamp = formatDate(new Date());

    const myAssistant = await openai.beta.assistants.create({
      instructions: instructions, 
      name: name,                 
      model: "gpt-4o",           
    });

    const [results] = await pool.promise().query(
      'INSERT INTO assistants (asst_id, client_id, name, instructions, avatar_name) VALUES (?, ?, ?, ?, ?)',
      [myAssistant.id, clientId, name, instructions, avatar_name]
    );

    if (results.affectedRows > 0) {
      res.status(201).json({
        message: 'Assistant created successfully',
        assistant: {
          asst_id: myAssistant.id,
          client_id: clientId,
          name: name,
          instructions: instructions,
          avatar_name: avatar_name,
          updated_at: currentTimestamp,
        },
      });
    } else {
      res.status(500).json({ message: 'Failed to save assistant in the database' });
    }
  } catch (error) {
    // Handle errors gracefully and respond with a 500 status
    console.error('Error creating assistant:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all threads for a specific assistant
app.get('/threads_list/:asstId', async (req, res) => {
  try {
    const asstId = req.params.asstId;
    const [results] = await pool.promise().query(
      'SELECT * FROM threads WHERE asst_id = ?', [asstId]
    );
    
    if (results.length > 0) {
      res.status(200).json(results);
    } else {
      res.status(404).json({ message: 'No threads found for the assistant.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all messages for a specific thread
app.get('/messages_list/:threadId', async (req, res) => {
  try {
    const threadId = req.params.threadId;
    const [results] = await pool.promise().query(
      'SELECT * FROM messages WHERE thread_id = ?', [threadId]
    );
    
    if (results.length > 0) {
      res.status(200).json(results);
    } else {
      res.status(404).json({ message: 'No messages found for the thread.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

