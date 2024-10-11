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
  console.log(`Starting summarization of ${commits.length} commits`);

  if (commits.length === 0) {
    console.warn('No commits provided for summarization');
    return { name: 'No Changes', description: 'No commits were provided for summarization.', tags: ['empty'] };
  }

  try {
    const commitMessages = commits.map(commit => commit.commit.message).join("\n");
    console.log(`Prepared ${commits.length} commit messages for summarization`);

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
    console.log('Received summary from Groq API');

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
        tags = line.replace('Tags:', '').split(',').map(tag => tag.trim()).filter(tag => tag !== '');
      }
    }

    console.log('Parsed summary:', { name, description, tags: tags.join(', ') });

    // Validate the parsed data
    if (!name) name = 'Untitled Changes';
    if (!description) description = 'No description provided.';
    if (tags.length === 0) tags = ['untagged'];

    return { name, description, tags };
  } catch (error) {
    console.error('Error in summarizeCommits:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    // Instead of throwing a new error, we'll return a default summary
    return {
      name: 'Error in Summarization',
      description: 'An error occurred while trying to summarize the commits. Please try again later or contact support if the problem persists.',
      tags: ['error']
    };
  }
};