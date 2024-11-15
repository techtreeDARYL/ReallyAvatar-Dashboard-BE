import express from 'express';
import session from 'express-session';
import mysql from 'mysql2';
import cors from 'cors';
import { config } from 'dotenv';
import OpenAI from "openai";
import path from 'path';
import fs from 'fs';


// Use require for express-mysql-session
const MySQLStore = require('express-mysql-session')(session); // Fixes the issue

config(); // Load environment variables from .env file

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json()); // Built-in middleware for express to handle JSON

// Create a MySQL pool
const pool = mysql.createPool({
  connectionLimit: 50,
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
      'SELECT asst_id, name, instructions, avatar_name, model,temperature, top_p, DATE_FORMAT(updated_at, "%Y-%m-%d %H:%i:%s") as updated_at FROM assistants WHERE client_id = ? ORDER BY created_at DESC', [clientId]
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
    const { name, instructions, avatar_name, model, temperature, top_p } = req.body;
    console.log("Updating database with values:", {
      name,
      instructions,
      avatar_name,
      model,
      temperature,
      top_p,
      asst_id
    });
    const myUpdatedAssistant = await openai.beta.assistants.update(
      asst_id, 
      {
        instructions: instructions, 
        name: name, 
        model: model,
        top_p: top_p,
        temperature: temperature
      }
    );

    const [results] = await pool.promise().query(
      'UPDATE assistants SET name = ?, instructions = ?, avatar_name = ?, model = ?, temperature = ?, top_p = ? WHERE asst_id = ?',
      [name, instructions, avatar_name,  model, temperature, top_p, asst_id]
    );

 
    if (results.affectedRows > 0) {

      const [updatedAssistant] = await pool.promise().query(
        'SELECT asst_id, name, instructions, avatar_name, model, temperature, top_p, DATE_FORMAT(updated_at, "%Y-%m-%d %H:%i:%s") as updated_at FROM assistants WHERE asst_id = ?',
        [asst_id]
      );
     if (updatedAssistant.length > 0) {
        res.status(200).json(updatedAssistant[0]); // Send the updated assistant data back
      } else {
        res.status(404).json({ message: 'Assistant not found after update' });
      }
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
    const start_ = await pool.promise().query('START TRANSACTION');
    const [results] = await pool.promise().query(
      'INSERT INTO assistants (asst_id, client_id, name, instructions, avatar_name) VALUES (?, ?, ?, ?, ?)',
      [myAssistant.id, clientId, name, instructions, avatar_name]
    );
    const commit = await pool.promise().query('COMMIT');
    if (results.affectedRows > 0) {
      res.status(201).json({
        message: 'Assistant created successfully',
        assistant: {
          asst_id: myAssistant.id,
          client_id: clientId,
          name: name,
          instructions: instructions,
          avatar_name: avatar_name
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

//For Dashboard - Assistant Activity
app.get('/assistant-activity/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT MONTH(messages.timestamp) as month, COUNT(messages.id) as message_count
    FROM messages
    JOIN threads ON messages.thread_id = threads.thread_id
    JOIN assistants ON threads.asst_id = assistants.asst_id
    WHERE assistants.client_id = ?
    GROUP BY MONTH(messages.timestamp)
    ORDER BY MONTH(messages.timestamp);
  `;
  const [results] = await pool.promise().query(sql, [clientId]);
  res.json(results);
});

//For Dashboard - Assistant Creation timeline
app.get('/assistant-creation-timeline/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT YEAR(created_at) as year, MONTH(created_at) as month, COUNT(*) as assistant_count
    FROM assistants
    WHERE client_id = ?
    GROUP BY YEAR(created_at), MONTH(created_at)
    ORDER BY year, month;
  `;
  const [results] = await pool.promise().query(sql, [clientId]);
  res.json(results);
});


//For Dashboard - Message Volume overtime
app.get('/message-volume/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT WEEK(messages.timestamp) as week, COUNT(*) as message_count
    FROM messages
    JOIN threads ON messages.thread_id = threads.thread_id
    JOIN assistants ON threads.asst_id = assistants.asst_id
    WHERE assistants.client_id = ?
    GROUP BY WEEK(messages.timestamp)
    ORDER BY WEEK(messages.timestamp);
  `;
  const [results] = await pool.promise().query(sql, [clientId]);
  res.json(results);
});

//For Dashboard - Average response time
app.get('/average-response-time/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT response_times.asst_id, response_times.name, 
       AVG(response_times.response_time) AS avg_response_time
    FROM (
        SELECT user_messages.thread_id, assistants.asst_id, assistants.name,
              TIMESTAMPDIFF(SECOND, user_messages.timestamp, MIN(assistant_messages.timestamp)) AS response_time
        FROM messages AS user_messages
        JOIN messages AS assistant_messages 
          ON user_messages.thread_id = assistant_messages.thread_id
          AND assistant_messages.sender = 'assistant' 
          AND user_messages.sender = 'user' 
          AND assistant_messages.timestamp > user_messages.timestamp
        JOIN threads ON user_messages.thread_id = threads.thread_id
        JOIN assistants ON threads.asst_id = assistants.asst_id
        WHERE assistants.client_id = ?
        GROUP BY user_messages.id, assistants.asst_id
    ) AS response_times
    GROUP BY response_times.asst_id;
  `;
  const [results] = await pool.promise().query(sql, [clientId]);
  res.json(results);
});

//For Dashboard - Thread Activity Over Time
app.get('/thread-activity/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT MONTH(threads.created_at) as month, COUNT(*) as thread_count
    FROM threads
    JOIN assistants ON threads.asst_id = assistants.asst_id
    WHERE assistants.client_id = ?
    GROUP BY MONTH(threads.created_at)
    ORDER BY MONTH(threads.created_at);
  `;
  const [results] = await pool.promise().query(sql, [clientId]);
  res.json(results);
});

//For Dashboard - Most Active Thread
app.get('/most-active-threads/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT threads.thread_id, COUNT(messages.id) as message_count
    FROM threads
    JOIN messages ON threads.thread_id = messages.thread_id
    JOIN assistants ON threads.asst_id = assistants.asst_id
    WHERE assistants.client_id = ?
    GROUP BY threads.thread_id
    ORDER BY message_count DESC
    LIMIT 5;
  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    res.json(results);
  } catch (error) {
    console.error("Error fetching most active threads:", error);
    res.status(500).json({ error: error.message });
  }
});

//Files
app.get('/files_list/:asstId', async (req, res) => {
  try {
    const assistantId = req.params.asstId; // Assistant ID passed as a parameter
    // Query to fetch files associated with the assistant
    const [results] = await pool.promise().query(
      `SELECT f.id, f.thread_id, f.file_name, f.file_size, f.timestamp
       FROM files f
       JOIN threads t ON f.thread_id = t.thread_id
       WHERE t.asst_id = ?`,
      [assistantId]
    );

    if (results.length > 0) {
      res.send(results); // Send the list of files
    } else {
      res.status(200).json({ message: 'No files found for this assistant.', files: [] });
    }
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: error.message });
  }
});


app.get('/download/:fileName', async (req, res) => {
  try {
    const fileName = req.params.fileName; // File name from URL
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || path.join(__dirname, 'uploads'); // Get uploads directory
    const safeFileName = path.basename(fileName); // Sanitize the file name to prevent directory traversal
    const filePath = path.join(uploadsDirectory, safeFileName); // Construct the full path

    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found.' });
    }

    // Send the file to the client
    res.download(filePath, safeFileName, (err) => {
      if (err) {
        console.error('Error while downloading the file:', err);
        res.status(500).json({ error: 'Failed to download the file.' });
      }
    });
  } catch (error) {
    console.error('Error in download endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});




app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

