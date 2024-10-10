import axios from 'axios';

interface Repo {
  name: string;
  fullName: string;
}

interface Commit {
  message: string;
  author: string;
  date: string;
}

export async function getRepos(accessToken: string): Promise<Repo[]> {
  const response = await axios.get('https://api.github.com/user/repos', {
    headers: {
      Authorization: `token ${accessToken}`
    }
  });
  return response.data.map((repo: any) => ({
    name: repo.name,
    fullName: repo.full_name
  }));
}

export async function getCommits(accessToken: string, owner: string, repo: string): Promise<Commit[]> {
  const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
    headers: {
      Authorization: `token ${accessToken}`
    }
  });
  return response.data.map((commit: any) => ({
    message: commit.commit.message,
    author: commit.commit.author.name,
    date: new Date(commit.commit.author.date).toLocaleString()
  }));
}