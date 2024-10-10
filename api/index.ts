// File: src/app.ts
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
  origin: 'https://change-log-app.vercel.app',
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
    const response = await axios.get(`https://change-log-app.vercel.app/api/dashboard/repos?userId=${userId}`);
    res.json(response.data); // Send repos to the dashboard
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});


app.get('/api/dashboard/repos', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const response = await axios.get<GitHubRepo[]>('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${user.githubToken}`,
      },
    });

    const repos = response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      commitsUrl: `/api/dashboard/commits/${repo.full_name}?userId=${userId}` 
    }));

    res.json(repos);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});
app.get('/api/dashboard/commits/:repoFullName', async (req: Request, res: Response) => {
  console.log('Received request for commits:', req.params, req.query);
  const { repoFullName } = req.params;
  const { userId } = req.query;

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

    console.log('Fetching commits from GitHub...');
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return res.status(400).json({ error: 'Invalid repository name format' });
    }

    const response = await axios.get<GitHubCommit[]>(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: {
        Authorization: `token ${user.githubToken}`,
      },
    });

    console.log('Received response from GitHub');
    const commits = response.data.map(commit => ({
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
    res.status(500).json({ error: 'Failed to fetch commits', });
  }
});
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
