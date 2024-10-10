import express, { Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import axios from 'axios';
import { getRepos, getCommits } from './api';
import session from 'express-session';
import checkRateLimits from './ratelimitChecker';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("common"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  credentials: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
  }
}

interface GitHubUser {
  email: string | null;
  name: string | null;
  login: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

app.get("/", (_req: Request, res: Response) => {
  res.send(`
    <html>
      <head>
        <title>GitHub Changelog Viewer</title>
      </head>
      <body>
        <h1>Welcome to GitHub Changelog Viewer</h1>
        <a href="/auth/github">
          <button style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
            Login with GitHub
          </button>
        </a>
      </body>
    </html>
  `);
});

app.get('/auth/github', (_req: Request, res: Response) => {
  const scope = 'user:email repo';
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}&scope=${scope}`);
});

app.get('/auth/github/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    const tokenResponse = await axios.post<{ access_token: string }>('https://github.com/login/oauth/access_token', {
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      code: code
    }, {
      headers: {
        Accept: 'application/json'
      }
    });

    const accessToken = tokenResponse.data.access_token;
    await checkRateLimits(accessToken);

    const userResponse = await axios.get<GitHubUser>('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`
      }
    });
    await checkRateLimits(accessToken);

    let { email, name } = userResponse.data;

    if (!email) {
      const emailResponse = await axios.get<GitHubEmail[]>('https://api.github.com/user/emails', {
        headers: {
          Authorization: `token ${accessToken}`
        }
      });
      await checkRateLimits(accessToken);
      const primaryEmail = emailResponse.data.find(email => email.primary);
      if (primaryEmail) {
        email = primaryEmail.email;
      }
    }

    if (!name) {
      name = userResponse.data.login;
    }

    if (!email) {
      throw new Error('Unable to retrieve email from GitHub');
    }

    const user = await prisma.user.upsert({
      where: { email: email },
      update: { 
        accessToken: accessToken,
        name: name
      },
      create: {
        email: email,
        name: name,
        accessToken: accessToken,
        password: '',
        role: 'PUBLIC'
      }
    });

    if (req.session) {
      req.session.accessToken = accessToken;
    }

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error during GitHub authentication:', error);
    if (axios.isAxiosError(error) && error.response) {
      console.error('Error response:', error.response.data);
      console.error('Error status:', error.response.status);
    }
    res.status(500).send('An error occurred during authentication. Please check server logs for more details.');
  }
});

app.get('/dashboard', async (req: Request, res: Response) => {
  if (!req.session || !req.session.accessToken) {
    return res.redirect('/');
  }

  try {
    const repos = await getRepos(req.session.accessToken);
    await checkRateLimits(req.session.accessToken);
    res.send(`
      <html>
        <head>
          <title>Dashboard - GitHub Changelog Viewer</title>
        </head>
        <body>
          <h1>Dashboard</h1>
          <p>Select a repository to view its changelog:</p>
          <div id="repos">
            ${repos.map(repo => `
              <button onclick="loadCommits('${repo.fullName}')">${repo.name}</button>
            `).join('')}
          </div>
          <div id="commits"></div>
          <script>
            function loadCommits(fullName) {
              fetch('/api/repos/' + fullName + '/commits')
                .then(response => {
                  if (!response.ok) {
                    throw new Error('Network response was not ok');
                  }
                  return response.json();
                })
                .then(commits => {
                  const commitsDiv = document.getElementById('commits');
                  commitsDiv.innerHTML = '<h2>Commits for ' + fullName + '</h2>';
                  commits.forEach(commit => {
                    commitsDiv.innerHTML += '<p>' + commit.message + ' - ' + commit.author + ' (' + commit.date + ')</p>';
                  });
                })
                .catch(error => {
                  console.error('Error loading commits:', error);
                  alert('Failed to load commits');
                });
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).send('An error occurred while fetching repositories');
  }
});

app.get('/api/repos/:owner/:repo/commits', async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  if (!req.session || !req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const commits = await getCommits(req.session.accessToken, owner, repo);
    await checkRateLimits(req.session.accessToken);
    res.json(commits);
  } catch (error) {
    console.error('Error fetching commits:', error);
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

const testDatabaseConnection = async (): Promise<void> => {
  try {
    await prisma.$connect();
    console.log('Database connected successfully!');
  } catch (error) {
    console.error('Error connecting to the database:', error);
  }
};

testDatabaseConnection().then(() => {
  app.listen(3004, () => console.log("Server ready on port 3004."));
});

export default app;