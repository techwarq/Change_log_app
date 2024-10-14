import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

// Initialize Prisma Client
const prisma = new PrismaClient();

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

export interface PRSummary {
  name: string;
  description: string;
  tags: string[];
}

// Zod schema for commit output validation
const commitSummarySchema = z.object({
  name: z.string().describe("A short, descriptive title for this commit"),
  description: z.string().describe("A brief summary of the main changes and their purpose"),
  tags: z.array(z.string()).describe("An array of relevant tags"),
});

const parser = StructuredOutputParser.fromZodSchema(commitSummarySchema);

// ChatGroq configuration for commits
const llm = new ChatGroq({
  temperature: 0,
  modelName: "llama-3.1-70b-versatile",
  apiKey: process.env.GROQ_API_KEY,
});

// Define the prompt for each commit summarization
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant that summarizes individual git commit messages. Provide a summary in the specified format."],
  ["human", "Summarize this commit:\n{commit}\n\n{format_instructions}"],
]);

// Create the chain that uses the prompt, LLM, and parser for commits
const chain = prompt.pipe(llm).pipe(parser);

// Function to summarize each commit
export const summarizeCommits = async (commits: GitHubCommitData[]): Promise<CommitSummary[]> => {
  console.log(`Starting summarization of ${commits.length} commits`);

  if (commits.length === 0) {
    console.warn('No commits provided for summarization');
    return [{ name: 'No Changes', description: 'No commits were provided for summarization.', tags: ['empty'] }];
  }

  const commitSummaries: CommitSummary[] = [];

  try {
    for (const commit of commits) {
      console.log(`Summarizing commit with sha: ${commit.sha}`);

      // Prepare the commit message for summarization
      const commitMessage = commit.commit.message;

      // Invoke the summarization chain for each commit
      const result = await chain.invoke({
        commit: commitMessage,
        format_instructions: parser.getFormatInstructions(),
      });

      console.log(`Received summary for commit ${commit.sha}:`, result);

      // Push the individual result to the summary array
      commitSummaries.push(result);
    }

    return commitSummaries;

  } catch (error) {
    console.error('Error in summarizeCommits:', error);
    return commits.map(() => ({
      name: 'Error in Summarization',
      description: 'An error occurred while trying to summarize the commit. Please try again later or contact support if the problem persists.',
      tags: ['error']
    }));
  }
};

// Pull request summarization schema
const pullRequestSummarySchema = z.object({
  name: z.string().min(1).describe("A short, descriptive title for this pull request"),
  description: z.string().min(1).describe("A brief summary of the main changes and their purpose"),
  tags: z.array(z.string()).min(1).describe("An array of relevant tags indicating the nature of the PR (e.g., 'bug-fix', 'feature', 'enhancement', 'performance', 'documentation', 'refactoring', 'security', etc.)"),
});

// Define ChatGroq configuration for pull requests
const llm2 = new ChatGroq({
  temperature: 0,
  modelName: "llama-3.1-70b-versatile",
  apiKey: process.env.GROQ_API_KEY,
});

// Define the prompt for PR summarization
const prompt2 = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant that summarizes individual pull requests. Provide a succinct summary that includes a clear title, a brief description of the main changes, and relevant tags without adding any extraneous characters, the tags should depict what where the changes in one word like fix, issue, feature, enchancement, etc."],
  ["human", "Summarize this pull request: Title: {prTitle} Description: {prDescription} {format_instructions}"],
]);

const parser2 = StructuredOutputParser.fromZodSchema(pullRequestSummarySchema);

// Chain for PRs
const chain2 = prompt2.pipe(llm2).pipe(parser2);

// Function to summarize pull requests
export const summarizePullRequests = async (repoId: number): Promise<PRSummary[]> => {
  console.log(`Starting summarization of 5 most recent closed pull requests for repo ID: ${repoId}`);

  try {
    // Fetch the 5 most recent closed pull requests from the database
    const pullRequests = await prisma.pullRequest.findMany({
      where: { 
        repoId,
         // Ensure we're only getting closed PRs
      },
      
      take: 10 // Limit to 5 results
    });

    if (pullRequests.length === 0) {
      console.warn('No closed pull requests found for summarization');
      return [{ name: 'No Recent Changes', description: 'No recently closed pull requests were found for summarization.', tags: [] }];
    }

    const pullRequestSummaries: PRSummary[] = [];

    for (const pr of pullRequests) {
      console.log(`Summarizing pull request titled: ${pr.title}`);

      // Invoke the summarization chain for each pull request
      const result = await chain2.invoke({
        prTitle: pr.title,
        prDescription: pr.description,
        format_instructions: parser2.getFormatInstructions(),
      });

      console.log(`Received summary for pull request ${pr.title}:`, result);

      // Ensure the result matches the PRSummary interface
      const prSummary: PRSummary = {
        name: result.name || pr.title,
        description: result.description || 'No description available',
        tags: result.tags || [],
      };

      pullRequestSummaries.push(prSummary);
    }

    return pullRequestSummaries;

  } catch (error) {
    console.error('Error in summarizePullRequests:', error);
    return [{ name: 'Error in Summarization', description: 'An error occurred while trying to summarize the pull requests.', tags: ['error'] }];
  }
};