import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

interface GitHubAuthResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
}

interface GitHubBranch {
  commit: {
    sha: string;
  };
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

app.use(cors({
  origin: ['https://change-log-app.vercel.app', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.redirect('/auth');
});

app.get('/auth', (req: Request, res: Response) => {
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}`);
});

app.get('/oauth-callback', async ({ query: { code } }, res) => {
  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }

  const body = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code,
  };

  const opts = { headers: { accept: 'application/json' } };

  try {
    const response = await axios.post<GitHubAuthResponse>('https://github.com/login/oauth/access_token', body, opts);
    const { access_token } = response.data;

    if (!access_token) {
      console.error('No access token received from GitHub');
      return res.status(500).json({ error: 'Failed to obtain access token' });
    }

    console.log('Access token obtained successfully');

    const user = await prisma.user.create({
      data: {
        githubToken: access_token,
      },
    });

    console.log('User created in database:', user.id);

    const redirectUrl = `http://change-log-app.vercel.app/dashboard?userId=${user.id}`;
    console.log('Redirecting to:', redirectUrl);
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error during GitHub authentication:', error);
    if (axios.isAxiosError(error) && error.response) {
      console.error('GitHub API error response:', error.response.data);
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get('/dashboard', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId as string) },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const response = await axios.get<GitHubRepo[]>('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${user.githubToken}`,
      },
    });

    const repoLinks = response.data.map(repo => `
      <li>
        <a href="/api/dashboard/commits/${encodeURIComponent(repo.full_name)}?userId=${userId}" target="_blank">
          ${repo.name}
        </a>
      </li>
    `).join('');

    const html = `
      <html>
        <body>
          <h1>Your Repositories</h1>
          <ul>
            ${repoLinks}
          </ul>
        </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

app.get('/api/dashboard/commits/:repoFullName', async (req: Request, res: Response) => {
  console.log('Received request for commits:', req.params, req.query);
  const { repoFullName } = req.params;
  const { userId, since = '2019-05-06T00:00:00Z' } = req.query;

  if (!userId || typeof userId !== 'string') {
    console.log('Invalid userId:', userId);
    return res.status(400).json({ error: 'Invalid userId' });
  }

  try {
    console.log('Fetching user from database...');
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });

    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return res.status(400).json({ error: 'Invalid repository name format' });
    }

    // Step 1: Fetch repository details to get the default branch
    console.log('Fetching repository details...');
    const repoResponse = await axios.get<GitHubRepo>(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `token ${user.githubToken}`,
        },
      }
    );
    const defaultBranch = repoResponse.data.default_branch;

    // Step 2: Fetch the SHA of the default branch
    console.log('Fetching default branch SHA...');
    const branchResponse = await axios.get<GitHubBranch>(
      `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`,
      {
        headers: {
          Authorization: `token ${user.githubToken}`,
        },
      }
    );
    const sha = branchResponse.data.commit.sha;

    // Step 3: Fetch commits using the SHA
    console.log('Fetching commits from GitHub...');
    const commitsResponse = await axios.get<GitHubCommit[]>(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      {
        params: {
          sha: sha,
          per_page: 100,
          since: since
        },
        headers: {
          Authorization: `token ${user.githubToken}`,
        },
      }
    );

    console.log('Received response from GitHub');
    const commits = commitsResponse.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
    }));

    console.log('Sending response...');
    res.json(commits);
  } catch (error) {
    console.error('Error fetching commits:', error);
    if (axios.isAxiosError(error)) {
      console.error('GitHub API error:', error.response?.data);
      return res.status(error.response?.status || 500).json({ 
        error: 'Failed to fetch commits', 
        details: error.response?.data 
      });
    }
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});