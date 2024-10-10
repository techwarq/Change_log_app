import axios from 'axios';

// Interfaces
interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
}

export async function getRepos(accessToken: string) {
  try {
    const response = await axios.get<GitHubRepo[]>('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${accessToken}`
      }
    });

    return response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      isPrivate: repo.private
    }));
  } catch (error) {
    console.error('Error fetching repositories:', error);
    throw new Error('Failed to fetch repositories');
  }
}

export async function getCommits(accessToken: string, owner: string, repo: string) {
  try {
    const response = await axios.get<GitHubCommit[]>(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: {
        Authorization: `token ${accessToken}`
      }
    });

    return response.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date
    }));
  } catch (error) {
    console.error('Error fetching commits:', error);
    throw new Error('Failed to fetch commits');
  }
}