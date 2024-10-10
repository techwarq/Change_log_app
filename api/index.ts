import express, { Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from "dotenv";
import axios from 'axios';
import session from 'express-session';

dotenv.config();

const app = express();

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
    username?: string;
  }
}

interface GitHubUser {
  login: string;
  name: string | null;
}

interface Repo {
  name: string;
  full_name: string;
}

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    }
  }
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
  const scope = 'repo user:read';
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

    const userResponse = await axios.get<GitHubUser>('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`
      }
    });

    const { login } = userResponse.data;

    if (req.session) {
      req.session.accessToken = accessToken;
      req.session.username = login;
    }

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error during GitHub authentication:', error);
    res.status(500).send('An error occurred during authentication.');
  }
});

app.get('/dashboard', async (req: Request, res: Response) => {
  if (!req.session || !req.session.accessToken) {
    return res.redirect('/');
  }

  try {
    const repos = await getRepos(req.session.accessToken);
    res.send(`
      <html>
        <head>
          <title>Dashboard - GitHub Changelog Viewer</title>
        </head>
        <body>
          <h1>Welcome, ${req.session.username || 'User'}!</h1>
          <p>Select a repository to view its changelog:</p>
          <div id="repos">
            ${repos.map(repo => `
              <button onclick="loadCommits('${repo.full_name}')">${repo.name}</button>
            `).join('')}
          </div>
          <div id="commits"></div>
          <script>
            function loadCommits(fullName) {
              fetch('/api/repos/' + fullName + '/commits')
                .then(response => response.json())
                .then(commits => {
                  const commitsDiv = document.getElementById('commits');
                  commitsDiv.innerHTML = '<h2>Commits for ' + fullName + '</h2>';
                  commits.forEach(commit => {
                    commitsDiv.innerHTML += '<p>' + commit.commit.message + ' - ' + commit.commit.author.name + ' (' + commit.commit.author.date + ')</p>';
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
    res.json(commits);
  } catch (error) {
    console.error('Error fetching commits:', error);
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

async function getRepos(accessToken: string): Promise<Repo[]> {
  const response = await axios.get<Repo[]>('https://api.github.com/user/repos', {
    headers: {
      Authorization: `token ${accessToken}`
    },
    params: {
      sort: 'updated',
      per_page: 100
    }
  });
  return response.data;
}

async function getCommits(accessToken: string, owner: string, repo: string): Promise<Commit[]> {
  const response = await axios.get<Commit[]>(`https://api.github.com/repos/${owner}/${repo}/commits`, {
    headers: {
      Authorization: `token ${accessToken}`
    },
    params: {
      per_page: 100
    }
  });
  return response.data;
}

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`Server ready on port ${PORT}`));

export default app;