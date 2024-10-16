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
  origin: ['https://change-log-app.vercel.app', 'http://localhost:3001', 'https://change-log-ui.vercel.app', ],
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
    // Step 1: Exchange the code for an access token
    const response = await axios.post<GitHubAuthResponse>('https://github.com/login/oauth/access_token', body, opts);
    const { access_token } = response.data;

    if (!access_token) {
      console.error('No access token received from GitHub');
      return res.status(500).json({ error: 'Failed to obtain access token' });
    }

    console.log('Access token obtained successfully');

    // Step 2: Save the token in the database
    const user = await prisma.user.create({
      data: {
        githubToken: access_token,
      },
    });

    // Step 3: Redirect to frontend dashboard
    const frontendUrl = `https://change-log-ui.vercel.app/dashboard?userId=${user.id}&token=${access_token}`;

    console.log('Redirecting to frontend dashboard:', frontendUrl);

    // Step 4: Redirect user to frontend dashboard with token and userId
    return res.redirect(frontendUrl);
    
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
app.get('/api/dashboard/commits/:owner/:repo', async (req: Request, res: Response) => {
  console.log('Received request for commits:', req.params, req.query);
  const { owner, repo } = req.params;
  const { userId, since = '2019-05-06T00:00:00Z' } = req.query;

  if (!owner || !repo) {
    console.log('Invalid owner or repo:', owner, repo);
    return res.status(400).json({ error: 'Invalid owner or repo parameter' });
  }

  if (!userId || typeof userId !== 'string') {
    console.log('Invalid userId:', userId);
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const repoFullName = `${owner}/${repo}`;

  try {
    console.log('Fetching user from database...');
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });

    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Step 1: Fetch repository details to get the default branch
    console.log('Fetching repository details...');
    const repoResponse = await axios.get<GitHubRepo>(
      `https://api.github.com/repos/${repoFullName}`,
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
      `https://api.github.com/repos/${repoFullName}/branches/${defaultBranch}`,
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
      `https://api.github.com/repos/${repoFullName}/commits`,
      {
        params: {
          sha: sha,
          per_page: 5,
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
      date: new Date(commit.commit.author.date),
      repoFullName: repoFullName,
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

app.get('/api/dashboard/summarize/:owner/:repo', async (req: Request, res: Response) => {
  console.log('Received request for commit summarization:', req.params, req.query);
  const { owner, repo } = req.params;
  const { userId, since = '2019-05-06T00:00:00Z' } = req.query;

  if (!owner || !repo) {
    console.log('Invalid owner or repo:', owner, repo);
    return res.status(400).json({ error: 'Invalid owner or repo parameter' });
  }

  if (!userId || typeof userId !== 'string') {
    console.log('Invalid userId:', userId);
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const repoFullName = `${owner}/${repo}`;

  try {
    console.log('Fetching user from database...');
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });

    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Step 1: Fetch commits from the database
    console.log('Fetching commits from database...');
    const commits = await prisma.commit.findMany({
      where: {
        repoFullName: repoFullName,
       
       
      },
      take: 5 ,
      orderBy: {
        date: 'asc',
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
          date: commit.date.toISOString(),
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