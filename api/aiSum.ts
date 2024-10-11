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
          content: `Summarize the following commit messages and provide a name, description, and tags. Format the response as follows:
          Name: [A short, descriptive name for this set of commits]
          Description: [A brief summary of the main changes and their purpose]
          Tags: [comma-separated list of relevant tags]

          Commit messages:
          ${commitMessages}`,
        },
      ],
      model: "llama3-8b-8192",
      temperature: 0,
      max_tokens: 500,
    });

    const summary = chatCompletion.choices[0]?.message?.content;

    if (!summary) {
      throw new Error("Failed to generate summary from Groq API");
    }

    const [nameLine, descriptionLine, tagsLine] = summary.split('\n');

    return {
      name: nameLine.replace('Name:', '').trim(),
      description: descriptionLine.replace('Description:', '').trim(),
      tags: tagsLine.replace('Tags:', '').split(',').map(tag => tag.trim()),
    };
  } catch (error) {
    console.error('Error in summarizeCommits:', error);
    throw new Error('Failed to summarize commits');
  }
};