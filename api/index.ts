import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const axios = require('axios');

app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("common"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

// Test Database Connection
const testDatabaseConnection = async () => {
  try {
    await prisma.$connect();
    console.log('Database connected successfully!');
  } catch (error) {
    console.error('Error connecting to the database:', error);
  }
};

// Home Page Route with "Login with GitHub" Button
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Express on Vercel</title>
      </head>
      <body>
        <h1>Welcome to Express on Vercel</h1>
        <a href="/auth/github">
          <button style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
            Login with GitHub
          </button>
        </a>
      </body>
    </html>
  `);
});

// Redirect to GitHub for Authorization
app.get('/auth/github', (req, res) => {
  const clientId = process.env.CLIENT_ID;
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}`);
});

// GitHub OAuth Callback - Exchange Code for Access Token
app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).send("Authorization code not provided.");
  }

  const body = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code
  };
  const opts = { headers: { accept: 'application/json' } };

  try {
    // Request access token from GitHub
    const response = await axios.post('https://github.com/login/oauth/access_token', body, opts);
    const accessToken = response.data.access_token;

    if (!accessToken) {
      return res.status(400).send("Failed to get access token from GitHub.");
    }

    // Redirect to homepage or another page with token
    res.redirect(`/?token=${accessToken}`);
  } catch (error) {
    console.error('Error fetching access token:', error);
    res.status(500).send("Error fetching access token.");
  }
});

// Start Server and Test Database Connection
testDatabaseConnection().then(() => {
  app.listen(3004, () => console.log("Server ready on port 3004."));
});

// Export App
export default app;
