import { Page } from 'playwright';

export interface ScrapedJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  platform?: string;
  matchScore?: number;
  relevanceReason?: string;
}

export interface JobBoardAdapter {
  platform: string;
  
  /**
   * Scrapes the job board for new vacancy listings based on keywords.
   */
  scrapeJobs(page: Page, keywords: string, location: string): Promise<ScrapedJob[]>;

  /**
   * Navigates to a specific job and performs the application logic.
   */
  applyToJob(page: Page, jobId: string, aiSummary: string): Promise<boolean>;
}
