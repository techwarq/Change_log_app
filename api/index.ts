// File: src/app.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors({
  origin: 'https://change-log-app.vercel.app',
  credentials: true,
}));
app.use(express.json());

// GitHub API configuration
const GITHUB_CLIENT_ID = process.env.CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.CLIENT_SECRET;
const GITHUB_REDIRECT_URI =  'http://change-log-app.vercel.app/auth/github/callback';

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

// Login route - redirects to GitHub OAuth
app.get('/auth/github', (req: Request, res: Response) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}`;
  res.redirect(githubAuthUrl);

});

// GitHub OAuth callback route
// GitHub OAuth callback route
app.get('/auth/github/callback', async (req: Request, res: Response) => {
  const { code } = req.query;

  console.log('Received callback with code:', code);

  if (!code || typeof code !== 'string') {
    console.error('Invalid code received');
    return res.status(400).json({ error: 'Invalid code' });
  }

  try {
    console.log('Attempting to exchange code for access token');
    const response = await axios.post<GitHubAuthResponse>('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }, {
      headers: {
        Accept: 'application/json',
      },
    });

    console.log('GitHub API response:', JSON.stringify(response.data, null, 2));

    const { access_token } = response.data;

    if (!access_token) {
      console.error('No access token received from GitHub');
      return res.status(500).json({ error: 'Failed to obtain access token' });
    }

    console.log('Access token obtained successfully');

    // Save the access token to the database
    try {
      console.log('Attempting to save access token to database');
      const user = await prisma.user.create({
        data: {
          githubToken: access_token,
        },
      });
      console.log('User created in database:', user.id);

      // Redirect to the frontend with the user ID
      const redirectUrl = `http://change-log-app.vercel.app/dashboard?userId=${user.id}`;
      console.log('Redirecting to:', redirectUrl);
      return res.redirect(redirectUrl);
    } catch (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Failed to save user data' });
    }
  } catch (error) {
    console.error('Error during GitHub authentication:', error);
    if (axios.isAxiosError(error) && error.response) {
      console.error('GitHub API error response:', error.response.data);
      console.error('GitHub API error status:', error.response.status);
      console.error('GitHub API error headers:', error.response.headers);
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get user's repositories for dashboard
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
    }));

    res.json(repos);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get commits for a repository
app.get('/api/dashboard/commits/:repoFullName', async (req: Request, res: Response) => {
  const { repoFullName } = req.params;
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

    const response = await axios.get<GitHubCommit[]>(`https://api.github.com/repos/${repoFullName}/commits`, {
      headers: {
        Authorization: `token ${user.githubToken}`,
      },
    });

    const commits = response.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
    }));

    res.json(commits);
  } catch (error) {
    console.error('Error fetching commits:', error);
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});