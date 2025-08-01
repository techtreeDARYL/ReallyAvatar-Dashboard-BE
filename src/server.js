import express from 'express';
import session from 'express-session';
import mysql from 'mysql2';
import cors from 'cors';
import { config } from 'dotenv';
import OpenAI from "openai";
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import fsync from "fs";
import https from "https";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // make sure this folder exists
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeName = `${base}-${timestamp}${ext}`;
    cb(null, safeName);
  }
});
const UPLOADS_DIR = 'C:/Users/administrator/Desktop/090624/ReallyAvatar-Backend-090624/uploads';

const upload = multer({ storage });

// Use require for express-mysql-session
const MySQLStore = require('express-mysql-session')(session); // Fixes the issue

config(); // Load environment variables from .env file

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json()); // Built-in middleware for express to handle JSON
// const key = fsync.readFileSync('./certs/private.key');
// const cert = fsync.readFileSync('./certs/certificate.crt');
// const server = https.createServer({ key, cert }, app);

// Create a MySQL pool
const pool = mysql.createPool({
  connectionLimit: 50,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

const getOpenAIClientForGroup = (groupName) => {
  const key = process.env[`OPENAI_API_KEY_${groupName?.toUpperCase()}`];
  if (!key) {
    throw new Error(`Missing API key for group: ${groupName}`);
  }
  return new OpenAI({ apiKey: key });
};




const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

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
      req.session.user = {
        id: results[0].id,
        email: results[0].email,
        name: results[0].name,
        role: results[0].role,             
        client_group: results[0].client_group 
      };
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
      'SELECT asst_id, name, instructions, avatar_name, model,temperature, top_p, voice_id, isFS, background_id, lang, DATE_FORMAT(updated_at, "%Y-%m-%d %H:%i:%s") as updated_at FROM assistants WHERE client_id = ? and isDeleted = 0 ORDER BY created_at DESC', [clientId]
    );
    if (results.length > 0) {
      res.send(results);
    } else {
      res.status(200).json({ message: 'Failed to fetch Assistants List' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.get('/avatars_list/:id', async (req, res) => {
  try {
  const  clientId  = req.params.id;
  const [results] = await pool.promise().query(
    'SELECT name FROM client_avatars WHERE client_id = ? or client_id = 2', [clientId]
  );
  if (results.length > 0) {
    res.send(results);
   } else {
    res.status(200).json({ message: 'Failed to fetch Assistants List' });
  }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/update_assistant/:asst_id', async (req, res) => {
  
  try {
    const asst_id = req.params.asst_id;
    const { name, instructions, avatar_name, model, temperature, top_p,voice_id,background_id,language,client_group } = req.body;
    const [rows] = await pool.promise().query(
      `SELECT c.client_group FROM assistants a JOIN clients c ON a.client_id = c.id WHERE a.asst_id = ?`,
      [asst_id]
    );
    if (!rows.length) return res.status(404).json({ message: "Assistant not found" });
    const openai = getOpenAIClientForGroup(rows[0].client_group);

  
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
      'UPDATE assistants SET name = ?, instructions = ?, avatar_name = ?, model = ?, temperature = ?, top_p = ?, voice_id = ?, background_id = ?, lang  = ? WHERE asst_id = ?',
      [name, instructions, avatar_name,  model, temperature, top_p, voice_id,background_id, language, asst_id]
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

// app.post('/create_assistant/:client_id', async (req, res) => {
//   try {
//     const clientId = req.params.client_id; 
//     const { name, instructions, avatar_name } = req.body; 
//     const currentTimestamp = formatDate(new Date());

//     const myAssistant = await openai.beta.assistants.create({
//       instructions: instructions, 
//       name: name,                 
//       model: "gpt-4o",           
//     });
//     const start_ = await pool.promise().query('START TRANSACTION');
//     const [results] = await pool.promise().query(
//       'INSERT INTO assistants (asst_id, client_id, name, instructions, avatar_name) VALUES (?, ?, ?, ?, ?)',
//       [myAssistant.id, clientId, name, instructions, avatar_name]
//     );
//     const commit = await pool.promise().query('COMMIT');
//     if (results.affectedRows > 0) {
//       res.status(201).json({
//         message: 'Assistant created successfully',
//         assistant: {
//           asst_id: myAssistant.id,
//           client_id: clientId,
//           name: name,
//           instructions: instructions,
//           avatar_name: avatar_name
//         },
//       });
//     } else {
//       res.status(500).json({ message: 'Failed to save assistant in the database' });
//     }
//   } catch (error) {
//     // Handle errors gracefully and respond with a 500 status
//     console.error('Error creating assistant:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// Get all threads for a specific assistant

app.post('/create_assistant/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const clientGroup = req.body.client_group || req.query.group;
  const openai = getOpenAIClientForGroup(clientGroup);
  const { name, instructions, avatar_name, template_id } = req.body;

  let assistantData;

  try {
    if (template_id) {
      const [templates] = await pool.promise().query(
        'SELECT * FROM assistant_templates WHERE id = ?',
        [template_id]
      );
      if (templates.length === 0) {
        return res.status(404).json({ message: 'Template not found' });
      }

      const template = templates[0];
      assistantData = {
        name: name || template.name,
        instructions: instructions || template.instructions,
        avatar_name: avatar_name || template.avatar_name,
        model: template.model,
        temperature: template.temperature,
        top_p: template.top_p,
        voice_id: template.voice_id,
        background_id: template.background_id,
        lang: template.lang
      };
    } else {
      assistantData = { name, instructions, avatar_name, model: 'gpt-4o', temperature: 1.0, top_p: 1.0 };
    }

    const myAssistant = await openai.beta.assistants.create({
      instructions: assistantData.instructions,
      name: assistantData.name,
      model: assistantData.model,
      temperature: assistantData.temperature,
      top_p: assistantData.top_p
    });

    const [result] = await pool.promise().query(
      'INSERT INTO assistants (asst_id, client_id, name, instructions, avatar_name, model, temperature, top_p, voice_id, background_id, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        myAssistant.id, clientId, assistantData.name, assistantData.instructions, assistantData.avatar_name,
        assistantData.model, assistantData.temperature, assistantData.top_p, assistantData.voice_id,
        assistantData.background_id, assistantData.lang
      ]
    );

    res.status(201).json({
      message: 'Assistant created from template successfully',
      assistant: {
        asst_id: myAssistant.id,
        client_id: clientId,
        ...assistantData
      }
    });
  } catch (error) {
    console.error('Error creating assistant:', error);
    res.status(500).json({ error: error.message });
  }
});

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

  app.put('/toggle_file_search/:asst_id', async (req, res) => {
    const { enabled, client_group } = req.body;
    const asstId = req.params.asst_id;

    try {
      const openai = getOpenAIClientForGroup(client_group);
      const updateData = enabled
        ?  { tools: [{ type: "file_search" }],}
        : {  tools: [],};
      const updated = await openai.beta.assistants.update(asstId, updateData);

      await pool.promise().query(
        'UPDATE assistants SET isFS = ? WHERE asst_id = ?',
        [enabled ? 1 : 0, asstId]
      );

      res.status(200).json({
        message: `File search ${enabled ? 'enabled' : 'disabled'}`,
        assistant: updated,
      });
    } catch (error) {
      console.error('Error toggling file search:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post('/upload_files/:asstId', upload.array('files', 10), async (req, res) => {
    const assistantId = req.params.asstId;
    const { client_group } = req.body;
    const files = req.files;
  
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
  
    try {
      const openai = getOpenAIClientForGroup(client_group);
      // 1. Check if vector store exists
      const [rows] = await pool.promise().query(
        `SELECT vector_store_id FROM assistant_files WHERE assistant_id = ? LIMIT 1`,
        [assistantId]
      );
  
      let vectorStoreId;
  
      if (rows.length > 0 && rows[0].vector_store_id) {
        vectorStoreId = rows[0].vector_store_id;
      } else {
        const vectorStore = await openai.beta.vectorStores.create({
          name: `vs_${assistantId}`
        });
        vectorStoreId = vectorStore.id;
      }
  
      // 2. Rename files with proper extension
      // for (const file of files) {
      //   const ext = path.extname(file.originalname);
      
      //   if (!ext) {
      //     console.warn(`Skipping file ${file.originalname}: missing extension`);
      //     continue;
      //   }
      
      //   const correctedPath = `${file.path}${ext}`;
      
      //   try {
      //     fs.renameSync(file.path, correctedPath);
      //     file.path = correctedPath;
      //   } catch (err) {
      //     console.error(`Failed to rename file ${file.originalname}:`, err);
      //     return res.status(500).json({ error: 'File renaming failed' });
      //   }
      // }
      
  
      // 3. Create readable streams
  //     const fileStreams = files
  // .filter(file => fs.existsSync(file.path)) // make sure the file is still there
  // .map(file => fs.createReadStream(file.path));
  // console.log("File paths used for streaming:", files.map(f => f.path));
  const uploadedFiles = [];

  const fileStreams = files.map(file => {
    uploadedFiles.push({
      name: file.originalname,
      size: file.size
    });
  
    return fs.createReadStream(file.path);
  });

     
      // 4. Upload files to vector store and wait for processing
      const batch = await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
        files: fileStreams
      });
      // 5. Clean up temp files
      // for (const file of files) {
      //   if (fs.existsSync(file.path)) {
      //     fs.unlinkSync(file.path);
      //   }
      // }
  
      // 6. Save file metadata to DB
      const list = await openai.beta.vectorStores.files.list(vectorStoreId);
      const recentUploads = list.data.slice(-files.length); 
      const savedFileData = recentUploads.map((file, index) => [
        file.id,
        uploadedFiles[index].name,
        uploadedFiles[index].size,
        assistantId,
        vectorStoreId,
        new Date()
      ]);
      

      await pool.promise().query(
        `INSERT INTO assistant_files (openai_file_id, file_name, file_size, assistant_id, vector_store_id, uploaded_at)
         VALUES ?`,
        [savedFileData]
      );
  
      // 7. Attach vector store to assistant
      await openai.beta.assistants.update(assistantId, {
        tools: [{ type: "file_search" }],
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStoreId]
          }
        }
      });
  
      res.status(200).json({
        message: 'Files uploaded, indexed, and attached to assistant successfully.',
        files: savedFileData.map(([id, name, size]) => ({ id, name, size }))
      });
  
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message || 'Upload failed' });
    }
  });

  app.delete('/delete_file/:fileId', async (req, res) => {

    const fileId = req.params.fileId;
    const client_group = req.body.client_group;
    
    try {
      const openai = getOpenAIClientForGroup(client_group);
      const [rows] = await pool.promise().query(
        'SELECT * FROM assistant_files WHERE openai_file_id = ? LIMIT 1',
        [fileId]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({ error: 'File not found in database' });
      }
  
      const { file_name, vector_store_id } = rows[0];
  
  
      await openai.beta.vectorStores.files.del(vector_store_id, fileId);
     
      const localPath = path.join('uploads', file_name);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
  
    
      await pool.promise().query(
        'DELETE FROM assistant_files WHERE openai_file_id = ?',
        [fileId]
      );
  
      res.status(200).json({ message: 'File deleted successfully' });
  
    } catch (err) {
      console.error('Delete file error:', err.message);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });
  
  app.get('/asst_files/:assistantId', async (req, res) => {
    const assistantId = req.params.assistantId;
  
    try {
      const [rows] = await pool.promise().query(
        'SELECT openai_file_id AS id, file_name AS name, file_size AS size FROM assistant_files WHERE assistant_id = ? ORDER BY uploaded_at DESC',
        [assistantId]
      );
  
      res.json(rows);
    } catch (err) {
      console.error('Failed to fetch files:', err.message);
      res.status(500).json({ error: 'Failed to load files' });
    }
  });

  app.post('/add_function/:assistantId', async (req, res) => {
    const assistantId = req.params.assistantId;
    const { client_group, ...functionBody } = req.body;
    
    const tool = {
      type: "function",
      function: functionBody // wrap what user submitted
    };
  
    try {
      // Get current assistant tools
      const openai = getOpenAIClientForGroup(client_group);
      const assistant = await openai.beta.assistants.retrieve(assistantId);
      const existingTools = assistant.tools || [];
  
      // Update assistant with new tool
      const updated = await openai.beta.assistants.update(assistantId, {
        tools: [...existingTools, tool]
      });
      // Save full tool object in DB
      await pool.promise().query(
        `INSERT INTO assistant_functions (assistant_id, name, parameters)
         VALUES (?, ?, ?)`,
        [assistantId, functionBody.name, JSON.stringify(tool)]
      );
  
      res.status(200).json({ message: 'Function added', tools: updated.tools });
    } catch (err) {
      console.error('Function add error:', err.message);
      res.status(500).json({ error: `Failed to add function: ${err.message}` });

    }
  });

  app.get('/functions/:assistantId', async (req, res) => {
    const assistantId = req.params.assistantId;
  
    try {
      const [rows] = await pool.promise().query(
        `SELECT name FROM assistant_functions WHERE assistant_id = ?`,
        [assistantId]
      );
  
      const functions = rows.map(row => ({
        name: row.name,
      }));
  
      res.status(200).json(functions);
    } catch (err) {
      console.error('Failed to load functions:', err.message);
      res.status(500).json({ error: 'Failed to fetch functions' });
    }
  });
  
  app.delete('/functions/:assistantId/:functionName', async (req, res) => {
    const { assistantId, functionName } = req.params;
    const client_group = req.body.client_group;
    try {
       const openai = getOpenAIClientForGroup(client_group);
      // 1. Get current assistant tools
      const assistant = await openai.beta.assistants.retrieve(assistantId);
      const updatedTools = (assistant.tools || []).filter(tool => {
        return !(tool.type === 'function' && tool.function?.name === functionName);
      });
  
      // 2. Update assistant with filtered tools (function removed)
      await openai.beta.assistants.update(assistantId, {
        tools: updatedTools
      });
  
      // 3. Delete from DB
      await pool.promise().query(
        'DELETE FROM assistant_functions WHERE assistant_id = ? AND name = ?',
        [assistantId, functionName]
      );
  
      res.status(200).json({ message: 'Function deleted successfully' });
    } catch (err) {
      console.error('Function delete error:', err.message);
      res.status(500).json({ error: 'Failed to delete function' });
    }
  });
  
  app.put('/softdelete_asst/:asst_id',  async (req,res)=>{
     const asst_id = req.params.asst_id;
      
     try {
         const [results] = await pool.promise().query(
        'UPDATE assistants SET isDeleted = 1 WHERE asst_id = ?',
        [ asst_id] );
      
       res.status(200).json({ message: 'Avatar deleted successfully' });
     } catch (err) {
      console.error('Avatar delete error:', err.message);
      res.status(500).json({ error: 'Failed to delete Avatar' });
     }
    

  });
  
  app.get('/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(UPLOADS_DIR, fileName);

  res.download(filePath, fileName, (err) => {
    if (err) {
      console.error('Download error:', err);
      res.status(404).send('File not found.');
    }
  });
});

//ENRICO RAV
app.get('/dashboard/thread-stats/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT 
      DATE(t.created_at) AS date,
      COUNT(*) AS new_threads
    FROM threads t
    JOIN assistants a ON t.asst_id = a.asst_id
    WHERE a.client_id = ?
    GROUP BY DATE(t.created_at)
    ORDER BY date ASC;
  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    res.json(results);
  } catch (err) {
    console.error('Error fetching thread stats:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/dashboard/message-stats/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT DATE(m.timestamp) AS date, COUNT(*) AS message_count
    FROM messages m
    JOIN threads t ON m.thread_id = t.thread_id
    JOIN assistants a ON t.asst_id = a.asst_id
    WHERE a.client_id = ?
    GROUP BY DATE(m.timestamp)
    ORDER BY DATE(m.timestamp);
  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    res.json(results);
  } catch (err) {
    console.error('Error fetching message stats:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/dashboard/file-stats/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT f.id, f.thread_id, f.file_name, f.file_size, f.timestamp
    FROM files f
    JOIN threads t ON f.thread_id = t.thread_id
    JOIN assistants a ON t.asst_id = a.asst_id
    WHERE a.client_id = ?
    ORDER BY f.timestamp DESC
    LIMIT 10;
  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    res.json(results);
  } catch (err) {
    console.error('Error fetching file stats:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/dashboard/response-time-stats/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
      SELECT 
    t.thread_id,
    ROUND(AVG(TIMESTAMPDIFF(SECOND, user_msg.timestamp, assistant_msg.timestamp)), 2) AS avg_response_time
  FROM messages user_msg
  JOIN messages assistant_msg 
    ON assistant_msg.thread_id = user_msg.thread_id
  AND assistant_msg.timestamp > user_msg.timestamp
  AND assistant_msg.sender = 'assistant'
  JOIN threads t 
    ON user_msg.thread_id = t.thread_id
  JOIN assistants a 
    ON t.asst_id = a.asst_id
  WHERE user_msg.sender = 'user'
    AND a.client_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM messages m
      WHERE m.thread_id = user_msg.thread_id
        AND m.timestamp > user_msg.timestamp
        AND m.timestamp < assistant_msg.timestamp
        AND m.sender = 'assistant'
    )
  GROUP BY t.thread_id;

  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    res.json(results.map(r => ({
  ...r,
  avg_response_time: Number(r.avg_response_time)
})));
  } catch (err) {
    console.error('Error fetching response time stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// For Dashboard - Messages Heatmap (Day vs Hour)
app.get('/dashboard/messages-heatmap/:client_id', async (req, res) => {
  const clientId = req.params.client_id;
  const sql = `
    SELECT 
      DAYOFWEEK(m.timestamp) - 1 AS day_index, -- Sunday=0
      HOUR(m.timestamp) AS hour,
      COUNT(*) AS count
    FROM messages m
    JOIN threads t ON m.thread_id = t.thread_id
    JOIN assistants a ON t.asst_id = a.asst_id
    WHERE a.client_id = ?
    GROUP BY day_index, hour
    ORDER BY day_index, hour;
  `;
  try {
    const [results] = await pool.promise().query(sql, [clientId]);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const data = results.map(row => ({
      day: days[row.day_index],
      hour: row.hour,
      count: row.count
    }));
    res.json(data);
  } catch (err) {
    console.error('Error fetching messages heatmap:', err);
    res.status(500).json({ error: err.message });
  }
});

//Main Template Endpoints
app.get('/templates/:client_group', async (req, res) => {
  const group = req.params.client_group;

  try {
    const [results] = await pool.promise().query(
      'SELECT * FROM assistant_templates WHERE client_group = ?',
      [group]
    );
    res.json(results);
  } catch (err) {
    console.error('Error fetching templates:', err.message);
    res.status(500).json({ error: 'Template fetch failed' });
  }
});

app.get('/admin/templates', async (req, res) => {
  const [rows] = await pool.promise().query('SELECT * FROM assistant_templates');
  res.json(rows);
});

app.put('/admin/template/:id', async (req, res) => {
  const id = req.params.id;
  const {
    name,
    instructions,
    avatar_name,
    model,
    temperature,
    top_p,
    voice_id,
    background_id,
    lang,
    client_group
  } = req.body;

  try {
    const [result] = await pool.promise().query(
      `UPDATE assistant_templates SET 
        name = ?, instructions = ?, avatar_name = ?, model = ?, 
        temperature = ?, top_p = ?, voice_id = ?, background_id = ?, 
        lang = ?, client_group = ?
      WHERE id = ?`,
      [name, instructions, avatar_name, model, temperature, top_p, voice_id, background_id, lang, client_group, id]
    );

    if (result.affectedRows > 0) {
      res.status(200).json({ message: 'Template updated successfully' });
    } else {
      res.status(404).json({ message: 'Template not found' });
    }
  } catch (err) {
    console.error('Template update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/template/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [result] = await pool.promise().query(
      'DELETE FROM assistant_templates WHERE id = ?', [id]
    );

    if (result.affectedRows > 0) {
      res.status(200).json({ message: 'Template deleted successfully' });
    } else {
      res.status(404).json({ message: 'Template not found' });
    }
  } catch (err) {
    console.error('Template delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/client-groups', async (req, res) => {
  try {
    const [rows] = await pool.promise().query(
      'SELECT DISTINCT client_group FROM assistant_templates WHERE client_group IS NOT NULL'
    );
    res.json(rows.map(r => r.client_group));
  } catch (err) {
    console.error('Error fetching client groups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/assistants', async (req, res) => {
  try {
    const [rows] = await pool.promise().query(`
      SELECT 
        a.asst_id, a.name, a.avatar_name, a.model, a.instructions, 
        a.temperature, a.top_p, a.voice_id, a.background_id, a.lang, a.isFS,
        DATE_FORMAT(a.updated_at, "%Y-%m-%d %H:%i:%s") as updated_at,
        c.name AS creator_name, c.client_group
      FROM assistants a
      JOIN clients c ON a.client_id = c.id
      WHERE a.isDeleted = 0
    `);

    res.json(rows);
  } catch (err) {
    console.error('Error fetching assistants:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/assistant-details/:asst_id', async (req, res) => {
  const asstId = req.params.asst_id;

  try {
    const [rows] = await pool.promise().query(`
      SELECT 
        a.name, a.instructions, a.avatar_name, a.model, a.temperature, a.top_p,
        a.voice_id, a.background_id, a.lang, c.client_group
      FROM assistants a
      JOIN clients c ON a.client_id = c.id
      WHERE a.asst_id = ?
    `, [asstId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Assistant not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching assistant details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/template', async (req, res) => {
  const {
    name,
    instructions,
    avatar_name,
    model,
    temperature,
    top_p,
    voice_id,
    background_id,
    lang,
    client_group
  } = req.body;

  try {
    const [result] = await pool.promise().query(`
      INSERT INTO assistant_templates (
        name, instructions, avatar_name, model,
        temperature, top_p, voice_id, background_id, lang, client_group
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, instructions, avatar_name, model, temperature, top_p, voice_id, background_id, lang, client_group]
    );

    res.status(201).json({ message: 'Template created successfully', id: result.insertId });
  } catch (err) {
    console.error('Template creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//Groups Management
app.get('/admin/groups', async (req, res) => {
  try {
    const [rows] = await pool.promise().query(`SELECT * FROM groups ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch groups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/group', async (req, res) => {
  const { name, description } = req.body;
  try {
    const [result] = await pool.promise().query(
      `INSERT INTO groups (name, description) VALUES (?, ?)`,
      [name, description || '']
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('Group creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/admin/group/:id', async (req, res) => {
  const { name, description } = req.body;
  const id = req.params.id;

  try {
    await pool.promise().query(
      `UPDATE groups SET name = ?, description = ? WHERE id = ?`,
      [name, description, id]
    );
    res.json({ message: 'Group updated successfully' });
  } catch (err) {
    console.error('Group update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/group/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.promise().query(`DELETE FROM groups WHERE id = ?`, [id]);
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Group delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//Users Management
app.get('/admin/users', async (req, res) => {
  const group = req.query.group;

  try {
    const query = group
      ? `SELECT * FROM clients WHERE client_group = ? ORDER BY id DESC`
      : `SELECT * FROM clients ORDER BY id DESC`;

    const [rows] = await pool.promise().query(query, group ? [group] : []);
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/user', async (req, res) => {
  const { name, email, password, client_group, role, isActive } = req.body;

  try {
    await pool.promise().query(
      `INSERT INTO clients (name, email, password, client_group, role, isActive)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, password, client_group, role, isActive]
    );
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    console.error('User creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/admin/user/:id', async (req, res) => {
  const id = req.params.id;
  const { name, email, password, client_group, role, isActive } = req.body;

  try {
    await pool.promise().query(
      `UPDATE clients SET name = ?, email = ?, password = ?, client_group = ?, role = ?, isActive = ?
       WHERE id = ?`,
      [name, email, password, client_group, role, isActive, id]
    );
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('User update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/user/:id', async (req, res) => {
  const id = req.params.id;

  try {
    await pool.promise().query(`DELETE FROM clients WHERE id = ?`, [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('User delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});


//Group Admin Endpoints
app.get('/group/users', async (req, res) => {
  const { group } = req.query;

  if (!group) {
    return res.status(400).json({ error: 'Missing group parameter' });
  }

  try {
    const [rows] = await pool.promise().query(
      `SELECT * FROM clients WHERE client_group = ? ORDER BY id DESC`,
      [group]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch group users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/group/assistants', async (req, res) => {
  const { group } = req.query;

  if (!group) {
    return res.status(400).json({ error: 'Missing group parameter' });
  }

  try {
    const [rows] = await pool.promise().query(`
      SELECT 
      a.asst_id, a.name, a.avatar_name, a.model, a.instructions,
      a.temperature, a.top_p, a.voice_id, a.background_id, a.lang, a.isFS,
      DATE_FORMAT(a.updated_at, "%Y-%m-%d %H:%i:%s") as updated_at,
      c.name AS creator_name, c.client_group
      FROM assistants a
      JOIN clients c ON a.client_id = c.id
      WHERE a.isDeleted = 0 AND c.client_group = ?
      ORDER BY a.updated_at DESC

    `, [group]);

    res.json(rows);
  } catch (err) {
    console.error('Error fetching group assistants:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

