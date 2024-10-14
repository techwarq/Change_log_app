import { Router, Request, Response } from 'express';
import { repositories } from './const';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { summarizePullRequests } from './aiSum';
import NodeCache from 'node-cache';

const router = Router();
const prisma = new PrismaClient();

// Initialize cache with a default TTL of 10 minutes
const cache = new NodeCache({ stdTTL: 600 });

// Function to save repository details in the database
const saveRepoDetails = async (owner: string, name: string): Promise<number> => {
  try {
    const repoFullName = `${owner}/${name}`;
    const repo = await prisma.repo.upsert({
      where: { fullName: repoFullName },
      update: {},
      create: {
        fullName: repoFullName,
      },
    });
    console.log(`Repo saved: ${repo.fullName} with ID: ${repo.id}`);
    return repo.id;
  } catch (error) {
    console.error('Error saving repo:', error);
    throw new Error('Unable to save repo details');
  }
};

// Route to handle getting and saving repositories
router.get('/repos', async (req: Request, res: Response) => {
  console.log('Received request for repos:', req.params, req.query);

  // Save each repository and get its repoId
  const repoIds = await Promise.all(
    repositories.map(repo => saveRepoDetails(repo.owner, repo.name))
  );

  // Generate the response as JSON
  const reposResponse = repositories.map((repo, index) => ({
    owner: repo.owner,
    name: repo.name,
    id: repoIds[index], // Include the ID for reference
  }));

  // Send the JSON response
  res.json(reposResponse);
});

// Route to get pull requests for a specific repository
router.get('/repos/:owner/:repo/changelogs', async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const cacheKey = `changelog_${owner}_${repo}`;

  try {
    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log('Returning cached data for', cacheKey);
      return res.json(cachedData);
    }

    const repoFullName = `${owner}/${repo}`;
    const repoRecord = await prisma.repo.findUnique({
      where: { fullName: repoFullName },
    });

    if (!repoRecord) {
      return res.status(404).send('Repository not found');
    }

    // Check if we have already fetched and saved PRs for this repo recently
    const recentPRs = await prisma.pullRequest.findMany({
      where: {
        repoId: repoRecord.id,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // PRs created in the last 24 hours
      }
    });

    let pullRequests;
    if (recentPRs.length === 0) {
      // If no recent PRs, fetch from GitHub API
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=closed`);
      pullRequests = response.data;

      // Save pull requests to the database
      await Promise.all(
        pullRequests.map(async (pr: any) => {
          await prisma.pullRequest.create({
            data: {
              title: pr.title,
              description: pr.body || 'No description provided',
              repoId: repoRecord.id,
              ...(pr.closed_at && { closedAt: new Date(pr.closed_at) }),
            },
          });
        })
      );
    } else {
      // Use the PRs from the database
      pullRequests = recentPRs;
    }

    // Use the AI summarization function
    const summarizedPullRequests = await summarizePullRequests(repoRecord.id);

    // Cache the result
    cache.set(cacheKey, summarizedPullRequests);

    // Send the summarized pull requests as JSON
    res.json(summarizedPullRequests);
  } catch (error) {
    console.error('Error fetching, saving, or summarizing pull requests:', error);
    res.status(500).send('Error processing pull requests');
  }
});

export default router;
