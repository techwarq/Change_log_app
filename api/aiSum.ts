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

const commitSummarySchema = z.object({
  name: z.string().describe("A short, descriptive title for this set of commits"),
  description: z.string().describe("A brief summary of the main changes and their purpose"),
  tags: z.array(z.string()).describe("An array of relevant tags"),
});

const parser = StructuredOutputParser.fromZodSchema(commitSummarySchema);

const llm = new ChatGroq({
  temperature: 0,
  modelName: "llama-3.1-70b-versatile",
  apiKey: process.env.GROQ_API_KEY,
 
  
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant that summarizes git commit messages. Provide a summary in the specified format."],
  ["human", "Summarize these commits:\n{commits}\n\n{format_instructions}"],
]);

const chain = prompt.pipe(llm).pipe(parser);

export const summarizeCommits = async (commits: GitHubCommitData[]): Promise<CommitSummary> => {
  console.log(`Starting summarization of ${commits.length} commits`);

  if (commits.length === 0) {
    console.warn('No commits provided for summarization');
    return { name: 'No Changes', description: 'No commits were provided for summarization.', tags: ['empty'] };
  }

  try {
    const commitMessages = commits.map(commit => commit.commit.message).join("\n");
    console.log(`Prepared ${commits.length} commit messages for summarization`);

    const result = await chain.invoke({
      commits: commitMessages,
      format_instructions: parser.getFormatInstructions(),
    });

    console.log('Received summary:', result);

    return result;
  } catch (error) {
    console.error('Error in summarizeCommits:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return {
      name: 'Error in Summarization',
      description: 'An error occurred while trying to summarize the commits. Please try again later or contact support if the problem persists.',
      tags: ['error']
    };
  }
};