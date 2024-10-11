import { Groq } from "groq-sdk";
import dotenv from 'dotenv';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface GitHubCommitData {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

export interface CommitSummary {
  name: string;
  description: string;
  tags: string[];
}

export const summarizeCommits = async (commits: GitHubCommitData[]): Promise<CommitSummary> => {
  try {
    const commitMessages = commits.map(commit => commit.commit.message).join("\n");

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Summarize the following commit messages and provide a name, description, and tags. Format the response exactly as follows, without any additional text:
          Name: [A short, descriptive name for this set of commits]
          Description: [A brief summary of the main changes and their purpose]
          Tags: [comma-separated list of relevant tags]

          Commit messages:
          ${commitMessages}`,
        },
      ],
      model: "llama2-70b-4096",
      temperature: 0.5,
      max_tokens: 500,
    });

    const summary = chatCompletion.choices[0]?.message?.content;

    if (!summary) {
      throw new Error("Failed to generate summary from Groq API");
    }

    // Parse the summary
    const lines = summary.split('\n').filter(line => line.trim() !== '');
    let name = '', description = '', tags: string[] = [];

    for (const line of lines) {
      if (line.startsWith('Name:')) {
        name = line.replace('Name:', '').trim();
      } else if (line.startsWith('Description:')) {
        description = line.replace('Description:', '').trim();
      } else if (line.startsWith('Tags:')) {
        tags = line.replace('Tags:', '').split(',').map(tag => tag.trim());
      }
    }

    // Validate the parsed data
    if (!name || !description || tags.length === 0) {
      throw new Error("Failed to parse summary correctly");
    }

    return { name, description, tags };
  } catch (error) {
    console.error('Error in summarizeCommits:', error);
    throw new Error('Failed to summarize commits');
  }
};