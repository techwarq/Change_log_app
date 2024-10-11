import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";
import dotenv from 'dotenv';

dotenv.config();

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

// Zod schema for output validation
const commitSummarySchema = z.object({
  name: z.string().describe("A short, descriptive title for this commit"),
  description: z.string().describe("A brief summary of the main changes and their purpose"),
  tags: z.array(z.string()).describe("An array of relevant tags"),
});

const parser = StructuredOutputParser.fromZodSchema(commitSummarySchema);

// ChatGroq configuration
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

// Create the chain that uses the prompt, LLM, and parser
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
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }

    // Return an error summary for all commits if something goes wrong
    return commits.map(() => ({
      name: 'Error in Summarization',
      description: 'An error occurred while trying to summarize the commit. Please try again later or contact support if the problem persists.',
      tags: ['error']
    }));
  }
};
