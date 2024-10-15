import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import dotenv from 'dotenv';
import { summarizeCommits, GitHubCommitData, CommitSummary } from './aiSum'
import publicRepoRoutes from './publicLogs';
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
  origin: ['https://change-log-app.vercel.app', 'http://localhost:3001', 'https://change-log-ui.vercel.app'],
  credentials: true,
}));
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.redirect('/auth');
});

app.get('/auth', (req: Request, res: Response) => {
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}`);
});


app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const redirectURI = req.query.redirect_uri || 'https://change-log-ui.vercel.app/dashboard';

  try {
    // Exchange code for GitHub access token
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
      },
      {
        headers: { accept: 'application/json' },
      }
    );

    const accessToken = response.data.access_token;

    // Fetch the authenticated user information from GitHub
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const userId = userResponse.data.id;  // GitHub user ID

    // Redirect to the frontend with accessToken and userId as query params
    res.redirect(`${redirectURI}?accessToken=${accessToken}&userId=${userId}`);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect(`${redirectURI}?error=OAuth failed`);
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

    const repos = response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      default_branch: repo.default_branch
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
          since: since,
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
      date: new Date(commit.commit.author.date), // Convert to Date object
      repoFullName: repoFullName, // Add repoFullName to each commit
    }));

    // Step 4: Save commits in the database
    console.log('Saving commits to database...');
    const upsertPromises = commits.map(commit => 
      prisma.commit.upsert({
        where: { sha: commit.sha },
        update: {},
        create: {
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
          date: commit.date,
          repoFullName: commit.repoFullName,
        },
      })
    );

    // Execute all upsert operations concurrently
    await Promise.all(upsertPromises);

    console.log('Sending response...');
    res.json(commits);
  } catch (error) {
    console.error('Error fetching commits:', error);
    if (axios.isAxiosError(error)) {
      console.error('GitHub API error:', error.response?.data);
      return res.status(error.response?.status || 500).json({
        error: 'Failed to fetch commits',
        details: error.response?.data,
      });
    }
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});



app.get('/api/dashboard/summarize/:repoFullName', async (req: Request, res: Response) => {
  console.log('Received request for commit summarization:', req.params, req.query);
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

    // Step 1: Fetch commits from the database
    console.log('Fetching commits from database...');
    const commits = await prisma.commit.findMany({
      where: {
        repoFullName: repoFullName,
        
      },
      orderBy: {
        date: 'asc', // Order commits by date, if needed
      },
    });

    console.log('Number of commits fetched from the database:', commits.length);

    // Step 2: Format the commits for summarization
    const formattedCommits = commits.map(commit => ({
      sha: commit.sha,
      commit: {
        message: commit.message,
        author: {
          name: commit.author,
          date: commit.date.toISOString(), // Convert date to ISO string for consistency
        },
      },
    }));

    console.log('Summarizing commits...');
    const summary = await summarizeCommits(formattedCommits);

    console.log('Summary generated successfully:', summary);
    res.json(summary);
  } catch (error) {
    console.error('Error in /api/dashboard/summarize route:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to summarize commits', details: 'Check server logs for more information' });
  }
});

app.use('/api/public', publicRepoRoutes);


const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});